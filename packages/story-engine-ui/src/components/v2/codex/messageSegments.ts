/**
 * 把助手消息的有序分段（ChapterMessage.segments）+ 工具详情（toolSteps）解析成
 * codex 聊天「按真实时间顺序逐段渲染」的列表：想 → 调工具（内联在发生处）→ 再想 → 答。
 *
 * 纯函数、无 React 依赖（便于单测）。无 segments 的旧消息返回 null → 渲染端回退到原三桶渲染。
 */
import type { ChapterMessage } from "../../../types.js";
import type { ToolStep } from "../../../api/types.js";

export type RenderSegment =
  | { readonly kind: "reasoning"; readonly text: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly step: ToolStep };

/**
 * 解析渲染列表：
 * - reasoning / text：去空白后非空才保留（跳过纯空白增量段）。
 * - tool：按 toolCallId 在 toolSteps 里查实体；查不到（race / 旧数据）则跳过，不崩。
 * 返回 null 的两种情况都让渲染端**回退到三桶渲染**（不丢内容）：
 *   ① 消息没有 segments 字段（旧消息）；② segments 非空但全部解析为空（无可渲染项）。
 */
export function buildMessageRenderSegments(message: ChapterMessage): readonly RenderSegment[] | null {
  const segments = message.segments;
  if (!segments || segments.length === 0) return null;

  const steps = message.toolSteps ?? [];
  const out: RenderSegment[] = [];
  for (const segment of segments) {
    if (segment.kind === "tool") {
      const step = steps.find((s) => s.id === segment.toolCallId);
      if (step) out.push({ kind: "tool", step });
      continue;
    }
    if (segment.text.trim().length === 0) continue;
    out.push({ kind: segment.kind, text: segment.text });
  }
  return out.length > 0 ? out : null;
}
