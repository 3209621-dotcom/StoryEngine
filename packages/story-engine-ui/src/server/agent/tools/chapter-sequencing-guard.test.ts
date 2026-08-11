import { describe, expect, it } from "vitest";
import { evaluateChapterSequencingGuard } from "./chapter-sequencing-guard.js";

describe("evaluateChapterSequencingGuard", () => {
  it("第 1 章：没有前章，放行", () => {
    expect(evaluateChapterSequencingGuard({ chapter: 1, allowWriteAhead: false, priorChapterCommitted: false }))
      .toEqual({ blocked: false });
  });

  it("前一章已入库：顺序写，放行", () => {
    expect(evaluateChapterSequencingGuard({ chapter: 3, allowWriteAhead: false, priorChapterCommitted: true }))
      .toEqual({ blocked: false });
  });

  it("前一章未入库 + 没 override：拦下，建议先入库 chapter-1", () => {
    expect(evaluateChapterSequencingGuard({ chapter: 4, allowWriteAhead: false, priorChapterCommitted: false }))
      .toEqual({ blocked: true, pendingChapterToCommit: 3 });
  });

  it("前一章未入库 + 知情 override：放行（用户明确选仍要写）", () => {
    expect(evaluateChapterSequencingGuard({ chapter: 4, allowWriteAhead: true, priorChapterCommitted: false }))
      .toEqual({ blocked: false });
  });
});
