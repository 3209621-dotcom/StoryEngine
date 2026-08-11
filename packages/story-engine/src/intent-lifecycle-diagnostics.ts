import type { NarrativeThread, ThreadPool } from "./types.js";

export type IntentValueClass = "low_value_generic" | "medium_value_action" | "high_value_narrative";
export type IntentTypeCategory =
  | "generic_decision"
  | "generic_motion"
  | "resource_goal"
  | "location_goal"
  | "signal_or_clue_goal"
  | "character_interaction"
  | "risk_or_survival_goal"
  | "stale_or_obsolete";
export type IntentLifecycleSuggestion =
  | "keep_open_or_touched"
  | "mark_done_candidate"
  | "drop_candidate"
  | "auto_expire_candidate"
  | "low_priority_keep"
  | "do_not_pool_or_low_priority";
export type IntentEvidenceStrength = "none" | "weak" | "medium" | "strong";
export type IntentCleanupCandidateClass =
  | "none"
  | "cleanup_candidate"
  | "manual_review_drop_candidate"
  | "stale_low_value_candidate"
  | "stale_generic_candidate"
  | "manual_review_mark_done_candidate";

export interface IntentLifecycleDiagnostic {
  readonly threadId: string;
  readonly title: string;
  readonly status: NarrativeThread["status"];
  readonly firstSeenChapter: number;
  readonly lastTouchedChapter: number;
  readonly ageInChapters: number;
  readonly hasNextActionHint: boolean;
  readonly evidenceCount: number;
  readonly evidenceStrength: IntentEvidenceStrength;
  readonly intentValueClass: IntentValueClass;
  readonly intentTypeCategory: IntentTypeCategory;
  readonly lifecycleSuggestion: IntentLifecycleSuggestion;
  readonly cleanupCandidateClass: IntentCleanupCandidateClass;
  readonly staleReason?: string;
  readonly safetyNotes: readonly string[];
}

export interface IntentLifecycleDiagnosticsReport {
  readonly totalIntents: number;
  readonly openIntentCount: number;
  readonly touchedIntentCount: number;
  readonly doneIntentCount: number;
  readonly valueClassCounts: Record<IntentValueClass, number>;
  readonly typeCategoryCounts: Record<IntentTypeCategory, number>;
  readonly lifecycleSuggestionCounts: Record<IntentLifecycleSuggestion, number>;
  readonly cleanupCandidateCounts: Record<IntentCleanupCandidateClass, number>;
  readonly diagnostics: readonly IntentLifecycleDiagnostic[];
  readonly lowValueSamples: readonly IntentLifecycleDiagnostic[];
  readonly highValueSamples: readonly IntentLifecycleDiagnostic[];
  readonly markDoneCandidates: readonly IntentLifecycleDiagnostic[];
  readonly dropCandidates: readonly IntentLifecycleDiagnostic[];
  readonly autoExpireCandidates: readonly IntentLifecycleDiagnostic[];
  readonly cleanupCandidates: readonly IntentLifecycleDiagnostic[];
  readonly manualReviewDropCandidates: readonly IntentLifecycleDiagnostic[];
  readonly staleLowValueCandidates: readonly IntentLifecycleDiagnostic[];
  readonly staleGenericCandidates: readonly IntentLifecycleDiagnostic[];
  readonly manualReviewMarkDoneCandidates: readonly IntentLifecycleDiagnostic[];
  readonly keepCandidates: readonly IntentLifecycleDiagnostic[];
  readonly summary: string;
}

export interface AnalyzeIntentLifecycleOptions {
  readonly currentChapter?: number;
  readonly sampleLimit?: number;
}

