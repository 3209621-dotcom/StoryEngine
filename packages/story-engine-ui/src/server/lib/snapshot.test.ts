import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, symlink, unlink, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { withProjectCommitLock } from "@actalk/story-engine";
import { createSnapshot, humanizeUndoLabel, listSnapshots, restoreSnapshot, runWithSnapshot, undoLastChange } from "./snapshot.js";

const execFileAsync = promisify(execFile);

describe("humanizeUndoLabel（R2#3·操作历史 label 人话化）", () => {
  it("把 agent:<toolId> 映射成中文动作名", () => {
    expect(humanizeUndoLabel("agent:commit_apply")).toBe("定稿");
    expect(humanizeUndoLabel("agent:foundation_write")).toBe("更新故事资料");
  });

  it("恢复产物里嵌入的 agent:<toolId> 也一并人话化（不再露『恢复到：agent:commit_apply』）", () => {
    expect(humanizeUndoLabel("恢复到：agent:commit_apply")).toBe("恢复到：定稿");
    expect(humanizeUndoLabel("恢复前自动快照")).toBe("恢复前自动快照");
  });

  it("未登记工具 id 至少剥掉 agent: 前缀；非 agent 标签原样返回", () => {
    expect(humanizeUndoLabel("agent:some_new_tool")).toBe("some_new_tool");
    expect(humanizeUndoLabel("初始快照")).toBe("初始快照");
  });

  it("带细节后缀 agent:<tool>:<detail> → 「动作：细节」，让同类多次写入可辨（rerun2 P2）；不泄漏 tool id", () => {
    expect(humanizeUndoLabel("agent:foundation_write:建角色 顾长风")).toBe("更新故事资料：建角色 顾长风");
    expect(humanizeUndoLabel("agent:foundation_write:改资产 事故原始图纸")).toBe("更新故事资料：改资产 事故原始图纸");
    expect(humanizeUndoLabel("agent:foundation_write:建角色 顾长风")).not.toContain("foundation_write");
    // 恢复产物里带细节也一并人话化
    expect(humanizeUndoLabel("恢复到：agent:foundation_write:建角色 顾长风")).toBe("恢复到：更新故事资料：建角色 顾长风");
  });
});

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "se-snap-"));
  await mkdir(join(dir, "story"), { recursive: true });
  await writeFile(join(dir, "project.json"), JSON.stringify({ title: "测试书" }), "utf-8");
  await writeFile(join(dir, "story", "threads.json"), JSON.stringify({ threads: [] }), "utf-8");
  return dir;
}

function deferred(): { readonly promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

async function filesInCommit(projectDir: string, id: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["-C", projectDir, "ls-tree", "-r", "--name-only", id]);
  return stdout.trim().split("\n").filter(Boolean);
}

