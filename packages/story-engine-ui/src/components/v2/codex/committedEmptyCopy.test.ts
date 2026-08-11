import { describe, expect, it } from "vitest";

import {
  committedEmptySubtitle,
  committedEmptyTitle,
  PREVIEW_COMMIT_INTENT,
} from "./committedEmptyCopy.js";

describe("committedEmptyCopy P0-2", () => {
  it("标题固定为「本章还没有定稿版」", () => {
    expect(committedEmptyTitle()).toBe("本章还没有定稿版");
  });

  it("有字数时副文案带（N 字）；0 字不带括号", () => {
    expect(committedEmptySubtitle(900)).toContain("（900 字）");
    expect(committedEmptySubtitle(900)).toContain("工作稿还在");
    expect(committedEmptySubtitle(0)).not.toContain("（");
    expect(committedEmptySubtitle(0)).toContain("工作稿还在");
  });

  it("预览入库意图走 commit_preview 话术", () => {
    expect(PREVIEW_COMMIT_INTENT).toMatch(/入库预览|预览/);
  });
});
