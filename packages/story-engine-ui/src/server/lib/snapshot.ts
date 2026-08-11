import { execFile } from "node:child_process";
import { access, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { recoverProjectCommitTransactions, withProjectCommitLock } from "@actalk/story-engine";

import { resolveGitCommand } from "./data-dirs.js";

const execFileAsync = promisify(execFile);

export interface SnapshotEntry {
  /** git commit hash，恢复时用 */
  readonly id: string;
  /** 操作描述，如"入库前快照：第12章" */
  readonly label: string;
  /** epoch 秒 */
  readonly timestamp: number;
}

const LOG_FORMAT = "%H\t%ct\t%s";

async function git(projectDir: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(resolveGitCommand(), [
    "-C",
    projectDir,
    // 中文等非 ASCII 路径按原样输出，否则 diff --name-only 会给出八进制转义+引号
    "-c",
    "core.quotepath=false",
    // 隔离用户全局 gitconfig：开了 commit 签名会导致提交挂起
    "-c",
    "commit.gpgsign=false",
    ...args,
  ]);
  return stdout.trim();
}

async function withProjectLock<T>(projectDir: string, fn: () => Promise<T>): Promise<T> {
  return withProjectCommitLock(projectDir, fn);
}

function parseLogLine(line: string): SnapshotEntry {
  const [id, ts, ...rest] = line.split("\t");
  return { id: id ?? "", timestamp: Number(ts ?? 0), label: rest.join("\t") };
}

/** 不加锁的内部版本，供已持锁的导出函数复用，避免同模块重入死锁。 */
async function ensureRepoUnlocked(projectDir: string): Promise<void> {
  try {
    await access(join(projectDir, ".git"));
    return;
  } catch {
    // 还不是仓库，初始化
  }
  await git(projectDir, ["init"]);
  await git(projectDir, ["config", "user.name", "StoryEngine"]);
  await git(projectDir, ["config", "user.email", "snapshot@story-engine.local"]);
  await git(projectDir, ["add", "-A"]);
  await git(projectDir, ["commit", "--allow-empty", "-m", "初始快照"]);
}

export async function ensureSnapshotRepo(projectDir: string): Promise<void> {
  return withProjectLock(projectDir, () => ensureRepoUnlocked(projectDir));
}

/** 不加锁的内部版本，供已持锁的导出函数复用（调用方须已 withProjectLock + ensureRepoUnlocked）。 */
async function createSnapshotUnlocked(projectDir: string, label: string): Promise<SnapshotEntry> {
  await git(projectDir, ["add", "-A"]);
  await git(projectDir, ["commit", "--allow-empty", "-m", label]);
  return parseLogLine(await git(projectDir, ["log", "-1", `--pretty=format:${LOG_FORMAT}`]));
}

/** 写入前调用：把当前全部状态存为一个快照。 */
export async function createSnapshot(projectDir: string, label: string): Promise<SnapshotEntry> {
  return withProjectLock(projectDir, async () => {
    await recoverProjectCommitTransactions(projectDir);
    await ensureRepoUnlocked(projectDir);
    return createSnapshotUnlocked(projectDir, label);
  });
}

/**
 * 原子地「建快照 + 执行落盘」：把 createSnapshot 与紧随其后的写操作 fn 罩进同一 project 锁，
 * 令二者成为一个不可分割的临界区——治撤销竞态。
 *
 * 旧 withSnapshot 是「createSnapshot（持锁、原子）→ run（锁外落盘）」：快照边界与落盘不在同一临界区，
 * 同一 project 并发时，另一操作的 createSnapshot/restoreSnapshot 会切进 run 中间 → 捕获不一致的部分态、
 * 或撤销逃逸/过度回滚（线性快照史被并发打乱）。本函数把写操作纳入同一把锁，彻底消除该窗口；
 * 撤销（restoreSnapshot 同走 withProjectLock）也会排在写之后，不再插进写中间。
 *
 * The canonical project lock is re-entrant, so formal-commit code may safely
 * call engine operations while this snapshot boundary remains held.
 */
export async function runWithSnapshot<T>(
  projectDir: string,
  label: string,
  fn: (snapshotId: string) => Promise<T>,
): Promise<{ readonly snapshot: SnapshotEntry; readonly result: T }> {
  return withProjectLock(projectDir, async () => {
    await recoverProjectCommitTransactions(projectDir);
    await ensureRepoUnlocked(projectDir);
    const snapshot = await createSnapshotUnlocked(projectDir, label);
    const result = await fn(snapshot.id);
    // 落盘收尾（afterfix #2）：把 fn 写出的文件即时收进 git，令工作树在每次写操作后保持干净——否则最后一次
    // 写操作的产物会长期以 dirty/untracked 残留（Codex 三轮误判「入库已完成但 git 还脏=没写盘」）。
    // 这条 commit 标成「落盘收尾」产物：undo 与操作历史都跳过它（isUndoSkippableArtifact / 路由过滤），
    // 撤销目标仍是 fn 之前的 `snapshot`、撤销语义完全不变。无改动则不建（避免空 commit 噪声）。
    if (await hasUncommittedChanges(projectDir)) {
      await createSnapshotUnlocked(projectDir, `${POST_WRITE_LABEL_PREFIX}${label}`);
    }
    return { snapshot, result };
  });
}

export async function listSnapshots(projectDir: string, limit = 100): Promise<SnapshotEntry[]> {
  return withProjectLock(projectDir, async () => {
    await ensureRepoUnlocked(projectDir);
    const out = await git(projectDir, ["log", `-${limit}`, `--pretty=format:${LOG_FORMAT}`]);
    return out ? out.split("\n").map(parseLogLine) : [];
  });
}

/**
 * 恢复到目标快照。先校验目标存在，再把当前状态自动存档（可反悔），
 * 然后删掉目标之后新增的文件、还原全部内容，最后记一条"恢复到：X"。
 * 历史永不丢失，恢复操作本身也能被恢复。
 */
export async function restoreSnapshot(projectDir: string, id: string): Promise<SnapshotEntry> {
  return withProjectLock(projectDir, async () => {
    if (!/^[0-9a-f]{40}$/.test(id)) {
      throw new Error("无效的快照 id");
    }
    // Recovery must happen before git add/commit/checkout; otherwise a partial
    // formal transaction becomes part of the pre-restore history and may be
    // resurrected by a later undo.
    await recoverProjectCommitTransactions(projectDir);
    await ensureRepoUnlocked(projectDir);
    // 先解析目标：失败即抛，不污染历史
    const target = parseLogLine(await git(projectDir, ["log", "-1", `--pretty=format:${LOG_FORMAT}`, id]));
    await git(projectDir, ["add", "-A"]);
    await git(projectDir, ["commit", "--allow-empty", "-m", "恢复前自动快照"]);
    // --no-renames：禁用 rename 侦测，改名产生的新文件按 A 计，否则会被判为 R 而残留
    const addedSince = await git(projectDir, ["diff", "--name-only", "--no-renames", "--diff-filter=A", `${id}..HEAD`]);
    for (const file of addedSince.split("\n").filter(Boolean)) {
      await unlink(join(projectDir, file)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    await git(projectDir, ["checkout", id, "--", "."]);
    await git(projectDir, ["add", "-A"]);
    await git(projectDir, ["commit", "--allow-empty", "-m", `恢复到：${target.label}`]);
    return parseLogLine(await git(projectDir, ["log", "-1", `--pretty=format:${LOG_FORMAT}`]));
  });
}

/** 撤销操作自身写下的两条 commit（恢复前自动快照 / 恢复到：…）——逐步撤销时要跳过、否则卡在原地。 */
function isRestoreArtifact(label: string): boolean {
  return label.startsWith("恢复到：") || label === "恢复前自动快照";
}

/**
 * 落盘收尾 commit 前缀（afterfix #2）：runWithSnapshot 在写操作后把产物即时收进 git 的那条工程 commit。
 * 它内容==当时工作树（本就无差异、会被 undo 的 differing 判定跳过），但 undo 回退后工作树会变——届时它会「有差异」、
 * 可能被误当撤销目标（变成重做）；故显式纳入 undo 跳过名单。操作历史也据此过滤、不显这条工程 commit。
 */
const POST_WRITE_LABEL_PREFIX = "落盘收尾：";
export function isPostWriteSettlementSnapshot(label: string): boolean {
  return label.startsWith(POST_WRITE_LABEL_PREFIX);
}

/** 逐步撤销时要跳过的工程产物：恢复产物 + 落盘收尾 commit。 */
function isUndoSkippableArtifact(label: string): boolean {
  return isRestoreArtifact(label) || isPostWriteSettlementSnapshot(label);
}

/** 工作树是否有未跟踪文件（工具新写的草稿/资料在下一次快照前是 untracked，git diff 看不到，须单独探）。 */
async function hasUntrackedFiles(projectDir: string): Promise<boolean> {
  const out = await git(projectDir, ["ls-files", "--others", "--exclude-standard"]);
  return out.length > 0;
}

/** 工作树是否有任何未提交改动（含未跟踪文件）——决定写操作后是否需要补一条落盘收尾 commit。 */
async function hasUncommittedChanges(projectDir: string): Promise<boolean> {
  const out = await git(projectDir, ["status", "--porcelain"]);
  return out.trim().length > 0;
}

/** 快照 id 的内容是否与当前工作树不同（含未跟踪文件：有 untracked 即视为不同——比任何已提交快照都多东西）。 */
async function snapshotDiffersFromWorkingTree(projectDir: string, id: string, untracked: boolean): Promise<boolean> {
  if (untracked) return true;
  try {
    await git(projectDir, ["diff", "--quiet", id, "--"]);
    return false; // exit 0：无差异
  } catch {
    return true; // 非零：有差异
  }
}

const UNDO_TOOL_LABELS: Record<string, string> = {
  commit_apply: "定稿",
  foundation_write: "更新故事资料",
  generate_draft: "出稿",
  revise_draft: "修改草稿",
  generate_chapter_steering: "章节方向",
  generate_worldbuilding: "完善世界观",
  generate_character_enrichment: "完善角色",
  generate_asset_enrichment: "完善道具与资源",
  generate_location_enrichment: "完善地点",
  generate_matrix_enrichment: "完善角色关系",
  generate_character_relationships: "完善人物关系",
  generate_writing_rules_enrichment: "重新整理写作规则",
  generate_alias_table: "完善别名表",
  edit_fact_ledger: "记录故事事实",
  set_foreshadowing_importance: "伏笔重要度",
  resolve_thread: "线索收口",
  clean_legacy_threads: "线索清理",
  group_related_leads: "线索归并",
};

/**
 * 把快照 label（agent:<toolId> / 恢复产物 / 自定义）转成给用户看的中文动作名。
 * 操作历史面板经路由层用它把原始 git subject 人话化（snapshots.ts），undo 也用它回报。
 * 恢复产物形如「恢复到：agent:commit_apply」——前缀剥开后对内层再 humanize，杜绝中间露出 agent: 工程标签。
 */
export function humanizeUndoLabel(label: string): string {
  const restoreMatch = /^恢复到：(.+)$/u.exec(label);
  if (restoreMatch) return `恢复到：${humanizeUndoLabel(restoreMatch[1]!)}`;
  const match = /^agent:(.+)$/u.exec(label);
  if (match) {
    // 标签可带细节后缀：agent:<tool>:<detail>（如 agent:foundation_write:建角色 顾长风）。
    // 按**首个**冒号拆，tool 人话化 + 带上细节，让操作历史能分辨同类多次写入（rerun2 P2：几十条「资料写入」不可辨）。
    const rest = match[1]!;
    const sep = rest.indexOf(":");
    const tool = sep >= 0 ? rest.slice(0, sep) : rest;
    const detail = sep >= 0 ? rest.slice(sep + 1).trim() : "";
    const base = UNDO_TOOL_LABELS[tool] ?? tool;
    return detail ? `${base}：${detail}` : base;
  }
  return label;
}

/**
 * 撤销「上一步真实改动」：恢复到最近一个『内容与当前工作树不同、且非撤销产物』的检查点。
 * 每个 agent 写操作前都建检查点（runWithSnapshot/createSnapshot），故恢复到最近一个 differing 检查点即撤销上一步；
 * 跳过恢复操作自身的产物，使「连续撤销」逐步回退、不卡在原地。无可撤销改动 → null（诚实，调用方据此如实回报）。
 * restoreSnapshot 会先存档当前态，故「撤销」本身也能被再撤销，历史永不丢。
 */
export async function undoLastChange(
  projectDir: string,
): Promise<{ readonly undoneLabel: string; readonly restored: SnapshotEntry } | null> {
  await ensureSnapshotRepo(projectDir);
  const snaps = await listSnapshots(projectDir, 200);
  const untracked = await hasUntrackedFiles(projectDir);
  let target: SnapshotEntry | undefined;
  for (const snap of snaps) {
    if (isUndoSkippableArtifact(snap.label)) continue;
    if (await snapshotDiffersFromWorkingTree(projectDir, snap.id, untracked)) {
      target = snap;
      break;
    }
  }
  if (!target) return null;
  const restored = await restoreSnapshot(projectDir, target.id);
  return { undoneLabel: humanizeUndoLabel(target.label), restored };
}