export function analyzeIntentLifecycle(
  threadPool: ThreadPool,
  options: AnalyzeIntentLifecycleOptions = {},
): IntentLifecycleDiagnosticsReport {
  const currentChapter = options.currentChapter ?? inferCurrentChapter(threadPool);
  const sampleLimit = options.sampleLimit ?? 20;
  const diagnostics = threadPool.threads
    .filter((thread) => thread.type === "intent")
    .map((thread) => classifyIntent(thread, currentChapter));

  const valueClassCounts = countBy(diagnostics, ["low_value_generic", "medium_value_action", "high_value_narrative"] as const, (item) => item.intentValueClass);
  const typeCategoryCounts = countBy(diagnostics, [
    "generic_decision",
    "generic_motion",
    "resource_goal",
    "location_goal",
    "signal_or_clue_goal",
    "character_interaction",
    "risk_or_survival_goal",
    "stale_or_obsolete",
  ] as const, (item) => item.intentTypeCategory);
  const lifecycleSuggestionCounts = countBy(diagnostics, [
    "keep_open_or_touched",
    "mark_done_candidate",
    "drop_candidate",
    "auto_expire_candidate",
    "low_priority_keep",
    "do_not_pool_or_low_priority",
  ] as const, (item) => item.lifecycleSuggestion);
  const cleanupCandidateCounts = countBy(diagnostics, [
    "none",
    "cleanup_candidate",
    "manual_review_drop_candidate",
    "stale_low_value_candidate",
    "stale_generic_candidate",
    "manual_review_mark_done_candidate",
  ] as const, (item) => item.cleanupCandidateClass);

  return {
    totalIntents: diagnostics.length,
    openIntentCount: diagnostics.filter((item) => item.status === "open").length,
    touchedIntentCount: diagnostics.filter((item) => item.status === "touched").length,
    doneIntentCount: diagnostics.filter((item) => item.status === "done").length,
    valueClassCounts,
    typeCategoryCounts,
    lifecycleSuggestionCounts,
    cleanupCandidateCounts,
    diagnostics,
    lowValueSamples: diagnostics
      .filter((item) => item.intentValueClass === "low_value_generic")
      .slice(0, sampleLimit),
    highValueSamples: diagnostics
      .filter((item) => item.intentValueClass === "high_value_narrative")
      .slice(0, sampleLimit),
    markDoneCandidates: diagnostics.filter((item) => item.lifecycleSuggestion === "mark_done_candidate"),
    dropCandidates: diagnostics.filter((item) => item.lifecycleSuggestion === "drop_candidate"),
    autoExpireCandidates: diagnostics.filter((item) => item.lifecycleSuggestion === "auto_expire_candidate"),
    cleanupCandidates: diagnostics.filter((item) => item.cleanupCandidateClass === "cleanup_candidate"),
    manualReviewDropCandidates: diagnostics.filter((item) => item.cleanupCandidateClass === "manual_review_drop_candidate"),
    staleLowValueCandidates: diagnostics.filter((item) => item.cleanupCandidateClass === "stale_low_value_candidate"),
    staleGenericCandidates: diagnostics.filter((item) => item.cleanupCandidateClass === "stale_generic_candidate"),
    manualReviewMarkDoneCandidates: diagnostics.filter((item) => item.cleanupCandidateClass === "manual_review_mark_done_candidate"),
    keepCandidates: diagnostics.filter((item) => item.lifecycleSuggestion === "keep_open_or_touched"),
    summary: `Intent lifecycle diagnostics classified ${diagnostics.length} intent thread(s); ${valueClassCounts.low_value_generic} low-value generic, ${valueClassCounts.medium_value_action} medium-value action, ${valueClassCounts.high_value_narrative} high-value narrative, ${diagnostics.length - cleanupCandidateCounts.none} cleanup-visible candidate(s).`,
  };
}

function classifyIntent(thread: NarrativeThread, currentChapter: number): IntentLifecycleDiagnostic {
  const ageInChapters = Math.max(0, currentChapter - thread.lastTouchedChapter);
  const text = normalizeText(joinText([thread.title, thread.nextActionHint, ...thread.evidence]));
  const evidenceStrength = classifyEvidenceStrength(thread);
  const typeCategory = classifyTypeCategory(text, ageInChapters, thread);
  const valueClass = classifyValueClass(text, typeCategory, evidenceStrength);
  const cleanupCandidateClass = classifyCleanupCandidateClass(thread, {
    ageInChapters,
    evidenceStrength,
    typeCategory,
    valueClass,
  });
  const lifecycleSuggestion = classifyLifecycleSuggestion(thread, {
    ageInChapters,
    cleanupCandidateClass,
    evidenceStrength,
    typeCategory,
    valueClass,
  });
  const staleReason = buildStaleReason(thread, ageInChapters, valueClass, lifecycleSuggestion, cleanupCandidateClass);
  const safetyNotes = buildSafetyNotes(thread, valueClass, typeCategory, lifecycleSuggestion, cleanupCandidateClass);

  return {
    threadId: thread.id,
    title: thread.title,
    status: thread.status,
    firstSeenChapter: thread.firstSeenChapter,
    lastTouchedChapter: thread.lastTouchedChapter,
    ageInChapters,
    hasNextActionHint: Boolean(thread.nextActionHint?.trim()),
    evidenceCount: thread.evidence.length,
    evidenceStrength,
    intentValueClass: valueClass,
    intentTypeCategory: typeCategory,
    lifecycleSuggestion,
    cleanupCandidateClass,
    ...(staleReason ? { staleReason } : {}),
    safetyNotes,
  };
}

