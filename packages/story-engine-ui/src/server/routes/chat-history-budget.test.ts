/**
 * R3：setBudget 严格读 + 原子写（避免读失败把 providers 整文件冲掉）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateChatHistoryBudgetTokens } from "./chat-sessions.js";

describe("updateChatHistoryBudgetTokens（R3）", () => {
  let dir: string;
  const original = process.env.SE_DATA_DIR;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "se-budget-"));
    process.env.SE_DATA_DIR = dir;
  });
  afterEach(async () => {
    if (original === undefined) delete process.env.SE_DATA_DIR;
    else process.env.SE_DATA_DIR = original;
    await rm(dir, { recursive: true, force: true });
  });

  it("文件缺失 → 新建且只含 budget", async () => {
    await updateChatHistoryBudgetTokens(12000);
    const raw = await readFile(join(dir, "model-settings.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual({ chatHistoryBudgetTokens: 12000 });
  });

  it("文件存在 → 其它字段保留、budget 更新", async () => {
    await writeFile(
      join(dir, "model-settings.json"),
      `${JSON.stringify({ version: 1, providers: { main: { id: "main" } }, chatHistoryBudgetTokens: 1000 }, null, 2)}\n`,
      "utf-8",
    );
    await updateChatHistoryBudgetTokens(24000);
    const parsed = JSON.parse(await readFile(join(dir, "model-settings.json"), "utf-8")) as Record<string, unknown>;
    expect(parsed.chatHistoryBudgetTokens).toBe(24000);
    expect(parsed.version).toBe(1);
    expect(parsed.providers).toEqual({ main: { id: "main" } });
  });

  it("坏 JSON → 抛错且原文件内容原样未动", async () => {
    const broken = "{ not-json";
    await writeFile(join(dir, "model-settings.json"), broken, "utf-8");
    await expect(updateChatHistoryBudgetTokens(5000)).rejects.toThrow(/为避免覆盖现有模型配置，本次未保存/);
    expect(await readFile(join(dir, "model-settings.json"), "utf-8")).toBe(broken);
  });

  it("解析出来不是对象 → 抛错且原文件未动", async () => {
    const arr = "[1,2,3]";
    await writeFile(join(dir, "model-settings.json"), arr, "utf-8");
    await expect(updateChatHistoryBudgetTokens(5000)).rejects.toThrow(/为避免覆盖现有模型配置，本次未保存/);
    expect(await readFile(join(dir, "model-settings.json"), "utf-8")).toBe(arr);
  });
});
