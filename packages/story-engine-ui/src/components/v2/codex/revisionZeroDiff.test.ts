import { describe, expect, it } from "vitest";

import { isRevisionZeroDiff } from "./revisionZeroDiff.js";

describe("isRevisionZeroDiff P0-3", () => {
  it("trim 后相等 → 零差异", () => {
    expect(isRevisionZeroDiff("  原文  ", "原文")).toBe(true);
    expect(isRevisionZeroDiff("未作修改。该片段无需修订。", "未作修改。该片段无需修订。")).toBe(true);
  });

  it("有实质改动 → 非零差异", () => {
    expect(isRevisionZeroDiff("他站在窗前。", "他站在落地窗前。")).toBe(false);
  });
});
