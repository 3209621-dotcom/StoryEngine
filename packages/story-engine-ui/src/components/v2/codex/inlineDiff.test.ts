import { describe, expect, it } from "vitest";

import { diffChars } from "./inlineDiff.js";

describe("diffChars", () => {
  it("相同文本：全是 equal，拼回原文", () => {
    const segs = diffChars("你好世界", "你好世界");
    expect(segs).toEqual([{ type: "equal", text: "你好世界" }]);
  });

  it("中间替换：相等段 + 删除段 + 新增段，且能各自还原", () => {
    const segs = diffChars("声音像在念例行通报", "语调像在宣读例行通报");
    // equal 拼回的应是两边的公共子序列；del 拼回=改写前独有；add 拼回=改写后独有。
    const del = segs.filter((s) => s.type === "del").map((s) => s.text).join("");
    const add = segs.filter((s) => s.type === "add").map((s) => s.text).join("");
    const beforeRebuilt = segs.filter((s) => s.type !== "add").map((s) => s.text).join("");
    const afterRebuilt = segs.filter((s) => s.type !== "del").map((s) => s.text).join("");
    expect(beforeRebuilt).toBe("声音像在念例行通报");
    expect(afterRebuilt).toBe("语调像在宣读例行通报");
    expect(del).toContain("声音");
    expect(add).toContain("语调");
  });

  it("纯新增：只在末尾补字", () => {
    const segs = diffChars("南山区一家医疗器械商的账", "南山区一家医疗器械商的账户");
    expect(segs.filter((s) => s.type !== "del").map((s) => s.text).join("")).toBe("南山区一家医疗器械商的账户");
    expect(segs.some((s) => s.type === "add" && s.text === "户")).toBe(true);
  });

  it("超长文本走兜底：整删整增，不跑 DP", () => {
    const before = "甲".repeat(2500);
    const after = "乙".repeat(2500);
    const segs = diffChars(before, after);
    expect(segs).toEqual([
      { type: "del", text: before },
      { type: "add", text: after },
    ]);
  });
});