describe("snapshot library", () => {
  it("creates a git repo and a labelled snapshot on first call", async () => {
    const dir = await makeProject();
    const snap = await createSnapshot(dir, "入库前快照");
    expect(snap.id).toMatch(/^[0-9a-f]{40}$/);
    expect(snap.label).toBe("入库前快照");
    await access(join(dir, ".git")); // 不抛错即存在
  });

  it("lists snapshots newest-first", async () => {
    const dir = await makeProject();
    await createSnapshot(dir, "第一次");
    await writeFile(join(dir, "story", "threads.json"), JSON.stringify({ threads: ["a"] }), "utf-8");
    await createSnapshot(dir, "第二次");
    const list = await listSnapshots(dir);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0]?.label).toBe("第二次");
    expect(list[0]!.timestamp).toBeGreaterThanOrEqual(list[1]!.timestamp);
  });

  it("restores modified file contents to the target snapshot", async () => {
    const dir = await makeProject();
    const snap = await createSnapshot(dir, "好状态");
    await writeFile(join(dir, "story", "threads.json"), JSON.stringify({ threads: ["bad"] }), "utf-8");
    await createSnapshot(dir, "坏状态");
    await restoreSnapshot(dir, snap.id);
    const content = JSON.parse(await readFile(join(dir, "story", "threads.json"), "utf-8")) as { threads: string[] };
    expect(content.threads).toEqual([]);
  });

  it("removes files created after the target snapshot", async () => {
    const dir = await makeProject();
    const snap = await createSnapshot(dir, "无新文件");
    await writeFile(join(dir, "story", "extra.json"), "{}", "utf-8");
    await createSnapshot(dir, "有新文件");
    await restoreSnapshot(dir, snap.id);
    await expect(access(join(dir, "story", "extra.json"))).rejects.toThrow();
  });

  it("removes the renamed file when a file was renamed after the target snapshot", async () => {
    const dir = await makeProject();
    const original = await readFile(join(dir, "story", "threads.json"), "utf-8");
    const snap = await createSnapshot(dir, "改名前");
    // 改名 = 写新删旧；内容一致会触发 git rename 侦测（R 而非 A）
    await writeFile(join(dir, "story", "renamed.json"), original, "utf-8");
    await unlink(join(dir, "story", "threads.json"));
    await createSnapshot(dir, "改名后");
    await restoreSnapshot(dir, snap.id);
    await expect(access(join(dir, "story", "renamed.json"))).rejects.toThrow();
    const restored = await readFile(join(dir, "story", "threads.json"), "utf-8");
    expect(restored).toBe(original);
  });

  it("removes files with non-ASCII names created after the target snapshot", async () => {
    const dir = await makeProject();
    const snap = await createSnapshot(dir, "中文文件名基线");
    await writeFile(join(dir, "story", "第12章.md"), "正文", "utf-8");
    await createSnapshot(dir, "新增中文文件");
    await restoreSnapshot(dir, snap.id);
    await expect(access(join(dir, "story", "第12章.md"))).rejects.toThrow();
  });

  it("rejects an invalid snapshot id without polluting history", async () => {
    const dir = await makeProject();
    await createSnapshot(dir, "唯一快照");
    const before = (await listSnapshots(dir)).length;
    await expect(restoreSnapshot(dir, "not-a-real-id")).rejects.toThrow();
    const after = (await listSnapshots(dir)).length;
    expect(after).toBe(before);
  });

  it("rejects commit residue before restore creates its pre-restore snapshot", async () => {
    const dir = await makeProject();
    const target = await createSnapshot(dir, "安全目标");
    const before = await listSnapshots(dir);
    const txDir = join(dir, ".story-engine-tx", "commit-chapter-0001");
    await mkdir(txDir, { recursive: true });
    await writeFile(join(txDir, "snapshot-manifest.json"), "{truncated", "utf-8");

    await expect(restoreSnapshot(dir, target.id)).rejects.toThrow(/snapshot|residue|manifest/iu);

    const after = await listSnapshots(dir);
    expect(after).toHaveLength(before.length);
    await expect(readFile(join(txDir, "snapshot-manifest.json"), "utf-8")).resolves.toBe("{truncated");
  });

  // PR C：撤销竞态。createSnapshot 持锁原子，但旧 withSnapshot 是「createSnapshot（持锁）→ run（锁外落盘）」，
  // 快照边界与落盘不在同一临界区 → 并发时另一操作的快照会切进 run 中间、捕获部分态（或撤销逃逸）。
  // runWithSnapshot 把「快照 + 落盘」罩进同一 project 锁，令二者原子。
  it("runWithSnapshot makes snapshot+write atomic: a concurrent snapshot never captures a partial multi-step write", async () => {
    const dir = await makeProject();
    await createSnapshot(dir, "基线"); // 先建库

    const part1Written = deferred();
    const gate = deferred();

    // A：两步写（part1 → 等门 → part2），整体必须原子——快照边界不能切进中间。
    const pA = runWithSnapshot(dir, "A", async () => {
      await writeFile(join(dir, "part1.txt"), "1", "utf-8");
      part1Written.resolve();
      await gate.promise;
      await writeFile(join(dir, "part2.txt"), "2", "utf-8");
      return "A-done";
    });

    await part1Written.promise; // A 已写 part1、停在门前（持锁中）
    const pB = createSnapshot(dir, "B-并发快照"); // 此刻并发触发一次快照
    gate.resolve();
    const [aResult, bSnap] = await Promise.all([pA, pB]);

    expect(aResult.result).toBe("A-done");
    expect(aResult.snapshot.id).toMatch(/^[0-9a-f]{40}$/);

    // B 的快照绝不能是部分态：含 part1 必含 part2，反之亦然。
    const files = await filesInCommit(dir, bSnap.id);
    expect(files.includes("part1.txt")).toBe(files.includes("part2.txt"));
  });

  it.skipIf(process.platform === "win32")("shares the canonical lock between a real snapshot path and its symlink alias", async () => {
    const dir = await makeProject();
    const alias = `${dir}-alias`;
    await symlink(dir, alias);
    const entered = deferred();
    const release = deferred();
    const snapshotRun = runWithSnapshot(dir, "别名共锁", async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    let aliasEntered = false;
    const aliasRun = withProjectCommitLock(alias, async () => {
      aliasEntered = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(aliasEntered).toBe(false);
    release.resolve();
    await Promise.all([snapshotRun, aliasRun]);
    expect(aliasEntered).toBe(true);
  });

  it("keeps history after restore (undo of undo is possible)", async () => {
    const dir = await makeProject();
    const snap = await createSnapshot(dir, "起点");
    await writeFile(join(dir, "story", "threads.json"), JSON.stringify({ threads: ["x"] }), "utf-8");
    await createSnapshot(dir, "改动");
    await restoreSnapshot(dir, snap.id);
    const list = await listSnapshots(dir);
    const labels = list.map((s) => s.label);
    expect(labels[0]).toContain("恢复到");
    expect(labels).toContain("改动"); // 历史没有被抹掉
  });
});

// C 批：对话里「撤销上一步」。恢复到最近一个『内容与当前不同、非撤销产物』的检查点
// （每个 agent 写操作前都有检查点）。连续撤销逐步回退、跳过撤销自身产物、无可撤销时诚实 null。
describe("undoLastChange 对话撤销", () => {
  // 真书永远有基线文件（project.json 等），用 makeProject 而非空目录——空 commit 上 restoreSnapshot 的
  // `git checkout <id> -- .` 会因无文件报错，那不是真实场景。
  it("撤销最近一次未提交写入（含新增 untracked 文件），回到该写操作前", async () => {
    const dir = await makeProject();
    await createSnapshot(dir, "agent:foundation_write"); // 写操作前检查点
    await writeFile(join(dir, "world.json"), "新资料"); // 工具写入（未提交、untracked）
    const r = await undoLastChange(dir);
    expect(r).not.toBeNull();
    expect(r?.undoneLabel).toBe("更新故事资料");
    await expect(access(join(dir, "world.json"))).rejects.toThrow(); // 写入被撤销
  });

  it("没有可撤销的改动 → 返回 null（绝不谎称已撤销）", async () => {
    const dir = await makeProject();
    await createSnapshot(dir, "agent:foundation_write"); // 检查点后无任何改动
    expect(await undoLastChange(dir)).toBeNull();
  });

  it("连续撤销逐步回退，跳过撤销产物、不卡原地", async () => {
    const dir = await makeProject();
    await createSnapshot(dir, "agent:generate_draft"); // step1 前
    await writeFile(join(dir, "a.md"), "A"); // step1 写
    await createSnapshot(dir, "agent:commit_apply"); // step2 前（a.md 入库）
    await writeFile(join(dir, "b.md"), "B"); // step2 写
    expect((await undoLastChange(dir))?.undoneLabel).toBe("定稿"); // 撤 step2
    await expect(access(join(dir, "b.md"))).rejects.toThrow();
    expect(await readFile(join(dir, "a.md"), "utf-8")).toBe("A"); // a.md 仍在
    expect((await undoLastChange(dir))?.undoneLabel).toBe("出稿"); // 再撤 step1
    await expect(access(join(dir, "a.md"))).rejects.toThrow();
  });
});

// afterfix #2：runWithSnapshot 落盘收尾——每次写操作后把产物即时收进 git，工作树保持干净，
// 杜绝「最后一次写操作产物长期 dirty 残留」（Codex 三轮误判「入库没写盘」）。收尾 commit 标成产物、
// undo 与操作历史都跳过它，撤销语义完全不变。
describe("runWithSnapshot 落盘收尾·写后工作树干净（Codex afterfix #2）", () => {
  async function gitStatusPorcelain(dir: string): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", dir, "status", "--porcelain"]);
    return stdout.trim();
  }

  it("写操作后工作树干净——产物即时进 git，不再长期 dirty 残留", async () => {
    const dir = await makeProject();
    await runWithSnapshot(dir, "agent:commit_apply", async () => {
      await mkdir(join(dir, "chapters"), { recursive: true });
      await writeFile(join(dir, "chapters", "0001.md"), "第一章正文");
      await writeFile(join(dir, "story", "threads.json"), JSON.stringify({ threads: ["新线索"] }));
      return { ok: true };
    });
    expect(await gitStatusPorcelain(dir)).toBe(""); // 入库后 git 干净（不再残留 chapters/threads 等 dirty）
  });

  it("收尾后 undo 仍精确撤销该写操作、且撤销后也干净（落盘收尾 commit 被 undo 跳过）", async () => {
    const dir = await makeProject();
    await runWithSnapshot(dir, "agent:commit_apply", async () => {
      await mkdir(join(dir, "chapters"), { recursive: true });
      await writeFile(join(dir, "chapters", "0001.md"), "正文");
      return { ok: true };
    });
    const r = await undoLastChange(dir);
    expect(r?.undoneLabel).toBe("定稿");
    await expect(access(join(dir, "chapters", "0001.md"))).rejects.toThrow(); // 入库被撤销
    expect(await gitStatusPorcelain(dir)).toBe(""); // 撤销后也干净
  });

  it("连续两次 runWithSnapshot 逐步撤销：先撤入库、再撤出稿——收尾 commit 绝不被误当『重做』目标", async () => {
    const dir = await makeProject();
    await runWithSnapshot(dir, "agent:generate_draft", async () => {
      await mkdir(join(dir, "drafts"), { recursive: true });
      await writeFile(join(dir, "drafts", "a.md"), "A");
      return { ok: true };
    });
    await runWithSnapshot(dir, "agent:commit_apply", async () => {
      await mkdir(join(dir, "chapters"), { recursive: true });
      await writeFile(join(dir, "chapters", "0001.md"), "B");
      return { ok: true };
    });
    expect((await undoLastChange(dir))?.undoneLabel).toBe("定稿"); // 撤 step2
    await expect(access(join(dir, "chapters", "0001.md"))).rejects.toThrow();
    expect(await readFile(join(dir, "drafts", "a.md"), "utf-8")).toBe("A"); // 出稿产物仍在（没被收尾 commit 带回）
    expect((await undoLastChange(dir))?.undoneLabel).toBe("出稿"); // 再撤 step1
    await expect(access(join(dir, "drafts", "a.md"))).rejects.toThrow();
  });
});
