import type { AIReviewInput, AIReviewScope } from "./ai-reviewer.js";

export interface AIReviewerPromptContract {
  readonly version: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly responseSchema: unknown;
  readonly inputSummary: {
    readonly scope: string;
    readonly chapter?: number;
    readonly timelineEventCount: number;
    readonly hookCount: number;
    readonly threadCount: number;
    readonly intentDiagnosticsPresent: boolean;
    readonly intentDiagnosticItemCount: number;
    readonly cleanupVisibleIntentCount: number;
    readonly arcGoalCount: number;
    readonly tokenBudget: number;
  };
  readonly safetyRules: readonly string[];
}

export interface BuildAIReviewerPromptContractOptions {
  readonly tokenBudget?: number;
  readonly strictJson?: boolean;
  readonly includeExamples?: boolean;
}

const CONTRACT_VERSION = "ai-reviewer-prompt-contract-v1";
const DEFAULT_TOKEN_BUDGET = 4096;
const MAX_TIMELINE_EVENTS = 5;
const MAX_SEMANTIC_SUMMARIES = 5;
const MAX_HOOKS = 10;
const MAX_THREADS = 24;
const MAX_ARC_GOALS = 8;
const MAX_EVIDENCE = 3;
const MAX_TEXT_LENGTH = 160;
const ALLOWED_ACTIONS = [
  "mark_thread_done",
  "merge_threads",
  "drop_thread",
  "keep_thread",
  "prioritize_thread",
  "prioritize_hook",
  "prioritize_arc_goal",
  "create_repair_plan",
  "no_action",
] as const;

const ALLOWED_ISSUE_TYPES = [
  "thread_should_be_done",
  "thread_should_merge",
  "thread_should_drop",
  "stale_thread",
  "hook_stale",
  "arc_goal_drift",
  "continuity_risk",
  "possible_repetition",
  "state_conflict",
] as const;

const SAFETY_RULES = [
  "Analyze only the structured StoryEngine-NG state supplied in this prompt.",
  "Your first task is to identify safe, actionable maintenance suggestions.",
  "Do not rewrite chapter prose, draft new chapter text, or propose direct prose edits.",
  "Do not modify story state, files, timeline, hooks, threads, arc goals, world, characters, or calendar.",
  "Only return advisory JSON using the requested response schema.",
  "Intent lifecycle diagnostics are advisory-only visibility signals; they are not permission to mutate, confirm, mark done, merge, or drop state.",
  "Only suggest actions from the allowed action enum.",
  "Prefer concrete thread maintenance actions when evidence exists: mark_thread_done, merge_threads, then cautious drop_thread.",
  "Use prioritize_* only when no safe thread maintenance action exists; use no_action only when no safe issue exists.",
  "Never invent targetIds. Only use exact targetIds present in the structured input.",
  "Never request automatic apply or direct state writes; apply requires explicit human confirmation outside this review.",
  "Do not output credentials, tokens, environment values, or local machine paths.",
  "When uncertain, use no_action or lower confidence.",
] as const;

