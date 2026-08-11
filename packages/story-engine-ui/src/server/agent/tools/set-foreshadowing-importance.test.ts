// @vitest-environment node
//
// set_foreshadowing_importance 纯逻辑单测：
// 写 override 后读回、再次覆盖为 minor、非法 importance 处理。
// 使用临时目录，不依赖真实项目或 snapshot。

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FORESHADOWING_OVERRIDES_RELATIVE_PATH,
  setForeshadowingImportanceLogic,
} from "./set-foreshadowing-importance.js";

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "set-foreshadowing-test-"));
  // 修 P2·3：工具现在校验 id 真存在于 hooks/threads，故 seed 测试用到的真 hook/thread。
  await mkdir(join(dir, "story"), { recursive: true });
  await writeFile(
    join(dir, "story", "hooks.json"),
    JSON.stringify({ hooks: [
      ...["hook-1", "hook-2", "hook-a", "hook-exists-dir"].map((id) => ({ id, title: id, firstSeenChapter: 1, status: "active" })),
      { id: "hook-letter", title: "神秘的匿名信", firstSeenChapter: 1, status: "active" }, // title ≠ id：验 summary 用标题
      { id: "hook-blank", title: "", firstSeenChapter: 1, status: "active" }, // title 空（旧书/损坏）：验回落中性词而非裸 id
    ] }),
    "utf-8",
  );
  await writeFile(
    join(dir, "story", "threads.json"),
    JSON.stringify({ threads: [{ id: "thread-b", type: "lead", title: "thread-b", status: "open", firstSeenChapter: 1, lastTouchedChapter: 1 }] }),
    "utf-8",
  );
  return dir;
}

describe("set_foreshadowing_importance logic", () => {
  it("写入 major override 后落盘能读回", async () => {
    const projectDir = await tempDir();

    const result = await setForeshadowingImportanceLogic({
      projectDir,
      id: "hook-1",
      importance: "major",
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("大伏笔");

    const raw = await readFile(join(projectDir, FORESHADOWING_OVERRIDES_RELATIVE_PATH), "utf-8");
    const overrides = JSON.parse(raw) as Record<string, string>;
    expect(overrides["hook-1"]).toBe("major");
  });

  it("再次 set 同 id 为 minor 时覆盖成功", async () => {
    const projectDir = await tempDir();

    await setForeshadowingImportanceLogic({ projectDir, id: "hook-2", importance: "major" });
    const result = await setForeshadowingImportanceLogic({ projectDir, id: "hook-2", importance: "minor" });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("小线索");

    const raw = await readFile(join(projectDir, FORESHADOWING_OVERRIDES_RELATIVE_PATH), "utf-8");
    const overrides = JSON.parse(raw) as Record<string, string>;
    expect(overrides["hook-2"]).toBe("minor");
  });

  it("多个 id 写入后各自保留", async () => {
    const projectDir = await tempDir();

    await setForeshadowingImportanceLogic({ projectDir, id: "hook-a", importance: "major" });
    await setForeshadowingImportanceLogic({ projectDir, id: "thread-b", importance: "minor" });

    const raw = await readFile(join(projectDir, FORESHADOWING_OVERRIDES_RELATIVE_PATH), "utf-8");
    const overrides = JSON.parse(raw) as Record<string, string>;
    expect(overrides["hook-a"]).toBe("major");
    expect(overrides["thread-b"]).toBe("minor");
  });

  it("已有 .story-engine-ui 目录时正常写入", async () => {
    const projectDir = await tempDir();
    await mkdir(join(projectDir, ".story-engine-ui"), { recursive: true });

    const result = await setForeshadowingImportanceLogic({
      projectDir,
      id: "hook-exists-dir",
      importance: "minor",
    });

    expect(result.ok).toBe(true);
    const raw = await readFile(join(projectDir, FORESHADOWING_OVERRIDES_RELATIVE_PATH), "utf-8");
    const overrides = JSON.parse(raw) as Record<string, string>;
    expect(overrides["hook-exists-dir"]).toBe("minor");
  });

  it("空 id 返回 ok:false", async () => {
    const projectDir = await tempDir();

    const result = await setForeshadowingImportanceLogic({
      projectDir,
      id: "",
      importance: "major",
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toBeTruthy();
  });

  it("修 P2·3：id 不存在于任何 hook/thread → ok:false（不再谎报『已标记』但页面无变化）", async () => {
    const projectDir = await tempDir();
    const result = await setForeshadowingImportanceLogic({
      projectDir,
      id: "hook-根本不存在",
      importance: "major",
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/没找到/);
    // 没写覆盖文件（不存在的 id 不该落盘）
    await expect(readFile(join(projectDir, FORESHADOWING_OVERRIDES_RELATIVE_PATH), "utf-8")).rejects.toThrow();
  });

  // 模型无关·canonical key：模型/网关常给 id 带尾换行/空格。校验过关但若写带空白键，展示按 canonical
  // 查不到 → 页面不变却 ok:true（标了等于没标）。修后：写盘/summary 全用 trim 后的 key。
  it("id 带前后空白 → 写进 canonical 键（不带空白）、不谎报", async () => {
    const projectDir = await tempDir();
    const result = await setForeshadowingImportanceLogic({ projectDir, id: "  hook-1  ", importance: "major" });
    expect(result.ok).toBe(true);
    const raw = await readFile(join(projectDir, FORESHADOWING_OVERRIDES_RELATIVE_PATH), "utf-8");
    const overrides = JSON.parse(raw) as Record<string, string>;
    expect(overrides["hook-1"]).toBe("major"); // canonical 键
    expect(overrides["  hook-1  "]).toBeUndefined(); // 不写带空白的脏键
  });

  // 模型无关·绝不泄露裸 id：成功摘要用 hook 标题，不是裸 hook-id。
  it("成功摘要用伏笔标题而非裸 id", async () => {
    const projectDir = await tempDir();
    const result = await setForeshadowingImportanceLogic({ projectDir, id: "hook-letter", importance: "major" });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("神秘的匿名信");
    expect(result.summary).not.toContain("hook-letter");
  });

  // 低危残漏修复：hook 标题为空（旧书/损坏数据）时，成功摘要用中性词而非回落裸 id。
  it("hook 标题为空 → 成功摘要用中性词「这条」，不泄露裸 hook id", async () => {
    const projectDir = await tempDir();
    const result = await setForeshadowingImportanceLogic({ projectDir, id: "hook-blank", importance: "minor" });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("这条");
    expect(result.summary).not.toContain("hook-blank");
  });

  // 读失败（损坏文件/权限）≠「id 不存在」：旧 .catch(()=>空) 把读错塌成空表、误判合法 id 不存在。
  it("hooks 资料读失败（损坏 JSON）→ ok:false 且原因是『核对资料失败』，不误判成『没找到 id』", async () => {
    const projectDir = await tempDir();
    await writeFile(join(projectDir, "story", "hooks.json"), "{ 这不是合法 JSON", "utf-8");
    const result = await setForeshadowingImportanceLogic({ projectDir, id: "thread-b", importance: "major" });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("核对");
    expect(result.summary).not.toMatch(/没找到 id/);
  });
});