function classifyTypeCategory(text: string, ageInChapters: number, thread: NarrativeThread): IntentTypeCategory {
  const title = normalizeText(thread.title);
  if (ageInChapters >= 12 && !thread.nextActionHint && isLowSpecificity(text)) return "stale_or_obsolete";
  if (matchesSignalOrClueGoal(title)) return "signal_or_clue_goal";
  if (matchesLocationGoal(title)) return "location_goal";
  if (matchesResourceGoal(title)) return "resource_goal";
  if (matchesRiskOrSurvivalGoal(title)) return "risk_or_survival_goal";
  if (matchesCharacterInteraction(title)) return "character_interaction";
  if (matchesSignalOrClueGoal(text)) return "signal_or_clue_goal";
  if (/(?:迈步|走出去|停住|看了一眼|看一眼|不再停留|离开|回去|先回去|正准备)/u.test(text)) return "generic_motion";
  if (/(?:做决定|决定|想了想|先不管|犹豫|确认一下|看看|处理一下|盘算|考虑)/u.test(text)) return "generic_decision";
  if (matchesLocationGoal(text)) return "location_goal";
  if (matchesResourceGoal(text)) return "resource_goal";
  if (matchesRiskOrSurvivalGoal(text)) return "risk_or_survival_goal";
  if (matchesCharacterInteraction(text)) return "character_interaction";
  return isLowSpecificity(text) ? "generic_decision" : "location_goal";
}

function matchesSignalOrClueGoal(text: string): boolean {
  return /(?:确认|追踪|核实|查清|判断|调查|破解|扫描|搜索).{0,12}(?:线索|来源|真假|证据|记录|疑点|异常|信号|消息|情报|真相|秘密)/u.test(text);
}

function matchesLocationGoal(text: string): boolean {
  return /(?:进入|前往|去|赶到|抵达|搜索|搜|调查).{0,12}(?:某地|某处|某栋楼|那栋楼|那里|现场|地点|房间|入口|通道|院落|档案室|办公室|仓库|地窖|回廊|大厅|窗口)/u.test(text);
}

function matchesResourceGoal(text: string): boolean {
  return /(?:获取|寻找|找到|找|拿到|带回|清点|储备|搜).{0,12}(?:物资|资源|工具|材料|凭证|证件|文件|装备|补给|关键道具|合同|副本|账册|原件)/u.test(text);
}

function matchesRiskOrSurvivalGoal(text: string): boolean {
  return /(?:绕开|避开|确认|封住|关闭|清理|守住|提防|化解).{0,12}(?:威胁|危险|风险|敌人|追兵|陷阱|安全路线|危险入口|入口|出口|安全)/u.test(text);
}

function matchesCharacterInteraction(text: string): boolean {
  return /(?:质问|问清|确认|寻找|找到|说服|联系).{0,12}(?:某人|对方|邻居|保安|老人|女孩|证人|目击者|他说|她说|说法|证词)/u.test(text);
}

function classifyValueClass(
  text: string,
  typeCategory: IntentTypeCategory,
  evidenceStrength: IntentEvidenceStrength,
): IntentValueClass {
  if (typeCategory === "generic_decision" || typeCategory === "generic_motion" || typeCategory === "stale_or_obsolete") {
    return hasConcreteNarrativeObject(text) ? "medium_value_action" : "low_value_generic";
  }
  if (isGenericOrBroadcastInstruction(text)) return "medium_value_action";
  if (typeCategory === "signal_or_clue_goal" || typeCategory === "risk_or_survival_goal" || typeCategory === "character_interaction") {
    return "high_value_narrative";
  }
  if ((typeCategory === "resource_goal" || typeCategory === "location_goal") && evidenceStrength === "strong") {
    return "high_value_narrative";
  }
  return "medium_value_action";
}

