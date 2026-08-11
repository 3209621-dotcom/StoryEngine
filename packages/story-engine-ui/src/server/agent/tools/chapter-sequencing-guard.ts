/**
 * 章序护栏（防穿帮）。
 *
 * 工程事实（2026-06-18 核查）：入库（commit）一章会把它的跨章状态——人物状态/伏笔/线程/弧线目标/
 * 世界状态/时间线——写进故事文件；下一章生成时读的是这些**已入库**状态。所以「前一章还没入库就写
 * 下一章」会让下一章读到旧的结构化状态 → 前后穿帮。
 *
 * 因此默认拦下「跳过未入库前章去写后章」（强护栏）；但不是死墙——用户知情后明确选「仍要写」时，
 * 调用方带 allowWriteAhead=true 再调一次即放行（可知情 override）。
 *
 * 纯逻辑、无副作用、题材中立：FS 检查（前章是否已入库）由调用方算好后传进来。
 */

export interface ChapterSequencingGuardInput {
  readonly chapter: number;
  /** 用户知情后明确选「仍要写」→ true 放行。 */
  readonly allowWriteAhead: boolean;
  /** 前一章（chapter-1）是否已入库（调用方按 chapters/*.md 是否存在算好）。 */
  readonly priorChapterCommitted: boolean;
}

export interface ChapterSequencingGuardResult {
  readonly blocked: boolean;
  /** 被拦时，建议先入库的那一章（= chapter-1）。 */
  readonly pendingChapterToCommit?: number;
}

export function evaluateChapterSequencingGuard(input: ChapterSequencingGuardInput): ChapterSequencingGuardResult {
  // 第 1 章没有前章；知情 override；前章已入库——都放行。
  if (input.chapter <= 1 || input.allowWriteAhead || input.priorChapterCommitted) {
    return { blocked: false };
  }
  return { blocked: true, pendingChapterToCommit: input.chapter - 1 };
}
