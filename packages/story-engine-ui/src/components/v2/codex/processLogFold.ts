/**
 * P1-9：一轮 assistant 里多条「AI 分析 / AI 操作记录」默认聚合成一行。
 * 纯函数；进行中轮次由调用方传 aggregate=false，保持逐步金光。
 */
import type { ToolStep } from "../../../api/types.js";
import type { RenderSegment } from "./messageSegments.js";

export type ProcessFoldStep =
  | { readonly kind: "reasoning"; readonly text: string }
  | { readonly kind: "tool"; readonly step: ToolStep };

export type FoldedRenderItem =
  | { readonly kind: "process"; readonly steps: readonly ProcessFoldStep[] }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "reasoning"; readonly text: string }
  | { readonly kind: "tool"; readonly step: ToolStep };

/**
 * 已完成轮次：连续 reasoning/tool 聚成一条 process（≥2 步才折）；
 * 进行中 / 仅 1 步：保持逐步展开，不丢渲染。
 */
export function foldProcessSegments(
  segments: readonly RenderSegment[],
  options: { readonly aggregate: boolean },
): readonly FoldedRenderItem[] {
  if (!options.aggregate) {
    return segments.map((seg) => {
      if (seg.kind === "reasoning") return { kind: "reasoning" as const, text: seg.text };
      if (seg.kind === "tool") return { kind: "tool" as const, step: seg.step };
      return { kind: "text" as const, text: seg.text };
    });
  }

  const out: FoldedRenderItem[] = [];
  let batch: ProcessFoldStep[] = [];

  const flush = (): void => {
    if (batch.length === 0) return;
    if (batch.length === 1) {
      const only = batch[0]!;
      out.push(only.kind === "reasoning"
        ? { kind: "reasoning", text: only.text }
        : { kind: "tool", step: only.step });
    } else {
      out.push({ kind: "process", steps: batch });
    }
    batch = [];
  };

  for (const seg of segments) {
    if (seg.kind === "reasoning") {
      batch.push({ kind: "reasoning", text: seg.text });
      continue;
    }
    if (seg.kind === "tool") {
      batch.push({ kind: "tool", step: seg.step });
      continue;
    }
    flush();
    out.push({ kind: "text", text: seg.text });
  }
  flush();
  return out;
}

/** 无 segments 的旧三桶路径：thinking + tools → 是否该聚合。 */
export function shouldAggregateProcessBucket(
  thinking: string | undefined,
  toolCount: number,
  aggregate: boolean,
): boolean {
  if (!aggregate) return false;
  const think = Boolean(thinking?.trim());
  const n = (think ? 1 : 0) + toolCount;
  return n >= 2;
}

/** 是否对本条助手消息做过程聚合：仅已完成轮次。 */
export function isCompletedTurnForProcessFold(
  chatLoading: boolean,
  isLiveAssistant: boolean,
): boolean {
  return !(chatLoading && isLiveAssistant);
}
