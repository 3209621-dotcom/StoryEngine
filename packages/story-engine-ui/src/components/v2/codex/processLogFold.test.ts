import { describe, expect, it } from "vitest";
import type { ToolStep } from "../../../api/types.js";
import {
  foldProcessSegments,
  isCompletedTurnForProcessFold,
  shouldAggregateProcessBucket,
} from "./processLogFold.js";
import type { RenderSegment } from "./messageSegments.js";

function tool(id: string): ToolStep {
  return { id, label: id, status: "completed", startedAt: 1, endedAt: 2, toolName: id };
}

describe("processLogFold", () => {
  it("进行中轮次不聚合", () => {
    expect(isCompletedTurnForProcessFold(true, true)).toBe(false);
    expect(isCompletedTurnForProcessFold(true, false)).toBe(true);
    expect(isCompletedTurnForProcessFold(false, true)).toBe(true);
  });

  it("已完成且 ≥2 过程段 → 聚成一条 process", () => {
    const segments: RenderSegment[] = [
      { kind: "reasoning", text: "想一下" },
      { kind: "tool", step: tool("t1") },
      { kind: "text", text: "答案" },
    ];
    const out = foldProcessSegments(segments, { aggregate: true });
    expect(out).toEqual([
      {
        kind: "process",
        steps: [
          { kind: "reasoning", text: "想一下" },
          { kind: "tool", step: tool("t1") },
        ],
      },
      { kind: "text", text: "答案" },
    ]);
  });

  it("仅 1 过程段 → 不折成 process 壳", () => {
    const segments: RenderSegment[] = [
      { kind: "tool", step: tool("only") },
      { kind: "text", text: "好" },
    ];
    expect(foldProcessSegments(segments, { aggregate: true })).toEqual([
      { kind: "tool", step: tool("only") },
      { kind: "text", text: "好" },
    ]);
  });

  it("aggregate=false 逐步透传", () => {
    const segments: RenderSegment[] = [
      { kind: "reasoning", text: "a" },
      { kind: "tool", step: tool("t") },
    ];
    expect(foldProcessSegments(segments, { aggregate: false })).toEqual(segments);
  });

  it("旧三桶：thinking+工具≥2 才聚合", () => {
    expect(shouldAggregateProcessBucket("想", 1, true)).toBe(true);
    expect(shouldAggregateProcessBucket(undefined, 2, true)).toBe(true);
    expect(shouldAggregateProcessBucket("想", 0, true)).toBe(false);
    expect(shouldAggregateProcessBucket("想", 1, false)).toBe(false);
  });
});
