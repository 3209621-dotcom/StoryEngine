import type { WritingRules } from "./types.js";

export type DraftLengthTargetSource = "user" | "writing_rules" | "default";

export type DraftLengthStatus = "below_lower_bound" | "within_range" | "above_upper_bound";

export interface DraftLengthTarget {
  readonly requested: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly source: DraftLengthTargetSource;
}

export interface DraftLengthReport {
  readonly requestedDraftLength: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly actualLength: number;
  readonly lengthStatus: DraftLengthStatus;
  readonly source: DraftLengthTargetSource;
  readonly retryReason?: Exclude<DraftLengthStatus, "within_range">;
  readonly finalLengthAfterTrim?: number;
  readonly whetherTrimmed: boolean;
}

export interface DraftLengthTrimResult {
  readonly ok: boolean;
  readonly draftBody: string;
  readonly finalLength: number;
}

export const DEFAULT_DRAFT_TARGET_WORDS = 1_800;

const MIN_DRAFT_TARGET_WORDS = 300;
const MAX_DRAFT_TARGET_WORDS = 30_000;
const MIN_DRAFT_MAX_OUTPUT_TOKENS = 360;
const MAX_DRAFT_MAX_OUTPUT_TOKENS = 4_096;

export function readRequestedDraftWordCount(text: string): number | undefined {
  const match = text.match(/(?:约|大约|左右|控制在|写到|写成|先写|写)?\s*(\d{3,5})\s*(?:字|个字|中文字符)/u);
  if (!match?.[1]) return undefined;
  return normalizeDraftLengthNumber(Number(match[1]));
}

export function resolveDraftLengthTarget(input: {
  readonly chapterGoal?: string;
  readonly requestedDraftLength?: number;
  readonly writingRules?: unknown;
}): DraftLengthTarget {
  const explicitTarget = normalizeDraftLengthNumber(input.requestedDraftLength)
    ?? (typeof input.chapterGoal === "string" ? readRequestedDraftWordCount(input.chapterGoal) : undefined);
  if (explicitTarget) return buildDraftLengthTarget(explicitTarget, "user");
  const writingRulesTarget = readWritingRulesTargetWords(input.writingRules);
  if (writingRulesTarget) return buildDraftLengthTarget(writingRulesTarget, "writing_rules");
  return buildDraftLengthTarget(DEFAULT_DRAFT_TARGET_WORDS, "default");
}

export function buildDraftLengthTarget(requested: number, source: DraftLengthTargetSource): DraftLengthTarget {
  const normalized = normalizeDraftLengthNumber(requested) ?? DEFAULT_DRAFT_TARGET_WORDS;
  const { lowerBound, upperBound } = requestedDraftLengthBounds(normalized);
  return { requested: normalized, source, lowerBound, upperBound };
}

export function requestedDraftLengthBounds(requested: number): { readonly lowerBound: number; readonly upperBound: number } {
  const upperBound = Math.ceil((requested * 115) / 100);
  const lowerBound = Math.max(MIN_DRAFT_TARGET_WORDS, Math.floor(requested * 0.85));
  return {
    lowerBound: Math.min(lowerBound, Math.max(1, upperBound - 1)),
    upperBound,
  };
}

export function applyDraftLengthConstraint(chapterGoal: string, lengthTarget: DraftLengthTarget): string {
  const sourceLabel = lengthTarget.source === "user"
    ? "用户明确要求"
    : lengthTarget.source === "writing_rules"
      ? "项目写作规则要求"
      : "系统默认章节目标";
  const { requested, lowerBound, upperBound } = lengthTarget;
  return [
    chapterGoal,
    "",
    `【本轮硬性字数要求】${sourceLabel}约 ${requested} 字，本次草稿必须遵守这个字数。正文不含标题必须控制在 ${lowerBound}-${upperBound} 个中文字符内。`,
    "不要提前收束，不要写成结局感；不要为了压缩字数跳过前情承接、动作推进、证据链和必要场景转换。",
    "如果接近上限，优先收束当前场景，不要开启新的大段剧情。",
  ].join("\n");
}

export function resolveDraftMaxOutputTokens(lengthTarget: DraftLengthTarget): number {
  return Math.max(
    MIN_DRAFT_MAX_OUTPUT_TOKENS,
    Math.min(MAX_DRAFT_MAX_OUTPUT_TOKENS, Math.ceil(lengthTarget.upperBound / 1.35) + 220),
  );
}

export function countDraftChineseCharacters(value: string): number {
  return (value.match(/[\u3400-\u9fff]/gu) ?? []).length;
}

export function buildDraftLengthReport(input: {
  readonly draftBody: string;
  readonly lengthTarget: DraftLengthTarget;
  readonly finalLengthAfterTrim?: number;
  readonly whetherTrimmed?: boolean;
}): DraftLengthReport {
  const actualLength = countDraftChineseCharacters(input.draftBody);
  const lengthStatus = assessDraftLengthStatus(actualLength, input.lengthTarget);
  return {
    requestedDraftLength: input.lengthTarget.requested,
    lowerBound: input.lengthTarget.lowerBound,
    upperBound: input.lengthTarget.upperBound,
    actualLength,
    lengthStatus,
    source: input.lengthTarget.source,
    ...(lengthStatus === "within_range" ? {} : { retryReason: lengthStatus }),
    ...(input.finalLengthAfterTrim !== undefined ? { finalLengthAfterTrim: input.finalLengthAfterTrim } : {}),
    whetherTrimmed: input.whetherTrimmed ?? false,
  };
}