function classifyCleanupCandidateClass(
  thread: NarrativeThread,
  input: {
    readonly ageInChapters: number;
    readonly evidenceStrength: IntentEvidenceStrength;
    readonly typeCategory: IntentTypeCategory;
    readonly valueClass: IntentValueClass;
  },
): IntentCleanupCandidateClass {
  const text = normalizeText(joinText([thread.title, thread.nextActionHint, ...thread.evidence]));
  const title = normalizeText(thread.title);
  if (thread.status === "done") return "manual_review_mark_done_candidate";
  if (input.valueClass === "high_value_narrative") return "none";
  if (input.valueClass === "low_value_generic") {
    if (input.ageInChapters >= 8) return "stale_low_value_candidate";
    if (thread.nextActionHint) return "manual_review_drop_candidate";
    return "cleanup_candidate";
  }
  if ((input.typeCategory === "generic_decision" || input.typeCategory === "generic_motion" || input.typeCategory === "stale_or_obsolete")
    && input.evidenceStrength !== "strong") {
    if (input.ageInChapters >= 5) return "stale_generic_candidate";
    return "cleanup_candidate";
  }
  if (input.valueClass === "medium_value_action" && (isGenericOrBroadcastInstruction(title) || isGenericOrBroadcastInstruction(text))) {
    if (input.ageInChapters >= 5) return "stale_generic_candidate";
    return "manual_review_drop_candidate";
  }
  return "none";
}

function classifyLifecycleSuggestion(
  thread: NarrativeThread,
  input: {
    readonly ageInChapters: number;
    readonly cleanupCandidateClass: IntentCleanupCandidateClass;
    readonly evidenceStrength: IntentEvidenceStrength;
    readonly typeCategory: IntentTypeCategory;
    readonly valueClass: IntentValueClass;
  },
): IntentLifecycleSuggestion {
  if (thread.status === "done") return "mark_done_candidate";
  if (input.cleanupCandidateClass === "cleanup_candidate"
    || input.cleanupCandidateClass === "manual_review_drop_candidate"
    || input.cleanupCandidateClass === "stale_low_value_candidate") return "do_not_pool_or_low_priority";
  if (input.cleanupCandidateClass === "stale_generic_candidate") return "low_priority_keep";
  if (input.valueClass === "high_value_narrative") return "keep_open_or_touched";
  if (input.valueClass === "medium_value_action" && thread.nextActionHint) return "keep_open_or_touched";
  if (input.valueClass === "medium_value_action") return "low_priority_keep";
  if (input.ageInChapters >= 8 && !thread.nextActionHint) return "do_not_pool_or_low_priority";
  if (input.evidenceStrength === "none" || input.evidenceStrength === "weak") return "do_not_pool_or_low_priority";
  return "drop_candidate";
}

function classifyEvidenceStrength(thread: NarrativeThread): IntentEvidenceStrength {
  if (thread.evidence.length === 0) return "none";
  const text = normalizeText(joinText(thread.evidence));
  const hasAction = /确认|追踪|核实|查清|判断|进入|前往|搜索|获取|寻找|找到|拿到|绕开|避开|质问|问清|检查|修|调整/u.test(text);
  const hasObject = hasConcreteNarrativeObject(text);
  if (thread.evidence.length >= 2 && hasAction && hasObject) return "strong";
  if (hasAction && hasObject) return "medium";
  return thread.evidence.some((item) => normalizeText(item).length >= 10) ? "weak" : "none";
}

