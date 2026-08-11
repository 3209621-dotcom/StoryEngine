import { describe, expect, it } from "vitest";

import { isRealDraftContent } from "./draftContent.js";

describe("isRealDraftContent（确定性只读按钮的真稿判定·#4）", () => {
  it("空/纯空白/undefined → 不是真稿", () => {
    expect(isRealDraftContent(undefined)).toBe(false);
    expect(isRealDraftContent("")).toBe(false);
    expect(isRealDraftContent("   \n  ")).toBe(false);
  });

  it("空草稿占位符（还没有草稿正文 / 还没有载入本章草稿正文 开头）→ 不是真稿", () => {
    expect(isRealDraftContent("还没有草稿正文。先点「写这一章」生成。")).toBe(false);
    expect(isRealDraftContent("  还没有载入本章草稿正文…")).toBe(false);
  });

  it("真实正文 → 是真稿", () => {
    expect(isRealDraftContent("# 第1章 · 雨夜\n\n暴雨敲打着旧泵站的铁皮屋顶……")).toBe(true);
    expect(isRealDraftContent("林澈推开门。")).toBe(true);
  });
});