export function buildFastDraftRetryPrompt(prompt: string, lengthTarget?: DraftLengthTarget): string {
  const lengthLine = lengthTarget
    ? [
      `- 正文长度继续遵守本轮硬性要求：约 ${lengthTarget.requested} 个中文字符；`,
      `- 正文不含标题必须控制在 ${lengthTarget.lowerBound}-${lengthTarget.upperBound} 个中文字符内；`,
      "- 不要重写成新故事，只补足必要动作、感官细节、证据链和承接段落；",
    ].join("\n")
    : "- 正文至少 1200 个中文字符；";
  return `${prompt}

上一次模型只返回了标题、极短内容或未满足字数范围，这次必须输出完整章节正文：
- 必须以 "# 第N章 · 标题" 开头；
- 标题之后必须继续写正文；
${lengthLine}
- 不要提前收束，不要写成结局感；
- 不要解释，不要道歉，不要只返回标题。`;
}

export function trimDraftBodyToLengthTarget(draftBody: string, lengthTarget: DraftLengthTarget): DraftLengthTrimResult {
  const normalized = draftBody.trim();
  if (!normalized) return { ok: false, draftBody: "", finalLength: 0 };
  const currentLength = countDraftChineseCharacters(normalized);
  if (currentLength <= lengthTarget.upperBound) {
    return {
      ok: currentLength >= lengthTarget.lowerBound,
      draftBody: normalized,
      finalLength: currentLength,
    };
  }

  const byParagraph = trimByParagraphs(normalized, lengthTarget);
  if (byParagraph.ok) return byParagraph;

  const bySentences = trimBySentences(normalized, lengthTarget);
  if (bySentences.ok) return bySentences;

  return trimByCjkBoundary(normalized, lengthTarget);
}

function assessDraftLengthStatus(actualLength: number, lengthTarget: DraftLengthTarget): DraftLengthStatus {
  if (actualLength < lengthTarget.lowerBound) return "below_lower_bound";
  if (actualLength > lengthTarget.upperBound) return "above_upper_bound";
  return "within_range";
}

function trimByParagraphs(draftBody: string, lengthTarget: DraftLengthTarget): DraftLengthTrimResult {
  const paragraphs = draftBody
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const selected: string[] = [];
  let total = 0;

  for (const paragraph of paragraphs) {
    const paragraphLength = countDraftChineseCharacters(paragraph);
    if (total >= lengthTarget.lowerBound && total + paragraphLength > lengthTarget.upperBound) break;
    if (total + paragraphLength > lengthTarget.upperBound) break;
    selected.push(paragraph);
    total += paragraphLength;
  }

  const draftBodyCandidate = selected.join("\n\n").trim();
  if (draftBodyCandidate && total >= lengthTarget.lowerBound && total <= lengthTarget.upperBound) {
    return { ok: true, draftBody: draftBodyCandidate, finalLength: total };
  }
  return { ok: false, draftBody: draftBodyCandidate, finalLength: total };
}

function trimBySentences(draftBody: string, lengthTarget: DraftLengthTarget): DraftLengthTrimResult {
  const chunks = draftBody
    .split(/(?<=[。！？!?；;])/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const selected: string[] = [];
  let total = 0;

  for (const chunk of chunks) {
    const chunkLength = countDraftChineseCharacters(chunk);
    if (total >= lengthTarget.lowerBound && total + chunkLength > lengthTarget.upperBound) break;
    if (total + chunkLength > lengthTarget.upperBound) break;
    selected.push(chunk);
    total += chunkLength;
  }

  const draftBodyCandidate = selected.join("").trim();
  if (draftBodyCandidate && total >= lengthTarget.lowerBound && total <= lengthTarget.upperBound) {
    return { ok: true, draftBody: draftBodyCandidate, finalLength: total };
  }
  return { ok: false, draftBody: draftBodyCandidate, finalLength: total };
}

function trimByCjkBoundary(draftBody: string, lengthTarget: DraftLengthTarget): DraftLengthTrimResult {
  let seen = 0;
  let result = "";
  for (const char of draftBody) {
    result += char;
    if (/[\u3400-\u9fff]/u.test(char)) seen += 1;
    if (seen >= lengthTarget.upperBound) break;
  }
  const draftBodyCandidate = result.trim();
  const finalLength = countDraftChineseCharacters(draftBodyCandidate);
  return {
    ok: Boolean(draftBodyCandidate) && finalLength >= lengthTarget.lowerBound && finalLength <= lengthTarget.upperBound,
    draftBody: draftBodyCandidate,
    finalLength,
  };
}

function readWritingRulesTargetWords(writingRules: unknown): number | undefined {
  if (!isRecord(writingRules)) return undefined;
  const chapterLength = isRecord(writingRules.chapterLength) ? writingRules.chapterLength : undefined;
  const rawValue = chapterLength?.targetWords
    ?? chapterLength?.maxWords
    ?? (writingRules as Partial<WritingRules> & { readonly targetChapterWords?: unknown; readonly targetWords?: unknown }).targetChapterWords
    ?? (writingRules as Partial<WritingRules> & { readonly targetChapterWords?: unknown; readonly targetWords?: unknown }).targetWords;
  const value = typeof rawValue === "number"
    ? rawValue
    : typeof rawValue === "string"
      ? Number.parseInt(rawValue.replace(/[^\d]/gu, ""), 10)
      : undefined;
  return normalizeDraftLengthNumber(value);
}

function normalizeDraftLengthNumber(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  if (normalized < MIN_DRAFT_TARGET_WORDS || normalized > MAX_DRAFT_TARGET_WORDS) return undefined;
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
