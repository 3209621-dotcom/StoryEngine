// @vitest-environment node
//
// 反复出场未建卡角色备忘：50 章耐力跑实测老陈/老赵贯穿全书仍无卡——每章一句软提醒没人接茬，
// 需要「多章达阈值→升级点名一次」的确定性机制。建卡本身仍等用户点头（唯一控制面）。
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  appendRecurringUncardedToSummary,
  RECURRING_UNCARDED_THRESHOLD,
  uncardedCharacterMemoPath,
  updateUncardedCharacterMemo,
} from "./uncarded-character-memo.js";

async function tmpProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "uncarded-memo-"));
}

describe("updateUncardedCharacterMemo", () => {
  it("同一名字跨章累积，达到阈值那章升级点名一次；之后不再重复", async () => {
    const dir = await tmpProject();
    expect(await updateUncardedCharacterMemo(dir, 5, ["老陈"])).toEqual([]);
    expect(await updateUncardedCharacterMemo(dir, 6, ["老陈"])).toEqual([]);
    // 第 3 个不同章 → 达阈值，点名
    expect(await updateUncardedCharacterMemo(dir, 7, ["老陈"])).toEqual(["老陈"]);
    // 已点过名 → 之后每章不再重复
    expect(await updateUncardedCharacterMemo(dir, 8, ["老陈"])).toEqual([]);
    expect(await updateUncardedCharacterMemo(dir, 9, ["老陈"])).toEqual([]);
  });

  it("同章重复出现只记一次；不同名字互不影响", async () => {
    const dir = await tmpProject();
    await updateUncardedCharacterMemo(dir, 5, ["老陈", "老陈", "老赵"]);
    await updateUncardedCharacterMemo(dir, 5, ["老陈"]); // 同章重复调用
    await updateUncardedCharacterMemo(dir, 6, ["老陈"]);
    // 老陈只累积了 2 个不同章（5、6），未达阈值
    expect(await updateUncardedCharacterMemo(dir, 6, ["老赵"])).toEqual([]);
    const escalated = await updateUncardedCharacterMemo(dir, 7, ["老陈", "老赵"]);
    expect(escalated).toEqual(["老陈", "老赵"]); // 双双第 3 章达阈值
  });

  it("names 为空 → 零 IO 直接返回，不产生备忘文件", async () => {
    const dir = await tmpProject();
    expect(await updateUncardedCharacterMemo(dir, 3, [])).toEqual([]);
    await expect(readFile(uncardedCharacterMemoPath(dir), "utf-8")).rejects.toThrow();
  });

  it("备忘文件损坏 → 从零开始，不崩、不影响入库", async () => {
    const dir = await tmpProject();
    const path = uncardedCharacterMemoPath(dir);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{broken json", "utf-8");
    expect(await updateUncardedCharacterMemo(dir, 1, ["某人"])).toEqual([]);
  });

  it("阈值常量与行为一致（防止改常量忘改逻辑）", async () => {
    const dir = await tmpProject();
    let escalated: readonly string[] = [];
    for (let ch = 1; ch <= RECURRING_UNCARDED_THRESHOLD; ch++) {
      escalated = await updateUncardedCharacterMemo(dir, ch, ["甲"]);
    }
    expect(escalated).toEqual(["甲"]);
  });
});

describe("appendRecurringUncardedToSummary", () => {
  it("空名单原样返回；有名单折进摘要且面向用户（无工具名）", () => {
    expect(appendRecurringUncardedToSummary("第 7 章已定稿。", [])).toBe("第 7 章已定稿。");
    const out = appendRecurringUncardedToSummary("第 7 章已定稿。", ["老陈", "老赵"]);
    expect(out).toContain("「老陈」、「老赵」");
    expect(out).toContain("给老陈建卡");
    expect(out).not.toMatch(/generate_character|foundation_write|char-[a-f0-9]/u);
  });
});