export function buildAIReviewerPromptContract(
  input: AIReviewInput,
  options: BuildAIReviewerPromptContractOptions = {},
): AIReviewerPromptContract {
  const tokenBudget = options.tokenBudget ?? input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const compactInput = compactAIReviewInput(input);
  const responseSchema = buildResponseSchema();
  const systemPrompt = [
    "You are the StoryEngine-NG AI Reviewer.",
    ...SAFETY_RULES,
    options.strictJson === true
      ? "Return strict JSON only. Do not wrap it in markdown fences or explanatory text."
      : "Return JSON only. Do not include markdown fences.",
  ].join("\n");
  const sections = [
    `Review scope: ${input.scope}`,
    input.chapter !== undefined ? `Chapter: ${input.chapter}` : undefined,
    `Token budget: ${tokenBudget}`,
    "",
    "Structured review input:",
    JSON.stringify(compactInput, null, 2),
    "",
    actionDecisionGuidance(),
    "",
    targetIdGuidance(),
    "",
    outputQuantityGuidance(),
    "",
    jsonOnlyGuidance(),
    "",
    `Allowed actions: ${ALLOWED_ACTIONS.join(", ")}`,
    `Allowed issue types: ${ALLOWED_ISSUE_TYPES.join(", ")}`,
    "",
    "Output JSON schema:",
    JSON.stringify(responseSchema, null, 2),
    "",
    "The full chapter body and full draft content are intentionally omitted. Use only the structured summaries above.",
    options.includeExamples === true ? promptExamples() : undefined,
  ].filter((line): line is string => line !== undefined);

  return {
    version: CONTRACT_VERSION,
    systemPrompt,
    userPrompt: sections.join("\n"),
    responseSchema,
    inputSummary: {
      scope: input.scope,
      ...(input.chapter !== undefined ? { chapter: input.chapter } : {}),
      timelineEventCount: compactInput.recentTimelineEvents.length,
      hookCount: compactInput.hooks.length,
      threadCount: compactInput.threads.length,
      intentDiagnosticsPresent: compactInput.intentDiagnostics !== undefined,
      intentDiagnosticItemCount: input.intentDiagnostics?.items.length ?? 0,
      cleanupVisibleIntentCount: input.intentDiagnostics?.summary.cleanupVisibleCount ?? 0,
      arcGoalCount: compactInput.arcGoals.length,
      tokenBudget,
    },
    safetyRules: SAFETY_RULES,
  };
}

function compactAIReviewInput(input: AIReviewInput): {
  readonly scope: AIReviewScope;
  readonly chapter?: number;
  readonly recentTimelineEvents: readonly unknown[];
  readonly semanticSummaries: readonly unknown[];
  readonly hooks: readonly unknown[];
  readonly threads: readonly unknown[];
  readonly intentDiagnostics?: unknown;
  readonly cleanupReviewCandidates: readonly unknown[];
  readonly arcGoals: readonly unknown[];
  readonly continuityQuality?: unknown;
  readonly candidateDiagnostics?: unknown;
} {
  return {
    scope: input.scope,
    ...(input.chapter !== undefined ? { chapter: input.chapter } : {}),
    recentTimelineEvents: compactList(input.recentTimelineEvents, MAX_TIMELINE_EVENTS),
    semanticSummaries: compactList(input.semanticSummaries, MAX_SEMANTIC_SUMMARIES),
    hooks: compactList(input.hookPool.hooks, MAX_HOOKS),
    threads: compactList(input.threadPool.threads, MAX_THREADS),
    ...(input.intentDiagnostics !== undefined ? { intentDiagnostics: compactUnknown(input.intentDiagnostics) } : {}),
    cleanupReviewCandidates: compactList(input.threadPool.selection?.cleanupReviewCandidates ?? [], MAX_THREADS),
    arcGoals: compactList(input.arcGoalPool.goals, MAX_ARC_GOALS),
    ...(input.continuityQuality !== undefined ? { continuityQuality: compactUnknown(input.continuityQuality) } : {}),
    ...(input.diagnostics !== undefined ? { candidateDiagnostics: compactUnknown(input.diagnostics) } : {}),
  };
}

function compactList(values: readonly unknown[], limit: number): readonly unknown[] {
  return values.slice(0, limit).map(compactUnknown);
}

function compactUnknown(value: unknown): unknown {
  if (typeof value === "string") return maskSensitiveValue(truncateText(value, MAX_TEXT_LENGTH));
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 12).map(compactUnknown);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !looksSensitiveKey(key) && !looksFullTextKey(key))
      .map(([key, item]) => [key, compactField(key, item)]));
  }
  return String(value);
}

function compactField(key: string, value: unknown): unknown {
  if (key === "evidence" && Array.isArray(value)) return value.slice(0, MAX_EVIDENCE).map(compactUnknown);
  if (key === "description" || key === "summary" || key === "title" || key === "mainEvent" || key === "chapterSummary") {
    return typeof value === "string" ? maskSensitiveValue(truncateText(value, MAX_TEXT_LENGTH)) : compactUnknown(value);
  }
  return compactUnknown(value);
}

function looksSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/gu, "");
  return [
    ["api", "key"].join(""),
    ["sec", "ret"].join(""),
    ["author", "ization"].join(""),
    ["bea", "rer"].join(""),
    "token",
    "password",
  ].some((needle) => normalized.includes(needle));
}

function looksFullTextKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/gu, "");
  return normalized === "body"
    || normalized === "content"
    || normalized === "draftcontent"
    || normalized === "chapterbody";
}

function maskSensitiveValue(value: string): string {
  return value
    .replace(new RegExp(["sk", "-"].join(""), "giu"), "[filtered]")
    .replace(new RegExp(["bea", "rer"].join(""), "giu"), "[filtered]")
    .replace(/\/Users\/[^/\s]+/gu, "/Users/[user]");
}

function buildResponseSchema(): unknown {
  return {
    type: "object",
    required: ["passed", "scope", "issues", "suggestions", "summary"],
    additionalProperties: false,
    properties: {
      passed: { type: "boolean" },
      scope: { enum: ["chapter", "window", "arc"] },
      issues: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "type", "severity", "evidence", "suggestion", "targetIds", "confidence"],
          properties: {
            id: { type: "string" },
            type: { enum: ALLOWED_ISSUE_TYPES },
            severity: { enum: ["info", "warning", "error"] },
            evidence: { type: "array", items: { type: "string" } },
            suggestion: { type: "string" },
            targetIds: { type: "array", items: { type: "string" } },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      suggestions: {
        type: "array",
        items: {
          type: "object",
          required: ["action", "targetIds", "reason", "confidence"],
          properties: {
            action: { enum: ALLOWED_ACTIONS },
            targetIds: { type: "array", items: { type: "string" } },
            reason: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      summary: { type: "string" },
    },
  };
}

function actionDecisionGuidance(): string {
  return [
    "Action decision guidance:",
    "- First consider concrete thread maintenance actions in this order: mark_thread_done, merge_threads, cautious drop_thread.",
    "- Use prioritize_thread, prioritize_hook, or prioritize_arc_goal only when no safe thread action exists.",
    "- Use no_action only when no safe issue exists.",
    "- mark_thread_done: use for open/touched threads whose evidence clearly says the task or lead is complete, such as 已经查清, 已确认, 已找到, 已问清, 已完成, 暗号已解, 来源已明.",
    "- Do not mark done when evidence says 准备, 打算, 决定, 明日, 将要, 需要, 试图.",
    "- merge_threads: use for same-type threads with existing targetIds whose titles/evidence refer to the same concrete object, location, or action.",
    "- Good merge examples: 库房账册 + 去库房查账册; 后墙暗号 + 调查后墙暗号; 破损信物用途 + 查明信物用途.",
    "- Do not merge different thread types, done/open mixed threads, different main objects such as 信物 vs 账目, or broad similarity such as 主角/外院/管事 only.",
    "- drop_thread is high risk. Prefer mark_thread_done or merge_threads over drop_thread when possible.",
    "- drop_thread: use only for stale, low-value, unlinked threads with little evidence, no nextActionHint, no strong mainline terms, and no active hook/arc relation.",
    "- If a thread has candidateKind=true_side_branch_drop_candidate and dropSuitability=safe_candidate, you may consider drop_thread after mark/merge options.",
    "- dropSuitability=caution_candidate means manual review only; do not suggest drop_thread unless the system also marks the thread as a true side branch safe candidate.",
    "- dropSuitability=risky_candidate means never suggest drop_thread.",
    "- If candidateKind=stale_but_protected_candidate, do not suggest drop_thread; prefer prioritize_thread, create_repair_plan, or no_action.",
    "- If candidateKind=cleanup_review_candidate, treat it as a priority review group. Inspect cleanupReviewCandidates before generic prioritization.",
    "- Do not suggest drop_thread for candidateKind=cleanup_review_candidate.",
    "- For candidateKind=cleanup_review_candidate, decide in this order: mark_thread_done if possibleDoneEvidence is clear; merge_threads if relatedThreadIdsForMerge is valid and concrete; prioritize_thread if it still needs human attention; otherwise no_action.",
    "- Use suggestedCleanupActions as allowed hints for cleanup_review_candidate, but still verify evidence and exact targetIds.",
    "- If cleanup_review_candidate has no enough evidence for done or merge, prefer prioritize_thread or no_action.",
    "- If candidateKind=non_drop_candidate or dropSuitability=risky_candidate, never suggest drop_thread.",
    "- intentDiagnostics summarizes Intent Lifecycle Diagnostics V1.1. Use cleanupCandidateClass only to make advisory prioritize_thread/no_action suggestions unless normal thread evidence independently satisfies stricter mark/merge/drop rules.",
    "- Do not suggest drop_thread only because intentDiagnostics.lifecycleSuggestion is drop_candidate or auto_expire_candidate.",
    "- If intentDiagnostics.valueClass=high_value_narrative, protect the intent from cleanup and prefer prioritize_thread, create_repair_plan, or no_action.",
    "- cleanupReason, staleReason, safetyNotes, ageInChapters, hasNextActionHint, and evidenceStrength are visibility signals for human maintenance review, not direct confirmation.",
    "- Treat staleReason, safetyNotes, whyNotActive, evidenceCount, lastTouchedChapter, hasNextActionHint, linkedActiveHookCount, linkedActiveArcGoalCount, and hasStrongMainlineKeyword as system-provided candidate diagnostics.",
    "- Do not drop threads containing 账目, 信物, 暗号, mainline characters, active hooks, active arc goals, main mystery, or current carry-forward leads.",
    "- When uncertain, use prioritize_thread instead of drop_thread.",
  ].join("\n");
}

function targetIdGuidance(): string {
  return [
    "TargetId rules:",
    "- targetIds must exactly match IDs from the structured input.",
    "- Never output titles, summaries, or descriptions as targetIds.",
    "- Never summarize, translate, shorten, or invent targetIds.",
    "- Multiple targetIds are allowed for merge_threads only.",
    "- If no valid targetId exists, output no_action with targetIds: [].",
  ].join("\n");
}

function outputQuantityGuidance(): string {
  return [
    "Output quantity and confidence guidance:",
    "- Return up to 8 suggestions.",
    "- Prefer 2-5 high-confidence actionable suggestions over many weak suggestions.",
    "- Always consider mark_thread_done, merge_threads, and drop_thread before prioritize_*.",
    "- If suggesting prioritize_*, explain why no direct thread action is safe.",
    "- Use confidence 0.80+ for strong evidence, 0.60-0.79 for caution but usable suggestions, and below 0.60 for no_action or info-level issues.",
  ].join("\n");
}

function jsonOnlyGuidance(): string {
  return [
    "JSON-only response rules:",
    "- Return only JSON.",
    "- Do not use markdown.",
    "- Do not write prose outside JSON.",
    "- Do not include comments.",
    "- Do not use trailing commas.",
  ].join("\n");
}

function promptExamples(): string {
  return [
    "",
    "Short examples:",
    JSON.stringify({
      input: {
        threads: [{ id: "thread-a", status: "open", evidence: ["主角已经查清账册来源。"] }],
      },
      output: {
        suggestions: [{ action: "mark_thread_done", targetIds: ["thread-a"], reason: "Evidence clearly says the ledger source was checked and the thread can be closed.", confidence: 0.9 }],
      },
    }),
    JSON.stringify({
      input: {
        threads: [
          { id: "thread-a", type: "intent", title: "库房账册" },
          { id: "thread-b", type: "intent", title: "去库房查账册" },
        ],
      },
      output: {
        suggestions: [{ action: "merge_threads", targetIds: ["thread-a", "thread-b"], reason: "Both intent threads refer to the same concrete ledger task at 库房.", confidence: 0.78 }],
      },
    }),
    JSON.stringify({
      input: {
        threads: [{ id: "thread-a", title: "账房信物线索" }],
        requestedTarget: "missing-thread-id",
      },
      output: {
        suggestions: [{ action: "no_action", targetIds: [], reason: "No exact matching targetId exists in the input, so no maintenance action is safe.", confidence: 0.8 }],
      },
    }),
  ].join("\n");
}

function truncateText(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/gu, " ").trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, Math.max(0, maxLength - 1))}…`;
}