function buildStaleReason(
  thread: NarrativeThread,
  ageInChapters: number,
  valueClass: IntentValueClass,
  lifecycleSuggestion: IntentLifecycleSuggestion,
  cleanupCandidateClass: IntentCleanupCandidateClass,
): string | undefined {
  if (cleanupCandidateClass === "manual_review_mark_done_candidate") return "Already done or done-like; manual review only, no automatic status change.";
  if (cleanupCandidateClass === "stale_low_value_candidate") return `Low-value generic intent has not been touched for ${ageInChapters} chapter(s); expose as cleanup-visible diagnostics only.`;
  if (cleanupCandidateClass === "stale_generic_candidate") return `Generic action intent has not been touched for ${ageInChapters} chapter(s); expose as stale diagnostics only.`;
  if (cleanupCandidateClass === "manual_review_drop_candidate") return "Generic action has a nextActionHint, so it requires manual review before any cleanup decision.";
  if (cleanupCandidateClass === "cleanup_candidate") return "Generic or weakly evidenced intent should be visible to maintenance review as a cleanup candidate.";
  if (lifecycleSuggestion === "auto_expire_candidate") return `Not touched for ${ageInChapters} chapter(s) and lacks strong current narrative value.`;
  if (lifecycleSuggestion === "drop_candidate") return "Low-value generic intent is a cleanup candidate; diagnostics only.";
  if (lifecycleSuggestion === "do_not_pool_or_low_priority") return "Intent is too generic or weakly evidenced to be useful as a strong continuity target.";
  if (valueClass === "high_value_narrative") return undefined;
  if (thread.status === "done") return "Already done; reported so maintenance review can notice stale done candidates.";
  return undefined;
}

function buildSafetyNotes(
  thread: NarrativeThread,
  valueClass: IntentValueClass,
  typeCategory: IntentTypeCategory,
  lifecycleSuggestion: IntentLifecycleSuggestion,
  cleanupCandidateClass: IntentCleanupCandidateClass,
): readonly string[] {
  const notes: string[] = ["diagnostics_only_no_state_change"];
  if (cleanupCandidateClass !== "none") notes.push(`cleanup_class:${cleanupCandidateClass}`);
  if (valueClass === "low_value_generic") notes.push("low_value_generic_intent");
  if (valueClass === "high_value_narrative") notes.push("preserve_narrative_target");
  if (typeCategory === "signal_or_clue_goal") notes.push("signal_or_clue_goal_should_remain_visible");
  if (thread.nextActionHint) notes.push("has_next_action_hint");
  if (lifecycleSuggestion === "drop_candidate"
    || lifecycleSuggestion === "auto_expire_candidate"
    || cleanupCandidateClass !== "none") notes.push("requires_human_or_maintenance_confirmation");
  return notes;
}

function inferCurrentChapter(threadPool: ThreadPool): number {
  return Math.max(0, ...threadPool.threads.map((thread) => thread.lastTouchedChapter));
}

function isLowSpecificity(text: string): boolean {
  return !hasConcreteNarrativeObject(text) || /^(?:做决定|决定|想了想|先不管|不再停留|看了一眼|犹豫了一下|停住了)$/u.test(text);
}

function isGenericOrBroadcastInstruction(text: string): boolean {
  // Non-committal / deferred decisions and vague broadcast-style filler that
  // carry no concrete follow-through, expressed without any genre-specific words.
  return /做了?一个决定|做了决定|需要做一个决定|这个决定做得|先不管|不急着过去|不再停留|再也没有机会离开|以后再说|之后再说|改天再说|再说吧|看情况再说/u.test(text);
}

function hasConcreteNarrativeObject(text: string): boolean {
  // A concrete narrative object is detected via genre-neutral structure: either
  // the intent matches one of the generic goal categories (clue / location /
  // resource / risk / character), or it names a generic concrete narrative noun.
  return matchesSignalOrClueGoal(text)
    || matchesLocationGoal(text)
    || matchesResourceGoal(text)
    || matchesRiskOrSurvivalGoal(text)
    || matchesCharacterInteraction(text)
    || /线索|证据|记录|来源|真相|秘密|物资|资源|材料|文件|凭证|证件|地点|现场|通道|入口|出口|威胁|风险|证人|目击者|证词/u.test(text);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, "");
}

function joinText(values: readonly (string | undefined)[]): string {
  return values.filter((value): value is string => value !== undefined && value.trim().length > 0).join(" ");
}

function countBy<const T extends string>(
  items: readonly IntentLifecycleDiagnostic[],
  keys: readonly T[],
  selector: (item: IntentLifecycleDiagnostic) => T,
): Record<T, number> {
  const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
  for (const item of items) {
    result[selector(item)] += 1;
  }
  return result;
}
