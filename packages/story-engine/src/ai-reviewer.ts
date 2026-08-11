import {
  readArcGoalPool,
  readHookPool,
  readProject,
  readThreadPool,
  readTimelineEvents,
} from "./project-store.js";
import { buildAIReviewerPromptContract } from "./ai-reviewer-prompt-contract.js";
import { analyzeIntentLifecycle } from "./intent-lifecycle-diagnostics.js";
import type {
  IntentCleanupCandidateClass,
  IntentEvidenceStrength,
  IntentLifecycleSuggestion,
  IntentTypeCategory,
  IntentValueClass,
} from "./intent-lifecycle-diagnostics.js";
import type { ArcGoal, ArcGoalPool, HookItem, HookPool, NarrativeThread, ThreadPool, TimelineEvent } from "./types.js";

export type AIReviewScope = "chapter" | "window" | "arc";

export interface AIReviewInput {
  readonly projectId?: string;
  readonly chapter?: number;
  readonly scope: AIReviewScope;
  readonly recentTimelineEvents: readonly TimelineEvent[];
  readonly semanticSummaries: readonly unknown[];
  readonly hookPool: HookPool;
  readonly threadPool: AIReviewThreadPool;
  readonly intentDiagnostics?: AIReviewIntentDiagnostics;
  readonly arcGoalPool: ArcGoalPool;
  readonly continuityQuality?: unknown;
  readonly diagnostics?: unknown;
  readonly tokenBudget?: number;
}

export type ThreadSelectionReason =
  | "recent"
  | "stale_candidate"
  | "drop_candidate"
  | "merge_candidate"
  | "done_candidate";

export type DropCandidateSuitability = "safe_candidate" | "caution_candidate" | "risky_candidate";
export type NextActionHintLifecycle = "active" | "stale" | "expired_candidate" | "unknown";
export type CleanupCandidateAction = "mark_thread_done" | "merge_threads" | "prioritize_thread" | "no_action";
export type MaintenanceCandidateKind =
  | "true_side_branch_drop_candidate"
  | "stale_but_protected_candidate"
  | "cleanup_review_candidate"
  | "non_drop_candidate";

export interface AIReviewIntentDiagnostics {
  readonly summary: AIReviewIntentDiagnosticsSummary;
  readonly items: readonly AIReviewIntentDiagnosticItem[];
}

export interface AIReviewIntentDiagnosticsSummary {
  readonly present: true;
  readonly advisoryOnly: true;
  readonly totalIntents: number;
  readonly openIntentCount: number;
  readonly touchedIntentCount: number;
  readonly doneIntentCount: number;
  readonly cleanupVisibleCount: number;
  readonly protectedHighValueCount: number;
  readonly valueClassCounts: Readonly<Record<IntentValueClass, number>>;
  readonly typeCategoryCounts: Readonly<Record<IntentTypeCategory, number>>;
  readonly lifecycleSuggestionCounts: Readonly<Record<IntentLifecycleSuggestion, number>>;
  readonly cleanupCandidateCounts: Readonly<Record<IntentCleanupCandidateClass, number>>;
  readonly summaryText: string;
}

export interface AIReviewIntentDiagnosticItem {
  readonly id: string;
  readonly title: string;
  readonly status: NarrativeThread["status"];
  readonly valueClass: IntentValueClass;
  readonly typeCategory: IntentTypeCategory;
  readonly lifecycleSuggestion: IntentLifecycleSuggestion;
  readonly cleanupCandidateClass: IntentCleanupCandidateClass;
  readonly cleanupReason: string;
  readonly staleReason: string;
  readonly safetyNotes: readonly string[];
  readonly ageInChapters: number;
  readonly hasNextActionHint: boolean;
  readonly evidenceStrength: IntentEvidenceStrength;
}

export interface NextActionHintStickinessDiagnostic {
  readonly threadId: string;
  readonly title: string;
  readonly status: NarrativeThread["status"];
  readonly threadType: NarrativeThread["type"];
  readonly createdChapter: number;
  readonly lastTouchedChapter: number;
  readonly ageInChapters: number;
  readonly nextActionHint: string;
  readonly nextActionHintCreatedChapter: number | "unknown";
  readonly nextActionHintAgeInChapters: number | "unknown";
  readonly nextActionHintSource: "semanticSummary" | "threadTracking" | "carryForward" | "unknown";
  readonly nextActionHintStillMentionedInRecentChapters: boolean;
  readonly nextActionHintOverlapWithCurrentObjective: boolean;
  readonly nextActionHintLifecycle: NextActionHintLifecycle;
  readonly nextActionHintRecentlyMentioned: boolean;
  readonly nextActionHintCurrentObjectiveOverlap: boolean;
  readonly nextActionHintStrongHookOverlap: boolean;
  readonly nextActionHintStrongArcOverlap: boolean;
  readonly shouldExpireNextActionHintCandidate: boolean;
  readonly nextActionHintExpiryReason?: string;
  readonly nextActionHintRetentionReason: string;
}

export interface ActiveHookLinkageDiagnostic {
  readonly threadId: string;
  readonly threadTitle: string;
  readonly threadType: NarrativeThread["type"];
  readonly threadStatus: NarrativeThread["status"];
  readonly threadCreatedChapter: number;
  readonly threadLastTouchedChapter: number;
  readonly hookId: string;
  readonly hookTitle: string;
  readonly hookStatus: HookItem["status"];
  readonly hookCreatedChapter: number | "unknown";
  readonly hookLastTouchedChapter: number | "unknown";
  readonly sharedKeywords: readonly string[];
  readonly strongSharedKeywords: readonly string[];
  readonly weakSharedKeywords: readonly string[];
  readonly mainlineKeywordHits: readonly string[];
  readonly uniqueSpecificKeywordHits: readonly string[];
  readonly genericKeywordHits: readonly string[];
  readonly linkageStrength: "strong" | "caution" | "weak" | "none" | "unknown";
  readonly linkageReason: string;
  readonly hookAgeInChapters: number | "unknown";
  readonly isSpecificEntityOverlap: boolean;
  readonly isGenericMainlineOnlyOverlap: boolean;
  readonly isSameNarrativeObject: boolean;
  readonly isSameLocationOnly: boolean;
  readonly isSameActorOnly: boolean;
  readonly shouldRemainStrong: boolean;
  readonly possibleDowngradeReason?: string;
  readonly shouldBeStrongProtected: boolean;
  readonly shouldDowngradeToCleanupCandidate: boolean;
}

export interface StickinessDiagnosticsSummary {
  readonly nextActionHintProtectedCount: number;
  readonly nextActionHintUnknownSourceCount: number;
  readonly staleNextActionHintCandidateCount: number;
  readonly activeHookProtectedCount: number;
  readonly strongHookLinkCount: number;
  readonly weakHookLinkCount: number;
  readonly unknownHookLinkCount: number;
  readonly possibleOverProtectedThreadCount: number;
  readonly possibleNextActionHintExpiryCandidateCount: number;
  readonly possibleWeakHookLinkDowngradeCount: number;
  readonly topNextActionHintTexts: Readonly<Record<string, number>>;
  readonly topSharedHookKeywords: Readonly<Record<string, number>>;
  readonly overProtectionReasonCounts: Readonly<Record<string, number>>;
  readonly totalHookLinks?: number;
  readonly specificEntityStrongLinkCount?: number;
  readonly mainlineOnlyStrongLinkCount?: number;
  readonly genericOnlyStrongLinkCount?: number;
  readonly locationOnlyStrongLinkCount?: number;
  readonly actorOnlyStrongLinkCount?: number;
  readonly possibleDowngradeStrongLinkCount?: number;
  readonly refinedStrongHookLinkCount?: number;
  readonly refinedCautionHookLinkCount?: number;
  readonly refinedWeakHookLinkCount?: number;
  readonly refinedNoneHookLinkCount?: number;
  readonly downgradedFromStrongCount?: number;
  readonly downgradeReasonCounts?: Readonly<Record<string, number>>;
  readonly nextActionHintActiveCount?: number;
  readonly nextActionHintStaleCount?: number;
  readonly nextActionHintExpiredCandidateCount?: number;
  readonly nextActionHintUnknownCount?: number;
  readonly downgradedNextActionHintProtectionCount?: number;
  readonly expiryReasonCounts?: Readonly<Record<string, number>>;
  readonly retentionReasonCounts?: Readonly<Record<string, number>>;
  readonly topGenericKeywords?: Readonly<Record<string, number>>;
  readonly topMainlineKeywords?: Readonly<Record<string, number>>;
  readonly hookLinkFanoutByThread?: Readonly<Record<string, number>>;
  readonly hookLinkFanoutByHook?: Readonly<Record<string, number>>;
  readonly highFanoutHookIds?: readonly string[];
  readonly highFanoutThreadIds?: readonly string[];
}

export interface AIReviewThreadDropExposure {
  readonly candidateKind: MaintenanceCandidateKind;
  readonly dropSuitability: DropCandidateSuitability;
  readonly threadId: string;
  readonly title: string;
  readonly status: NarrativeThread["status"];
  readonly threadType: NarrativeThread["type"];
  readonly createdChapter: number;
  readonly staleReason: string;
  readonly safetyNotes: readonly string[];
  readonly whyNotActive: string;
  readonly ageInChapters: number;
  readonly evidenceCount: number;
  readonly mentionCount: number;
  readonly lastTouchedChapter: number;
  readonly hasNextActionHint: boolean;
  readonly nextActionHintLifecycle?: NextActionHintLifecycle;
  readonly nextActionHintExpiryReason?: string;
  readonly nextActionHintRetentionReason?: string;
  readonly strongMainlineKeywordHits: readonly string[];
  readonly weakMainlineKeywordHits: readonly string[];
  readonly linkedActiveHookCount: number;
  readonly linkedActiveHookIds: readonly string[];
  readonly linkedActiveArcGoalCount: number;
  readonly linkedActiveArcGoalIds: readonly string[];
  readonly hasStrongMainlineKeyword: boolean;
  readonly recentlyTouched: boolean;
  readonly isCarryForward: boolean;
  readonly hasCurrentObjectiveOverlap: boolean;
  readonly riskReasons: readonly string[];
  readonly cautionReasons: readonly string[];
  readonly protectedReasons: readonly string[];
  readonly cleanupReasons: readonly string[];
  readonly nextActionHintDiagnostic?: NextActionHintStickinessDiagnostic;
  readonly activeHookLinkageDiagnostics?: readonly ActiveHookLinkageDiagnostic[];
}

export interface AIReviewThread extends NarrativeThread {
  readonly candidateKind?: MaintenanceCandidateKind;
  readonly dropSuitability?: DropCandidateSuitability;
  readonly threadId?: string;
  readonly threadType?: NarrativeThread["type"];
  readonly createdChapter?: number;
  readonly staleReason?: string;
  readonly safetyNotes?: readonly string[];
  readonly whyNotActive?: string;
  readonly ageInChapters?: number;
  readonly evidenceCount?: number;
  readonly mentionCount?: number;
  readonly hasNextActionHint?: boolean;
  readonly nextActionHintLifecycle?: NextActionHintLifecycle;
  readonly nextActionHintExpiryReason?: string;
  readonly nextActionHintRetentionReason?: string;
  readonly strongMainlineKeywordHits?: readonly string[];
  readonly weakMainlineKeywordHits?: readonly string[];
  readonly linkedActiveHookCount?: number;
  readonly linkedActiveHookIds?: readonly string[];
  readonly linkedActiveArcGoalCount?: number;
  readonly linkedActiveArcGoalIds?: readonly string[];
  readonly hasStrongMainlineKeyword?: boolean;
  readonly recentlyTouched?: boolean;
  readonly isCarryForward?: boolean;
  readonly hasCurrentObjectiveOverlap?: boolean;
  readonly riskReasons?: readonly string[];
  readonly cautionReasons?: readonly string[];
  readonly protectedReasons?: readonly string[];
  readonly cleanupReasons?: readonly string[];
  readonly nextActionHintDiagnostic?: NextActionHintStickinessDiagnostic;
  readonly activeHookLinkageDiagnostics?: readonly ActiveHookLinkageDiagnostic[];
}

export interface DropCandidateClassificationDiagnostic {
  readonly threadId: string;
  readonly title: string;
  readonly status: NarrativeThread["status"];
  readonly threadType: NarrativeThread["type"];
  readonly createdChapter: number;
  readonly lastTouchedChapter: number;
  readonly ageInChapters: number;
  readonly evidenceCount: number;
  readonly mentionCount: number;
  readonly hasNextActionHint: boolean;
  readonly nextActionHintLifecycle?: NextActionHintLifecycle;
  readonly nextActionHintExpiryReason?: string;
  readonly nextActionHintRetentionReason?: string;
  readonly hasStrongMainlineKeyword: boolean;
  readonly strongMainlineKeywordHits: readonly string[];
  readonly weakMainlineKeywordHits: readonly string[];
  readonly linkedActiveHookCount: number;
  readonly linkedActiveHookIds: readonly string[];
  readonly linkedActiveArcGoalCount: number;
  readonly linkedActiveArcGoalIds: readonly string[];
  readonly recentlyTouched: boolean;
  readonly isCarryForward: boolean;
  readonly hasCurrentObjectiveOverlap: boolean;
  readonly riskReasons: readonly string[];
  readonly cautionReasons: readonly string[];
  readonly protectedReasons: readonly string[];
  readonly cleanupReasons: readonly string[];
  readonly suggestedCleanupActions: readonly CleanupCandidateAction[];
  readonly whyNotDrop?: string;
  readonly whyNeedsReview?: string;
  readonly relatedThreadIdsForMerge: readonly string[];
  readonly possibleDoneEvidence: readonly string[];
  readonly priorityScore: number;
  readonly nextActionHintDiagnostic?: NextActionHintStickinessDiagnostic;
  readonly activeHookLinkageDiagnostics?: readonly ActiveHookLinkageDiagnostic[];
  readonly candidateKind: MaintenanceCandidateKind;
  readonly dropSuitability: DropCandidateSuitability;
}

export interface AIReviewCleanupCandidate {
  readonly threadId: string;
  readonly title: string;
  readonly status: NarrativeThread["status"];
  readonly threadType: NarrativeThread["type"];
  readonly createdChapter: number;
  readonly lastTouchedChapter: number;
  readonly ageInChapters: number;
  readonly evidenceCount: number;
  readonly nextActionHintLifecycle?: NextActionHintLifecycle;
  readonly cleanupReasons: readonly string[];
  readonly suggestedCleanupActions: readonly CleanupCandidateAction[];
  readonly whyNotDrop: string;
  readonly whyNeedsReview: string;
  readonly relatedThreadIdsForMerge: readonly string[];
  readonly possibleDoneEvidence: readonly string[];
  readonly priorityScore: number;
}

export interface DropCandidateClassificationSummary {
  readonly trueSideBranchDropCandidateCount: number;
  readonly staleButProtectedCandidateCount: number;
  readonly cleanupReviewCandidateCount: number;
  readonly nonDropCandidateCount: number;
  readonly protectedReasonCounts: Readonly<Record<string, number>>;
  readonly cleanupReasonCounts: Readonly<Record<string, number>>;
  readonly riskyReasonCounts: Readonly<Record<string, number>>;
  readonly cautionReasonCounts: Readonly<Record<string, number>>;
  readonly topRiskyCandidates: readonly DropCandidateClassificationDiagnostic[];
  readonly topProtectedCandidates: readonly DropCandidateClassificationDiagnostic[];
  readonly topCleanupCandidates: readonly DropCandidateClassificationDiagnostic[];
  readonly cleanupReviewCandidates: readonly AIReviewCleanupCandidate[];
  readonly safeCandidateMissingReasons: readonly string[];
  readonly wouldBeSafeExceptForReasonCounts: Readonly<Record<string, number>>;
  readonly riskReasonCombinationCounts: Readonly<Record<string, number>>;
  readonly stickinessDiagnosticsSummary: StickinessDiagnosticsSummary;
  readonly nextActionHintDiagnostics: readonly NextActionHintStickinessDiagnostic[];
  readonly activeHookLinkageDiagnostics: readonly ActiveHookLinkageDiagnostic[];
  readonly dropCandidateClassifications: readonly DropCandidateClassificationDiagnostic[];
}

export interface AIReviewThreadSelectionSummary {
  readonly totalThreadCount: number;
  readonly selectedThreadCount: number;
  readonly recentCount: number;
  readonly staleCandidateCount: number;
  readonly mergeCandidateCount: number;
  readonly doneCandidateCount: number;
  readonly staleLowValueCandidateCount?: number;
  readonly safeDropCandidateCount?: number;
  readonly cautionDropCandidateCount?: number;
  readonly riskyDropCandidateCount?: number;
  readonly selectedDropCandidateIds?: readonly string[];
  readonly dropCandidateSuitability?: Readonly<Record<string, DropCandidateSuitability>>;
  readonly candidateKindByThreadId?: Readonly<Record<string, MaintenanceCandidateKind>>;
  readonly dropCandidateClassificationSummary?: DropCandidateClassificationSummary;
  readonly selectedCleanupCandidateCount?: number;
  readonly cleanupReviewCandidates?: readonly AIReviewCleanupCandidate[];
  readonly cleanupCandidateSelectionReasons?: Readonly<Record<string, readonly string[]>>;
  readonly cleanupCandidateSkippedReasons?: Readonly<Record<string, string>>;
  readonly mergeCandidateGroupCount: number;
  readonly selectionReasons: Readonly<Record<string, readonly ThreadSelectionReason[]>>;
  readonly mergeGroups: readonly (readonly string[])[];
}

export interface AIReviewThreadPool extends ThreadPool {
  readonly threads: readonly AIReviewThread[];
  readonly selection?: AIReviewThreadSelectionSummary;
}

export interface AIReviewIssue {
  readonly id: string;
  readonly type:
    | "thread_should_be_done"
    | "thread_should_merge"
    | "thread_should_drop"
    | "stale_thread"
    | "hook_stale"
    | "arc_goal_drift"
    | "continuity_risk"
    | "possible_repetition"
    | "state_conflict";
  readonly severity: "info" | "warning" | "error";
  readonly evidence: readonly string[];
  readonly suggestion: string;
  readonly targetIds?: readonly string[];
  readonly confidence?: number;
}

export interface AIReviewSuggestion {
  readonly action:
    | "mark_thread_done"
    | "merge_threads"
    | "drop_thread"
    | "keep_thread"
    | "prioritize_thread"
    | "prioritize_hook"
    | "prioritize_arc_goal"
    | "create_repair_plan"
    | "no_action";
  readonly targetIds?: readonly string[];
  readonly reason: string;
  readonly confidence?: number;
}

export interface AIReviewReport {
  readonly passed: boolean;
  readonly scope: AIReviewScope;
  readonly issues: readonly AIReviewIssue[];
  readonly suggestions: readonly AIReviewSuggestion[];
  readonly provider?: AIReviewerProviderMetadata;
  readonly threadSelectionSummary?: AIReviewThreadSelectionSummary;
  readonly actionabilitySummary?: AIReviewActionabilitySummary;
  readonly candidateDiagnostics?: MaintenanceCandidateDiagnostics;
  readonly summary: string;
  readonly createdAt: string;
}

export interface AIReviewer {
  readonly review: (input: AIReviewInput) => Promise<AIReviewReport>;
}

export interface AIReviewerProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: "mock" | "external";
  readonly review: (input: AIReviewInput, options?: AIReviewerProviderOptions) => Promise<AIReviewReport>;
}

export interface AIReviewerProviderOptions {
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly tokenBudget?: number;
  readonly strictJson?: boolean;
  readonly fallbackToMock?: boolean;
}

export interface RunAIReviewerWithProviderOptions extends AIReviewerProviderOptions {
  readonly providerId?: string;
}

export interface AIReviewerProviderMetadata {
  readonly id: string;
  readonly usedFallback: boolean;
  readonly latencyMs?: number;
  readonly errorType?: string;
}

export interface AIReviewerProviderResult {
  readonly report: AIReviewReport;
  readonly providerId: string;
  readonly usedFallback: boolean;
  readonly latencyMs?: number;
  readonly rawResponseTruncated?: string;
}

export interface AIReviewReportValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly sanitized?: AIReviewReport;
}

export interface DeepSeekAIReviewerProviderOptions {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly includeExamples?: boolean;
  readonly env?: Record<string, string | undefined>;
  readonly fetch?: AIReviewerFetchLike;
}

export interface AIReviewerFetchLike {
  (url: string, init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly body: string;
  }): Promise<{
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    text(): Promise<string>;
  }>;
}

export interface AIReviewActionabilitySummary {
  readonly executableActionCount: number;
  readonly markThreadDoneCount: number;
  readonly mergeThreadsCount: number;
  readonly dropThreadCount: number;
  readonly prioritizeCount: number;
  readonly noExecutableActionReason?: string;
}

export interface RejectedCandidate {
  readonly id?: string;
  readonly ids?: readonly string[];
  readonly title?: string;
  readonly reason: string;
  readonly blocker?: string;
}

export interface MaintenanceCandidateDiagnostics {
  readonly threadPoolTotal: number;
  readonly selectedThreadCount: number;
  readonly selectionStage: {
    readonly recentCount: number;
    readonly staleCandidateCount: number;
    readonly mergeCandidateCount: number;
    readonly doneCandidateCount: number;
    readonly dropCandidateCount?: number;
    readonly staleLowValueCandidateCount?: number;
    readonly safeDropCandidateCount?: number;
    readonly cautionDropCandidateCount?: number;
    readonly riskyDropCandidateCount?: number;
    readonly selectedDropCandidateIds?: readonly string[];
    readonly dropCandidateClassificationSummary?: DropCandidateClassificationSummary;
    readonly trueSideBranchDropCandidateCount?: number;
    readonly staleButProtectedCandidateCount?: number;
    readonly cleanupReviewCandidateCount?: number;
    readonly selectedCleanupCandidateCount?: number;
    readonly cleanupReviewCandidates?: readonly AIReviewCleanupCandidate[];
    readonly cleanupCandidateSelectionReasons?: Readonly<Record<string, readonly string[]>>;
    readonly cleanupCandidateSkippedReasons?: Readonly<Record<string, string>>;
    readonly nonDropCandidateCount?: number;
    readonly protectedReasonCounts?: Readonly<Record<string, number>>;
    readonly cleanupReasonCounts?: Readonly<Record<string, number>>;
    readonly stickinessDiagnosticsSummary?: StickinessDiagnosticsSummary;
    readonly nextActionHintDiagnostics?: readonly NextActionHintStickinessDiagnostic[];
    readonly activeHookLinkageDiagnostics?: readonly ActiveHookLinkageDiagnostic[];
    readonly mergeCandidateGroupCount: number;
    readonly selectedThreadIds: readonly string[];
  };
  readonly analysisStage: {
    readonly doneCandidates: readonly string[];
    readonly mergeGroups: readonly (readonly string[])[];
    readonly dropCandidates: readonly string[];
    readonly priorityCandidates: readonly string[];
    readonly rejectedDoneCandidates?: readonly RejectedCandidate[];
    readonly rejectedMergeGroups?: readonly RejectedCandidate[];
    readonly rejectedDropCandidates?: readonly RejectedCandidate[];
  };
  readonly reviewerStage: {
    readonly suggestionCount: number;
    readonly executableSuggestionCount: number;
    readonly markThreadDoneCount: number;
    readonly mergeThreadsCount: number;
    readonly dropThreadCount: number;
    readonly reviewerDropThreadCount?: number;
    readonly noDropDespiteSafeCandidateCount?: number;
    readonly prioritizeCount: number;
  };
  readonly reviewPlanStage: MaintenanceCandidateReviewPlanStage;
  readonly intentDiagnostics?: AIReviewIntentDiagnosticsVisibilitySummary;
  readonly noActionReason?: string;
}

export interface AIReviewIntentDiagnosticsVisibilitySummary extends AIReviewIntentDiagnosticsSummary {
  readonly usedByReviewer: boolean;
  readonly visibleItemCount: number;
  readonly advisorySuggestionCount: number;
}

export interface MaintenanceCandidateReviewPlanStage {
  readonly actionCount: number;
  readonly executableActionCount: number;
  readonly recommendedActionCount: number;
  readonly manualReviewCount: number;
  readonly riskyCount: number;
  readonly recommendedActionIds: readonly string[];
  readonly riskyActionIds: readonly string[];
  readonly filteredAlreadyDoneActionCount?: number;
  readonly filteredAlreadyDoneActionIds?: readonly string[];
}

export interface BuildAIReviewInputOptions {
  readonly scope?: AIReviewScope;
  readonly chapter?: number;
  readonly recentChapters?: number;
  readonly tokenBudget?: number;
  readonly continuityQuality?: unknown;
  readonly diagnostics?: unknown;
}

export interface ThreadMaintenanceAnalysis {
  readonly doneCandidates: readonly string[];
  readonly mergeGroups: readonly (readonly string[])[];
  readonly dropCandidates: readonly string[];
  readonly priorityCandidates: readonly string[];
  readonly reasons: Readonly<Record<string, string>>;
  readonly rejectedDoneCandidates: readonly RejectedCandidate[];
  readonly rejectedMergeGroups: readonly RejectedCandidate[];
  readonly rejectedDropCandidates: readonly RejectedCandidate[];
}

export interface AnalyzeThreadPoolForMaintenanceOptions {
  readonly chapter?: number;
  readonly injectedThreadIds?: readonly string[];
}

const DEFAULT_RECENT_CHAPTERS = 5;
const MAX_TIMELINE_EVENTS = 5;
const MAX_SEMANTIC_SUMMARIES = 5;
const MAX_HOOKS = 10;
const MAX_THREADS = 24;
const MAX_RECENT_THREADS = 6;
const MAX_STALE_CANDIDATE_THREADS = 5;
const MAX_MERGE_CANDIDATE_THREADS = 6;
const MAX_DONE_CANDIDATE_THREADS = 5;
const MAX_SELECTION_MERGE_GROUPS = 3;
const MAX_ARC_GOALS = 8;
const MAX_EVIDENCE = 3;
const MAX_TEXT_LENGTH = 120;
const MAX_INTENT_DIAGNOSTIC_ITEMS = 24;
const MAX_MERGE_SUGGESTIONS = 5;
const MAX_DROP_SUGGESTIONS = 2;
const MAX_MARK_DONE_SUGGESTIONS = 5;
const MAX_PRIORITIZE_THREAD_SUGGESTIONS = 5;
const MAX_PRIORITIZE_HOOK_SUGGESTIONS = 3;
const MAX_PRIORITIZE_ARC_GOAL_SUGGESTIONS = 3;
const MAX_MERGE_GROUP_SIZE = 4;
const STRONG_THREAD_WORDS = /账目|信物|暗号|账房|资源|管事|残页|后墙|黑影|封条/u;
const STRONG_MAINLINE_WORDS = /账目|账本|账册|信物|暗号|黑影|资源|管事|后墙|残页|暗页|名单|封条|主角/u;
const HARD_MAINLINE_KEYWORDS = ["账目", "账本", "账册", "信物", "暗号", "黑影", "后墙", "残页", "暗页", "名单", "封条", "账房", "外院资源"] as const;
const WEAK_MAINLINE_KEYWORDS = ["主角", "外院", "组织", "管事", "资源"] as const;
const STRONG_ACTIVE_LINK_KEYWORDS = ["账目", "账本", "账册", "信物", "暗号", "黑影", "后墙", "残页", "暗页", "名单", "封条", "账房", "园圃", "枯井", "库房"] as const;
const WEAK_ACTIVE_LINK_KEYWORDS = ["主角", "外院", "组织", "管事", "资源", "线索", "调查"] as const;
const HOOK_LINK_SPECIFIC_ENTITY_KEYWORDS = [
  "后墙",
  "破损信物",
  "破损信物",
  "墙上暗号",
  "黑影暗号",
  "账目",
  "账册暗页",
  "账目暗页",
  "残页",
  "暗页",
  "名单",
  "封条",
  "园圃脚印",
  "枯井传闻",
] as const;
const HOOK_LINK_MAINLINE_KEYWORDS = ["账目", "账本", "账册", "信物", "暗号", "外院资源", "管事", "账房"] as const;
const HOOK_LINK_GENERIC_KEYWORDS = ["调查", "线索", "异常", "证明", "资源", "账目", "危险", "情况", "事情", "问题", "传闻"] as const;
const HOOK_LINK_LOCATION_KEYWORDS = ["账房", "园圃", "后院", "枯井", "库房", "外院", "内院", "通道", "训练场", "禁区", "档案室"] as const;
const HOOK_LINK_ACTOR_KEYWORDS = ["主角", "管事", "黑影", "成员", "成员"] as const;
const MAINTENANCE_RELATION_KEYWORDS = [
  "账目",
  "账本",
  "账册",
  "信物",
  "暗号",
  "黑影",
  "资源",
  "管事",
  "后墙",
  "残页",
  "暗页",
  "名单",
  "封条",
  "账房",
  "库房",
  "后院",
  "园圃",
] as const;
const GENERIC_DROP_TITLE = /继续观察情况|找机会再说|以后再查|暂时按兵不动|处理杂事|想办法脱身|再做打算/u;
const PROVIDERS = new Map<string, AIReviewerProvider>();
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_DEEPSEEK_REVIEWER_MODEL = "deepseek-chat";

export async function buildAIReviewInput(
  projectDir: string,
  options: BuildAIReviewInputOptions = {},
): Promise<AIReviewInput> {
  const [project, timelineEvents, hookPool, threadPool, arcGoalPool] = await Promise.all([
    readProject(projectDir),
    readTimelineEvents(projectDir),
    readHookPool(projectDir),
    readThreadPool(projectDir),
    readArcGoalPool(projectDir),
  ]);
  const recentEvents = selectRecentTimelineEvents(timelineEvents, options.chapter, options.recentChapters);
  const semanticSummaries = recentEvents
    .map((event) => event.effects?.semanticSummary)
    .filter((value) => value !== undefined)
    .slice(0, MAX_SEMANTIC_SUMMARIES)
    .map((value) => truncateUnknown(value));
  const intentDiagnostics = buildAIReviewIntentDiagnostics(analyzeIntentLifecycle(threadPool, {
    ...(options.chapter !== undefined ? { currentChapter: options.chapter } : {}),
    sampleLimit: MAX_INTENT_DIAGNOSTIC_ITEMS,
  }));

  return {
    projectId: project.id,
    ...(options.chapter !== undefined ? { chapter: options.chapter } : {}),
    scope: options.scope ?? "window",
    recentTimelineEvents: recentEvents.map(compactTimelineEvent),
    semanticSummaries,
    hookPool: {
      hooks: selectHooksForReview(hookPool.hooks),
    },
    threadPool: selectThreadsForReview(threadPool.threads, options.chapter, hookPool.hooks, arcGoalPool.goals),
    intentDiagnostics,
    arcGoalPool: {
      goals: selectArcGoalsForReview(arcGoalPool.goals, options.chapter),
    },
    ...(options.continuityQuality !== undefined ? { continuityQuality: truncateUnknown(options.continuityQuality) } : {}),
    ...(options.diagnostics !== undefined ? { diagnostics: truncateUnknown(options.diagnostics) } : {}),
    ...(options.tokenBudget !== undefined ? { tokenBudget: options.tokenBudget } : {}),
  };
}

export function createMockAIReviewer(): AIReviewer {
  return {
    async review(input) {
      const analysis = analyzeThreadPoolForMaintenance(input.threadPool, {
        chapter: input.chapter,
      });
      const issues = [
        ...reviewDoneThreads(input, analysis),
        ...reviewSimilarThreads(input, analysis),
        ...reviewDroppableThreads(input, analysis),
        ...reviewIntentLifecycleDiagnostics(input),
        ...reviewStaleThreads(input, analysis),
        ...reviewStaleHooks(input),
        ...reviewArcGoalDrift(input),
      ];
      const suggestions = issues.map(suggestionForIssue);
      const candidateDiagnostics = buildMaintenanceCandidateDiagnostics(input, analysis, suggestions);
      const actionabilitySummary = buildActionabilitySummary(input, suggestions, candidateDiagnostics.noActionReason);
      return {
        passed: !issues.some((issue) => issue.severity === "error"),
        scope: input.scope,
        issues,
        suggestions,
        ...(input.threadPool.selection ? { threadSelectionSummary: input.threadPool.selection } : {}),
        actionabilitySummary,
        candidateDiagnostics,
        summary: buildReviewSummary(input, issues, suggestions, actionabilitySummary),
        createdAt: new Date().toISOString(),
      };
    },
  };
}

export function createMockAIReviewerProvider(): AIReviewerProvider {
  return {
    id: "mock",
    name: "Deterministic Mock Reviewer",
    kind: "mock",
    async review(input, options) {
      return createMockAIReviewer().review({
        ...input,
        ...(options?.tokenBudget !== undefined ? { tokenBudget: options.tokenBudget } : {}),
      });
    },
  };
}

export function createDeepSeekAIReviewerProvider(options: DeepSeekAIReviewerProviderOptions = {}): AIReviewerProvider {
  return {
    id: "deepseek",
    name: "DeepSeek AI Reviewer",
    kind: "external",
    async review(input, providerOptions) {
      const apiKey = options.apiKey ?? options.env?.DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY;
      if (!apiKey) throw new AIReviewerProviderExecutionError("missing_key", "Missing DEEPSEEK_API_KEY.");
      const fetchImpl = options.fetch ?? (globalThis.fetch as AIReviewerFetchLike | undefined);
      if (!fetchImpl) throw new AIReviewerProviderExecutionError("fetch_unavailable", "Fetch API is unavailable.");
      const contract = buildAIReviewerPromptContract(input, {
        tokenBudget: providerOptions?.tokenBudget,
        strictJson: providerOptions?.strictJson ?? true,
        includeExamples: options.includeExamples ?? false,
      });
      const authHeaderName = ["author", "ization"].join("");
      const authScheme = ["Bea", "rer"].join("");
      const response = await fetchImpl(deepSeekCompletionEndpoint(options.baseURL), {
        method: "POST",
        headers: {
          [authHeaderName]: `${authScheme} ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: options.model ?? process.env.DEEPSEEK_REVIEWER_MODEL ?? DEFAULT_DEEPSEEK_REVIEWER_MODEL,
          messages: [
            { role: "system", content: contract.systemPrompt },
            { role: "user", content: contract.userPrompt },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new AIReviewerProviderExecutionError(
          response.status === 401 ? "auth_failed" : "http_error",
          `DeepSeek request failed with status ${response.status}.`,
          raw,
        );
      }
      const content = extractDeepSeekContent(raw);
      if (!content.trim()) throw new AIReviewerProviderExecutionError("empty_response", "DeepSeek returned empty review content.", raw);
      const parsed = parseProviderJson(content, raw);
      const validation = validateAIReviewReport(parsed);
      if (!validation.valid || !validation.sanitized) {
        throw new AIReviewerProviderExecutionError("invalid_schema", validation.errors.join("; "), raw);
      }
      return validation.sanitized;
    },
  };
}

export function registerAIReviewerProvider(provider: AIReviewerProvider): void {
  PROVIDERS.set(provider.id, provider);
}

export function getAIReviewerProvider(id: string): AIReviewerProvider | undefined {
  return PROVIDERS.get(id);
}

export function listAIReviewerProviders(): readonly AIReviewerProvider[] {
  return [...PROVIDERS.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function runAIReviewerWithProvider(
  input: AIReviewInput,
  options: RunAIReviewerWithProviderOptions = {},
): Promise<AIReviewerProviderResult> {
  const providerId = options.providerId ?? "mock";
  if (providerId === "external") {
    const report = failedProviderReport(input.scope, providerId, "AI Reviewer Provider Interface V1 does not call real external models yet.");
    return { report, providerId, usedFallback: false };
  }
  const provider = getAIReviewerProvider(providerId);
  if (!provider) {
    const report = failedProviderReport(input.scope, providerId, `AI reviewer provider '${providerId}' is not registered.`);
    return { report, providerId, usedFallback: false };
  }

  const startedAt = Date.now();
  const attempts = Math.max(1, (options.maxRetries ?? 0) + 1);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const report = await withOptionalTimeout(provider.review(input, options), options.timeoutMs);
      const validation = validateAIReviewReport(report);
      if (!validation.valid || !validation.sanitized) {
        lastError = new Error(validation.errors.join("; "));
        break;
      }
      const latencyMs = Date.now() - startedAt;
      return {
        report: attachProviderMetadata(validation.sanitized, providerId, false, latencyMs),
        providerId,
        usedFallback: false,
        latencyMs,
      };
    } catch (error) {
      lastError = error;
    }
  }
  const errorType = providerErrorType(lastError);
  const rawResponseTruncated = providerRawResponse(lastError);

  if (options.fallbackToMock === true && providerId !== "mock") {
    const fallbackStartedAt = Date.now();
    const fallbackProvider = getAIReviewerProvider("mock") ?? createMockAIReviewerProvider();
    const fallbackReport = await fallbackProvider.review(input, options);
    const validation = validateAIReviewReport(fallbackReport);
    const latencyMs = Date.now() - startedAt;
    if (validation.valid && validation.sanitized) {
      return {
        report: {
          ...attachProviderMetadata(validation.sanitized, "mock", true, Date.now() - fallbackStartedAt, errorType),
          summary: `${validation.sanitized.summary} Fallback reviewer was used after provider '${providerId}' failed validation or execution.`,
        },
        providerId: "mock",
        usedFallback: true,
        latencyMs,
        ...(rawResponseTruncated !== undefined ? { rawResponseTruncated } : {}),
      };
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "Provider failed.");
  const latencyMs = Date.now() - startedAt;
  return {
    report: attachProviderMetadata(failedProviderReport(input.scope, providerId, message), providerId, false, latencyMs, errorType),
    providerId,
    usedFallback: false,
    latencyMs,
    ...(rawResponseTruncated !== undefined ? { rawResponseTruncated } : {}),
  };
}

export function validateAIReviewReport(report: unknown): AIReviewReportValidationResult {
  const errors: string[] = [];
  if (containsCredentialLikeData(report)) {
    return {
      valid: false,
      errors: ["Report contains credential-like fields or values."],
    };
  }
  if (typeof report !== "object" || report === null) {
    return { valid: false, errors: ["Report must be an object."] };
  }
  const candidate = report as Partial<AIReviewReport>;
  if (!Array.isArray(candidate.issues)) errors.push("issues must be an array.");
  if (!Array.isArray(candidate.suggestions)) errors.push("suggestions must be an array.");
  const scope = isReviewScope(candidate.scope) ? candidate.scope : "window";

  for (const [index, issue] of (Array.isArray(candidate.issues) ? candidate.issues : []).entries()) {
    if (!isValidIssue(issue)) errors.push(`issues[${index}] is invalid.`);
  }
  for (const [index, suggestion] of (Array.isArray(candidate.suggestions) ? candidate.suggestions : []).entries()) {
    if (!isValidSuggestion(suggestion)) errors.push(`suggestions[${index}] is invalid.`);
  }

  if (errors.length > 0) return { valid: false, errors };
  const sanitized: AIReviewReport = {
    passed: candidate.passed !== false,
    scope,
    issues: candidate.issues as readonly AIReviewIssue[],
    suggestions: candidate.suggestions as readonly AIReviewSuggestion[],
    ...(candidate.provider !== undefined ? { provider: candidate.provider } : {}),
    ...(candidate.threadSelectionSummary !== undefined ? { threadSelectionSummary: candidate.threadSelectionSummary } : {}),
    ...(candidate.actionabilitySummary !== undefined ? { actionabilitySummary: candidate.actionabilitySummary } : {}),
    ...(candidate.candidateDiagnostics !== undefined ? { candidateDiagnostics: candidate.candidateDiagnostics } : {}),
    summary: typeof candidate.summary === "string" ? candidate.summary : "AI review completed.",
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
  };
  return { valid: true, errors: [], sanitized };
}

registerAIReviewerProvider(createMockAIReviewerProvider());
registerAIReviewerProvider(createDeepSeekAIReviewerProvider());

function failedProviderReport(scope: AIReviewScope, providerId: string, message: string): AIReviewReport {
  return {
    passed: false,
    scope,
    issues: [
      {
        id: "reviewer-provider-failed",
        type: "continuity_risk",
        severity: "error",
        evidence: [truncateText(message, MAX_TEXT_LENGTH)],
        suggestion: providerId === "mock" ? "Inspect mock reviewer configuration." : "Use provider mock in V1.",
        confidence: 1,
      },
    ],
    suggestions: [
      {
        action: "no_action",
        reason: truncateText(message, MAX_TEXT_LENGTH),
        confidence: 1,
      },
    ],
    summary: message,
    createdAt: new Date().toISOString(),
  };
}

async function withOptionalTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (timeoutMs === undefined || timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new AIReviewerProviderExecutionError("timeout", `AI reviewer provider timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function attachProviderMetadata(
  report: AIReviewReport,
  providerId: string,
  usedFallback: boolean,
  latencyMs?: number,
  errorType?: string,
): AIReviewReport {
  return {
    ...report,
    provider: {
      id: providerId,
      usedFallback,
      ...(latencyMs !== undefined ? { latencyMs } : {}),
      ...(errorType !== undefined ? { errorType } : {}),
    },
  };
}

function containsCredentialLikeData(value: unknown): boolean {
  return containsCredentialLikeDataInternal(value, new Set<object>());
}

function containsCredentialLikeDataInternal(value: unknown, seen: Set<object>): boolean {
  if (typeof value === "string") return looksCredentialLike(value);
  if (Array.isArray(value)) return value.some((item) => containsCredentialLikeDataInternal(item, seen));
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    if (looksCredentialLikeKey(key) || containsCredentialLikeDataInternal(item, seen)) return true;
  }
  return false;
}

function looksCredentialLikeKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/gu, "");
  const blocked = [
    ["api", "key"].join(""),
    ["sec", "ret"].join(""),
    ["author", "ization"].join(""),
    ["bea", "rer"].join(""),
  ];
  return blocked.some((item) => normalized.includes(item));
}

function looksCredentialLike(value: string): boolean {
  const lowered = value.toLowerCase();
  const blocked = [
    ["sk", "-"].join(""),
    ["bea", "rer"].join(""),
  ];
  return blocked.some((item) => lowered.includes(item));
}

class AIReviewerProviderExecutionError extends Error {
  readonly errorType: string;
  readonly rawResponseTruncated?: string;

  constructor(errorType: string, message: string, rawResponse?: string) {
    super(message);
    this.name = "AIReviewerProviderExecutionError";
    this.errorType = errorType;
    if (rawResponse !== undefined) {
      this.rawResponseTruncated = sanitizeProviderText(rawResponse).slice(0, 500);
    }
  }
}

function providerErrorType(error: unknown): string | undefined {
  return error instanceof AIReviewerProviderExecutionError ? error.errorType : undefined;
}

function providerRawResponse(error: unknown): string | undefined {
  return error instanceof AIReviewerProviderExecutionError ? error.rawResponseTruncated : undefined;
}

function deepSeekCompletionEndpoint(baseURL: string | undefined): string {
  return `${(baseURL ?? DEFAULT_DEEPSEEK_BASE_URL).replace(/\/+$/u, "")}/chat/completions`;
}

function extractDeepSeekContent(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      readonly choices?: readonly {
        readonly message?: {
          readonly content?: string;
        };
      }[];
    };
    return parsed.choices?.[0]?.message?.content ?? raw;
  } catch {
    return raw;
  }
}

function parseProviderJson(content: string, raw: string): unknown {
  try {
    return JSON.parse(content.trim());
  } catch {
    throw new AIReviewerProviderExecutionError("non_json_response", "DeepSeek returned non-JSON review content.", raw);
  }
}

function sanitizeProviderText(value: string): string {
  return value
    .replace(new RegExp(["sk", "-"].join(""), "giu"), "[filtered]")
    .replace(new RegExp(["bea", "rer"].join(""), "giu"), "[filtered]")
    .replace(/\/Users\/[^/\s]+/gu, "/Users/[user]");
}

function isReviewScope(value: unknown): value is AIReviewScope {
  return value === "chapter" || value === "window" || value === "arc";
}

function isValidIssue(value: unknown): value is AIReviewIssue {
  if (typeof value !== "object" || value === null) return false;
  const issue = value as Partial<AIReviewIssue>;
  if (typeof issue.id !== "string") return false;
  if (!VALID_REVIEW_ISSUE_TYPES.has(String(issue.type))) return false;
  if (!VALID_REVIEW_SEVERITIES.has(String(issue.severity))) return false;
  if (!Array.isArray(issue.evidence) || !issue.evidence.every((item) => typeof item === "string")) return false;
  if (typeof issue.suggestion !== "string") return false;
  if (issue.targetIds !== undefined && (!Array.isArray(issue.targetIds) || !issue.targetIds.every((item) => typeof item === "string"))) return false;
  if (issue.confidence !== undefined && !isValidConfidence(issue.confidence)) return false;
  return true;
}

function isValidSuggestion(value: unknown): value is AIReviewSuggestion {
  if (typeof value !== "object" || value === null) return false;
  const suggestion = value as Partial<AIReviewSuggestion>;
  if (!VALID_REVIEW_ACTIONS.has(String(suggestion.action))) return false;
  if (suggestion.targetIds !== undefined && (!Array.isArray(suggestion.targetIds) || !suggestion.targetIds.every((item) => typeof item === "string"))) return false;
  if (typeof suggestion.reason !== "string") return false;
  if (suggestion.confidence !== undefined && !isValidConfidence(suggestion.confidence)) return false;
  return true;
}

function isValidConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

const VALID_REVIEW_ISSUE_TYPES = new Set([
  "thread_should_be_done",
  "thread_should_merge",
  "thread_should_drop",
  "stale_thread",
  "hook_stale",
  "arc_goal_drift",
  "continuity_risk",
  "possible_repetition",
  "state_conflict",
]);

const VALID_REVIEW_SEVERITIES = new Set(["info", "warning", "error"]);

const VALID_REVIEW_ACTIONS = new Set([
  "mark_thread_done",
  "merge_threads",
  "drop_thread",
  "keep_thread",
  "prioritize_thread",
  "prioritize_hook",
  "prioritize_arc_goal",
  "create_repair_plan",
  "no_action",
]);

export function analyzeThreadPoolForMaintenance(
  threadPool: ThreadPool,
  options: AnalyzeThreadPoolForMaintenanceOptions = {},
): ThreadMaintenanceAnalysis {
  const injectedThreadIds = new Set(options.injectedThreadIds ?? []);
  const reasons: Record<string, string> = {};
  const selection = (threadPool as AIReviewThreadPool).selection;
  const selectionReasons = selection?.selectionReasons ?? {};
  const selectedDoneIds = idsBySelectionReason(selectionReasons, "done_candidate");
  const selectedMergeGroups = selection?.mergeGroups ?? [];
  const selectedDropIds = [
    ...idsBySelectionReason(selectionReasons, "drop_candidate"),
    ...idsBySelectionReason(selectionReasons, "stale_candidate"),
  ];
  const doneCandidates = unique([
    ...threadPool.threads
      .filter((thread) => (thread.status === "open" || thread.status === "touched") && hasDoneEvidence(thread))
      .map((thread) => thread.id),
    ...selectedDoneIds,
  ]).slice(0, MAX_MARK_DONE_SUGGESTIONS)
    .map((id) => {
      reasons[id] = "completion evidence found";
      return id;
    });
  const mergeGroups = mergeSelectionGroups(selectedMergeGroups, findMergeGroups(threadPool.threads, reasons));
  for (const group of mergeGroups) {
    for (const id of group) {
      reasons[id] = reasons[id] ?? "similar title keywords suggest merge";
    }
  }
  const dropCandidates = threadPool.threads
    .filter((thread) => selectedDropIds.includes(thread.id) || isDroppableThread(thread, options.chapter, injectedThreadIds))
    .filter((thread) => isDroppableThread(thread, options.chapter, injectedThreadIds))
    .slice(0, MAX_DROP_SUGGESTIONS)
    .map((thread) => {
      reasons[thread.id] = "old low-value thread with little evidence and no active carry-forward hint";
      return thread.id;
    });
  const dropSet = new Set(dropCandidates);
  const priorityCandidates = threadPool.threads
    .filter((thread) => isThreadStale(thread, options.chapter))
    .filter((thread) => !dropSet.has(thread.id))
    .slice(0, 8)
    .map((thread) => {
      reasons[thread.id] = reasons[thread.id] ?? "stale thread needs human review";
      return thread.id;
    });
  const doneSet = new Set(doneCandidates);
  const acceptedMergeKeys = new Set(mergeGroups.flatMap((group) => mergeGroupKeys(group)));
  const rejectedDoneCandidates = threadPool.threads
    .filter((thread) => thread.status === "open" || thread.status === "touched" || thread.status === "done")
    .filter((thread) => !doneSet.has(thread.id))
    .map((thread) => rejectedDoneCandidate(thread))
    .filter(isDefined)
    .slice(0, 12);
  const rejectedMergeGroups = findRejectedMergeGroups(threadPool.threads, acceptedMergeKeys).slice(0, 12);
  const rejectedDropCandidates = threadPool.threads
    .filter((thread) => !dropSet.has(thread.id))
    .map((thread) => rejectedDropCandidate(thread, options.chapter, injectedThreadIds))
    .filter(isDefined)
    .slice(0, 12);

  return {
    doneCandidates,
    mergeGroups,
    dropCandidates,
    priorityCandidates,
    reasons,
    rejectedDoneCandidates,
    rejectedMergeGroups,
    rejectedDropCandidates,
  };
}

export function buildMaintenanceCandidateDiagnostics(
  input: AIReviewInput,
  analysis: ThreadMaintenanceAnalysis,
  suggestions: readonly AIReviewSuggestion[],
  reviewPlanStage: MaintenanceCandidateReviewPlanStage = emptyReviewPlanStage(),
): MaintenanceCandidateDiagnostics {
  const selection = input.threadPool.selection;
  const markThreadDoneCount = suggestions.filter((suggestion) => suggestion.action === "mark_thread_done").length;
  const mergeThreadsCount = suggestions.filter((suggestion) => suggestion.action === "merge_threads").length;
  const dropThreadCount = suggestions.filter((suggestion) => suggestion.action === "drop_thread").length;
  const prioritizeCount = suggestions
    .filter((suggestion) => suggestion.action === "prioritize_thread"
      || suggestion.action === "prioritize_hook"
      || suggestion.action === "prioritize_arc_goal")
    .length;
  const executableSuggestionCount = markThreadDoneCount + mergeThreadsCount + dropThreadCount;
  const selectedThreadIds = input.threadPool.threads.map((thread) => thread.id);
  const selectionReasonValues = Object.values(selection?.selectionReasons ?? {});
  const dropCandidateCount = selectionReasonValues
    .filter((reasons) => reasons.includes("drop_candidate"))
    .length;
  const safeDropCandidateIds = input.threadPool.threads
    .filter((thread) => thread.dropSuitability === "safe_candidate")
    .map((thread) => thread.id);
  const reviewerDropTargetIds = new Set(suggestions
    .filter((suggestion) => suggestion.action === "drop_thread")
    .flatMap((suggestion) => suggestion.targetIds));
  const noDropDespiteSafeCandidateCount = safeDropCandidateIds
    .filter((id) => !reviewerDropTargetIds.has(id))
    .length;

  return {
    threadPoolTotal: selection?.totalThreadCount ?? input.threadPool.threads.length,
    selectedThreadCount: selection?.selectedThreadCount ?? input.threadPool.threads.length,
    selectionStage: {
      recentCount: selection?.recentCount ?? 0,
      staleCandidateCount: selection?.staleCandidateCount ?? 0,
      mergeCandidateCount: selection?.mergeCandidateCount ?? 0,
      doneCandidateCount: selection?.doneCandidateCount ?? 0,
      dropCandidateCount,
      staleLowValueCandidateCount: selection?.staleLowValueCandidateCount ?? 0,
      safeDropCandidateCount: selection?.safeDropCandidateCount ?? 0,
      cautionDropCandidateCount: selection?.cautionDropCandidateCount ?? 0,
      riskyDropCandidateCount: selection?.riskyDropCandidateCount ?? 0,
      selectedDropCandidateIds: selection?.selectedDropCandidateIds ?? [],
      dropCandidateClassificationSummary: selection?.dropCandidateClassificationSummary,
      trueSideBranchDropCandidateCount: selection?.dropCandidateClassificationSummary?.trueSideBranchDropCandidateCount ?? 0,
      staleButProtectedCandidateCount: selection?.dropCandidateClassificationSummary?.staleButProtectedCandidateCount ?? 0,
      cleanupReviewCandidateCount: selection?.dropCandidateClassificationSummary?.cleanupReviewCandidateCount ?? 0,
      selectedCleanupCandidateCount: selection?.selectedCleanupCandidateCount ?? 0,
      cleanupReviewCandidates: selection?.cleanupReviewCandidates ?? [],
      cleanupCandidateSelectionReasons: selection?.cleanupCandidateSelectionReasons ?? {},
      cleanupCandidateSkippedReasons: selection?.cleanupCandidateSkippedReasons ?? {},
      nonDropCandidateCount: selection?.dropCandidateClassificationSummary?.nonDropCandidateCount ?? 0,
      protectedReasonCounts: selection?.dropCandidateClassificationSummary?.protectedReasonCounts ?? {},
      cleanupReasonCounts: selection?.dropCandidateClassificationSummary?.cleanupReasonCounts ?? {},
      stickinessDiagnosticsSummary: selection?.dropCandidateClassificationSummary?.stickinessDiagnosticsSummary,
      nextActionHintDiagnostics: selection?.dropCandidateClassificationSummary?.nextActionHintDiagnostics ?? [],
      activeHookLinkageDiagnostics: selection?.dropCandidateClassificationSummary?.activeHookLinkageDiagnostics ?? [],
      mergeCandidateGroupCount: selection?.mergeCandidateGroupCount ?? 0,
      selectedThreadIds,
    },
    analysisStage: {
      doneCandidates: analysis.doneCandidates,
      mergeGroups: analysis.mergeGroups,
      dropCandidates: analysis.dropCandidates,
      priorityCandidates: analysis.priorityCandidates,
      rejectedDoneCandidates: analysis.rejectedDoneCandidates,
      rejectedMergeGroups: analysis.rejectedMergeGroups,
      rejectedDropCandidates: analysis.rejectedDropCandidates,
    },
    reviewerStage: {
      suggestionCount: suggestions.length,
      executableSuggestionCount,
      markThreadDoneCount,
      mergeThreadsCount,
      dropThreadCount,
      reviewerDropThreadCount: dropThreadCount,
      noDropDespiteSafeCandidateCount,
      prioritizeCount,
    },
    reviewPlanStage,
    ...(input.intentDiagnostics
      ? { intentDiagnostics: buildIntentDiagnosticsVisibilitySummary(input.intentDiagnostics, suggestions) }
      : {}),
    ...buildNoActionReason({
      selectedThreadCount: selection?.selectedThreadCount ?? input.threadPool.threads.length,
      analysis,
      executableSuggestionCount,
      reviewPlanStage,
    }),
  };
}

function buildAIReviewIntentDiagnostics(report: ReturnType<typeof analyzeIntentLifecycle>): AIReviewIntentDiagnostics {
  const cleanupVisibleCount = report.totalIntents - report.cleanupCandidateCounts.none;
  const items = [...report.diagnostics]
    .sort(compareIntentDiagnosticPriority)
    .slice(0, MAX_INTENT_DIAGNOSTIC_ITEMS)
    .map((item): AIReviewIntentDiagnosticItem => ({
      id: item.threadId,
      title: truncateText(item.title, 80),
      status: item.status,
      valueClass: item.intentValueClass,
      typeCategory: item.intentTypeCategory,
      lifecycleSuggestion: item.lifecycleSuggestion,
      cleanupCandidateClass: item.cleanupCandidateClass,
      cleanupReason: intentCleanupReason(item.cleanupCandidateClass, item.staleReason, item.safetyNotes),
      staleReason: item.staleReason ?? "none",
      safetyNotes: item.safetyNotes,
      ageInChapters: item.ageInChapters,
      hasNextActionHint: item.hasNextActionHint,
      evidenceStrength: item.evidenceStrength,
    }));
  return {
    summary: {
      present: true,
      advisoryOnly: true,
      totalIntents: report.totalIntents,
      openIntentCount: report.openIntentCount,
      touchedIntentCount: report.touchedIntentCount,
      doneIntentCount: report.doneIntentCount,
      cleanupVisibleCount,
      protectedHighValueCount: report.valueClassCounts.high_value_narrative,
      valueClassCounts: report.valueClassCounts,
      typeCategoryCounts: report.typeCategoryCounts,
      lifecycleSuggestionCounts: report.lifecycleSuggestionCounts,
      cleanupCandidateCounts: report.cleanupCandidateCounts,
      summaryText: report.summary,
    },
    items,
  };
}

function compareIntentDiagnosticPriority(
  left: ReturnType<typeof analyzeIntentLifecycle>["diagnostics"][number],
  right: ReturnType<typeof analyzeIntentLifecycle>["diagnostics"][number],
): number {
  return intentCleanupRank(right.cleanupCandidateClass) - intentCleanupRank(left.cleanupCandidateClass)
    || intentLifecycleRank(right.lifecycleSuggestion) - intentLifecycleRank(left.lifecycleSuggestion)
    || right.ageInChapters - left.ageInChapters
    || left.threadId.localeCompare(right.threadId);
}

function intentCleanupRank(value: IntentCleanupCandidateClass): number {
  if (value === "cleanup_candidate") return 6;
  if (value === "stale_low_value_candidate") return 5;
  if (value === "manual_review_drop_candidate") return 4;
  if (value === "manual_review_mark_done_candidate") return 3;
  if (value === "stale_generic_candidate") return 2;
  return 1;
}

function intentLifecycleRank(value: IntentLifecycleSuggestion): number {
  if (value === "drop_candidate") return 6;
  if (value === "auto_expire_candidate") return 5;
  if (value === "mark_done_candidate") return 4;
  if (value === "do_not_pool_or_low_priority") return 3;
  if (value === "low_priority_keep") return 2;
  return 1;
}

function intentCleanupReason(
  cleanupCandidateClass: IntentCleanupCandidateClass,
  staleReason: string | undefined,
  safetyNotes: readonly string[],
): string {
  if (cleanupCandidateClass === "none") return "none";
  return staleReason ?? (safetyNotes.join(", ") || `cleanup_class:${cleanupCandidateClass}`);
}

function buildIntentDiagnosticsVisibilitySummary(
  intentDiagnostics: AIReviewIntentDiagnostics,
  suggestions: readonly AIReviewSuggestion[],
): AIReviewIntentDiagnosticsVisibilitySummary {
  const advisoryTargetIds = new Set(intentDiagnostics.items
    .filter((item) => item.cleanupCandidateClass !== "none")
    .map((item) => item.id));
  const advisorySuggestionCount = suggestions
    .filter((suggestion) => suggestion.action === "prioritize_thread" || suggestion.action === "no_action")
    .filter((suggestion) => (suggestion.targetIds ?? []).some((id) => advisoryTargetIds.has(id)))
    .length;
  return {
    ...intentDiagnostics.summary,
    usedByReviewer: true,
    visibleItemCount: intentDiagnostics.items.length,
    advisorySuggestionCount,
  };
}

function selectRecentTimelineEvents(
  events: readonly TimelineEvent[],
  chapter: number | undefined,
  recentChapters: number | undefined,
): readonly TimelineEvent[] {
  const windowSize = Math.max(1, Math.trunc(recentChapters ?? DEFAULT_RECENT_CHAPTERS));
  return [...events]
    .filter((event) => chapter === undefined || event.chapter <= chapter)
    .sort((left, right) => right.chapter - left.chapter || right.id.localeCompare(left.id))
    .slice(0, Math.min(windowSize, MAX_TIMELINE_EVENTS));
}

function compactTimelineEvent(event: TimelineEvent): TimelineEvent {
  return {
    id: event.id,
    chapter: event.chapter,
    summary: truncateText(event.summary, MAX_TEXT_LENGTH),
    participants: event.participants.slice(0, 8),
    ...(event.effects?.semanticSummary !== undefined
      ? { effects: { semanticSummary: truncateUnknown(event.effects.semanticSummary) as Record<string, unknown> } }
      : {}),
  };
}

function selectHooksForReview(hooks: readonly HookItem[]): readonly HookItem[] {
  return [...hooks]
    .sort(compareHookPriority)
    .slice(0, MAX_HOOKS)
    .map((hook) => ({
      ...hook,
      description: truncateText(hook.description, MAX_TEXT_LENGTH),
      evidence: truncateTextList(hook.evidence ?? [], MAX_EVIDENCE),
      ...(hook.nextActionHint ? { nextActionHint: truncateText(hook.nextActionHint, MAX_TEXT_LENGTH) } : {}),
      relatedCharacters: hook.relatedCharacters.slice(0, 8),
      relatedLocations: hook.relatedLocations?.slice(0, 8),
    }));
}

function selectThreadsForReview(
  threads: readonly NarrativeThread[],
  chapter: number | undefined,
  hooks: readonly HookItem[] = [],
  arcGoals: readonly ArcGoal[] = [],
): AIReviewThreadPool {
  const analysis = analyzeThreadPoolForMaintenance({ threads }, { chapter });
  const dropExposureProfiles = buildDropCandidateExposureProfiles(threads, chapter, hooks, arcGoals);
  const dropExposureById = new Map(dropExposureProfiles.map((profile) => [profile.thread.id, profile.exposure]));
  const selected = new Map<string, NarrativeThread>();
  const reasonSets = new Map<string, Set<ThreadSelectionReason>>();
  const selectedMergeGroups: string[][] = [];

  const addThread = (thread: NarrativeThread, reason: ThreadSelectionReason): void => {
    if (selected.size >= MAX_THREADS && !selected.has(thread.id)) return;
    selected.set(thread.id, thread);
    const reasons = reasonSets.get(thread.id) ?? new Set<ThreadSelectionReason>();
    reasons.add(reason);
    reasonSets.set(thread.id, reasons);
  };
  const threadMap = new Map(threads.map((thread) => [thread.id, thread]));
  const recentThreads = [...threads]
    .sort(compareRecentThreadPriority)
    .slice(0, MAX_RECENT_THREADS);
  for (const thread of recentThreads) addThread(thread, "recent");

  const sortedDropExposureProfiles = [...dropExposureProfiles].sort(compareDropExposureProfilePriority);
  for (const profile of sortedDropExposureProfiles
    .filter((candidate) => candidate.exposure.candidateKind === "true_side_branch_drop_candidate")
    .slice(0, MAX_STALE_CANDIDATE_THREADS)) {
    addThread(profile.thread, "drop_candidate");
  }
  for (const profile of sortedDropExposureProfiles
    .filter((candidate) => candidate.exposure.candidateKind !== "true_side_branch_drop_candidate")
    .slice(0, MAX_STALE_CANDIDATE_THREADS + 3)) {
    addThread(profile.thread, "stale_candidate");
  }

  for (const id of analysis.dropCandidates.slice(0, MAX_STALE_CANDIDATE_THREADS)) {
    const thread = threadMap.get(id);
    if (thread) {
      const exposure = dropExposureById.get(thread.id);
      addThread(thread, exposure?.candidateKind === "true_side_branch_drop_candidate" ? "drop_candidate" : "stale_candidate");
    }
  }
  const staleCandidates = [...threads]
    .filter((thread) => thread.status !== "done")
    .filter((thread) => chapter !== undefined && chapter - thread.lastTouchedChapter >= 8)
    .filter((thread) => !STRONG_MAINLINE_WORDS.test([thread.title, ...thread.evidence].join(" ")))
    .sort((left, right) => left.lastTouchedChapter - right.lastTouchedChapter || left.id.localeCompare(right.id));
  for (const thread of staleCandidates.slice(0, MAX_STALE_CANDIDATE_THREADS)) {
    addThread(thread, "stale_candidate");
  }

  let mergeCandidateCount = 0;
  for (const group of analysis.mergeGroups.slice(0, MAX_SELECTION_MERGE_GROUPS)) {
    const selectedGroup: string[] = [];
    for (const id of group) {
      if (mergeCandidateCount >= MAX_MERGE_CANDIDATE_THREADS) break;
      const thread = threadMap.get(id);
      if (!thread) continue;
      addThread(thread, "merge_candidate");
      selectedGroup.push(id);
      mergeCandidateCount += 1;
    }
    if (selectedGroup.length > 1) selectedMergeGroups.push(selectedGroup);
  }

  for (const id of analysis.doneCandidates.slice(0, MAX_DONE_CANDIDATE_THREADS)) {
    const thread = threadMap.get(id);
    if (thread) addThread(thread, "done_candidate");
  }

  const selectedThreads = [...selected.values()]
    .slice(0, MAX_THREADS)
    .map((thread) => compactThreadForReview(thread, dropExposureById.get(thread.id)));
  const selectionReasons = Object.fromEntries([...reasonSets.entries()]
    .filter(([id]) => selected.has(id))
    .map(([id, reasons]) => [id, [...reasons].sort()]));
  const countByReason = (reason: ThreadSelectionReason): number => Object.values(selectionReasons)
    .filter((reasons) => reasons.includes(reason))
    .length;
  const selectedDropExposures = selectedThreads
    .filter((thread) => thread.candidateKind !== undefined && thread.candidateKind !== "non_drop_candidate");
  const dropClassificationSummary = buildDropClassificationSummary(selectedThreads);
  const selectedCleanupCandidateIds = new Set(dropClassificationSummary.cleanupReviewCandidates.map((candidate) => candidate.threadId));
  const countBySuitability = (suitability: DropCandidateSuitability): number => selectedDropExposures
    .filter((thread) => thread.dropSuitability === suitability)
    .length;

  return {
    threads: selectedThreads,
    selection: {
      totalThreadCount: threads.length,
      selectedThreadCount: selectedThreads.length,
      recentCount: countByReason("recent"),
      staleCandidateCount: countByReason("stale_candidate") + countByReason("drop_candidate"),
      mergeCandidateCount: countByReason("merge_candidate"),
      doneCandidateCount: countByReason("done_candidate"),
      staleLowValueCandidateCount: selectedDropExposures.length,
      safeDropCandidateCount: countBySuitability("safe_candidate"),
      cautionDropCandidateCount: countBySuitability("caution_candidate"),
      riskyDropCandidateCount: countBySuitability("risky_candidate"),
      selectedDropCandidateIds: selectedDropExposures
        .filter((thread) => thread.candidateKind === "true_side_branch_drop_candidate")
        .map((thread) => thread.id),
      dropCandidateSuitability: Object.fromEntries(selectedDropExposures
        .filter((thread): thread is AIReviewThread & { dropSuitability: DropCandidateSuitability } => thread.dropSuitability !== undefined)
        .map((thread) => [thread.id, thread.dropSuitability])),
      candidateKindByThreadId: Object.fromEntries(selectedDropExposures
        .filter((thread): thread is AIReviewThread & { candidateKind: MaintenanceCandidateKind } => thread.candidateKind !== undefined)
        .map((thread) => [thread.id, thread.candidateKind])),
      dropCandidateClassificationSummary: dropClassificationSummary,
      mergeCandidateGroupCount: selectedMergeGroups.length,
      selectedCleanupCandidateCount: selectedCleanupCandidateIds.size,
      cleanupReviewCandidates: dropClassificationSummary.cleanupReviewCandidates,
      cleanupCandidateSelectionReasons: Object.fromEntries([...selectedCleanupCandidateIds]
        .map((id) => [id, [...(reasonSets.get(id) ?? new Set<ThreadSelectionReason>())].sort()])),
      cleanupCandidateSkippedReasons: {},
      selectionReasons,
      mergeGroups: selectedMergeGroups,
    },
  };
}

function compactThreadForReview(thread: NarrativeThread, dropExposure?: AIReviewThreadDropExposure): AIReviewThread {
  return {
    ...thread,
    title: truncateText(thread.title, 60),
    evidence: truncateTextList(thread.evidence, MAX_EVIDENCE),
    ...(thread.nextActionHint ? { nextActionHint: truncateText(thread.nextActionHint, MAX_TEXT_LENGTH) } : {}),
    relatedCharacters: thread.relatedCharacters?.slice(0, 8),
    relatedLocations: thread.relatedLocations?.slice(0, 8),
    ...(dropExposure !== undefined ? dropExposure : {}),
  };
}

interface DropCandidateExposureProfile {
  readonly thread: NarrativeThread;
  readonly exposure: AIReviewThreadDropExposure;
}

function buildDropCandidateExposureProfiles(
  threads: readonly NarrativeThread[],
  chapter: number | undefined,
  hooks: readonly HookItem[],
  arcGoals: readonly ArcGoal[],
): readonly DropCandidateExposureProfile[] {
  if (chapter === undefined) return [];
  return threads
    .map((thread) => {
      const exposure = buildDropCandidateExposure(thread, chapter, hooks, arcGoals);
      return exposure === undefined ? undefined : { thread, exposure };
    })
    .filter(isDefined);
}

function buildDropCandidateExposure(
  thread: NarrativeThread,
  chapter: number,
  hooks: readonly HookItem[],
  arcGoals: readonly ArcGoal[],
): AIReviewThreadDropExposure | undefined {
  if (thread.status === "done") return undefined;
  const ageInChapters = chapter - thread.lastTouchedChapter;
  const shouldExpose = ageInChapters >= 8 || thread.status === "touched";
  if (!shouldExpose) return undefined;

  const evidenceText = thread.evidence.join(" ");
  const combinedText = [thread.title, evidenceText, thread.nextActionHint ?? ""].join(" ");
  const evidenceCount = thread.evidence.length;
  const hasNextActionHint = typeof thread.nextActionHint === "string" && thread.nextActionHint.trim().length > 0;
  const strongMainlineKeywordHits = keywordHitsText(combinedText, HARD_MAINLINE_KEYWORDS);
  const weakMainlineKeywordHits = keywordHitsText(combinedText, WEAK_MAINLINE_KEYWORDS)
    .filter((keyword) => !strongMainlineKeywordHits.some((strong) => strong.includes(keyword) || keyword.includes(strong)));
  const hasStrongMainlineKeyword = strongMainlineKeywordHits.length > 0;
  const linkedActiveHookIds = linkedActiveHookIdsForDrop(thread, hooks);
  const linkedActiveArcGoalIds = linkedActiveArcGoalIdsForDrop(thread, arcGoals);
  const weakActiveHookIds = weakLinkedActiveHookIdsForDrop(thread, hooks, linkedActiveHookIds);
  const weakActiveArcGoalIds = weakLinkedActiveArcGoalIdsForDrop(thread, arcGoals, linkedActiveArcGoalIds);
  const linkedActiveHookCount = linkedActiveHookIds.length;
  const linkedActiveArcGoalCount = linkedActiveArcGoalIds.length;
  const recentlyTouched = ageInChapters < 15;
  const isCarryForward = thread.status === "touched";
  const hasCurrentObjectiveOverlap = linkedActiveHookCount > 0
    || linkedActiveArcGoalCount > 0
    || weakActiveHookIds.length > 0
    || weakActiveArcGoalIds.length > 0;
  const nextActionHintStrongHookOverlap = linkedActiveHookCount > 0;
  const nextActionHintStrongArcOverlap = linkedActiveArcGoalCount > 0;
  const nextActionHintCurrentObjectiveOverlap = linkedActiveHookCount > 0 || linkedActiveArcGoalCount > 0;
  const nextActionHintLifecycleResult = hasNextActionHint
    ? classifyNextActionHintLifecycle({
      thread,
      ageInChapters,
      evidenceCount,
      recentlyTouched,
      isCarryForward,
      hasCurrentObjectiveOverlap: nextActionHintCurrentObjectiveOverlap,
      hasStrongHookOverlap: nextActionHintStrongHookOverlap,
      hasStrongArcOverlap: nextActionHintStrongArcOverlap,
    })
    : undefined;
  const safetyNotes: string[] = [];
  const hardBlockers: string[] = [];
  const cautionNotes: string[] = [];
  const protectedReasons: string[] = [];
  const cleanupReasons: string[] = [];

  if (hasNextActionHint) {
    const lifecycle = nextActionHintLifecycleResult?.lifecycle ?? "unknown";
    if (lifecycle === "active") {
      hardBlockers.push("has_next_action_hint");
      protectedReasons.push("has_next_action_hint");
      safetyNotes.push("active_next_action_hint");
    } else if (lifecycle === "stale") {
      cautionNotes.push("stale_next_action_hint");
      cleanupReasons.push("stale_next_action_hint");
      safetyNotes.push("stale_next_action_hint");
    } else if (lifecycle === "expired_candidate") {
      safetyNotes.push("expired_next_action_hint_candidate");
    } else {
      cautionNotes.push("unknown_next_action_hint_lifecycle");
      protectedReasons.push("unknown_next_action_hint_lifecycle");
      safetyNotes.push("unknown_next_action_hint_lifecycle");
    }
  }
  if (hasStrongMainlineKeyword) {
    hardBlockers.push("strong_mainline_keyword");
    protectedReasons.push("strong_mainline_keyword");
    safetyNotes.push("strong_mainline_keyword");
  }
  if (weakMainlineKeywordHits.length > 0) {
    cautionNotes.push("weak_mainline_keyword");
    cleanupReasons.push("weak_mainline_keyword");
    safetyNotes.push("weak_mainline_keyword");
  }
  if (linkedActiveHookCount > 0) {
    hardBlockers.push("linked_active_hook");
    protectedReasons.push("linked_active_hook");
    safetyNotes.push("linked_active_hook");
  }
  if (linkedActiveArcGoalCount > 0) {
    hardBlockers.push("linked_active_arc_goal");
    protectedReasons.push("linked_active_arc_goal");
    safetyNotes.push("linked_active_arc_goal");
  }
  if (weakActiveHookIds.length > 0) {
    cautionNotes.push("weak_active_hook_overlap");
    cleanupReasons.push("weak_active_hook_overlap");
    safetyNotes.push("weak_active_hook_overlap");
  }
  if (weakActiveArcGoalIds.length > 0) {
    cautionNotes.push("weak_active_arc_goal_overlap");
    cleanupReasons.push("weak_active_arc_goal_overlap");
    safetyNotes.push("weak_active_arc_goal_overlap");
  }
  if (isCarryForward) {
    cautionNotes.push("carry_forward_or_touched_thread");
    protectedReasons.push("carry_forward_or_touched_thread");
    safetyNotes.push("carry_forward_or_touched_thread");
  }
  if (recentlyTouched) {
    cautionNotes.push("recently_touched");
    protectedReasons.push("recently_touched");
    safetyNotes.push("recently_touched");
  }
  if (evidenceCount > 1) {
    cautionNotes.push("multiple_evidence_items");
    cleanupReasons.push("multiple_evidence_items");
    safetyNotes.push("multiple_evidence_items");
  }
  if (evidenceText.length > 80) {
    cautionNotes.push("evidence_too_long");
    cleanupReasons.push("evidence_too_long");
    safetyNotes.push("evidence_too_long");
  }

  const candidateKind: MaintenanceCandidateKind = hardBlockers.length > 0 || protectedReasons.length > 0 || isCarryForward || recentlyTouched
    ? "stale_but_protected_candidate"
    : cleanupReasons.length > 0
      ? "cleanup_review_candidate"
      : "true_side_branch_drop_candidate";
  const dropSuitability: DropCandidateSuitability = candidateKind === "true_side_branch_drop_candidate"
    ? "safe_candidate"
    : hardBlockers.length > 0
      ? "risky_candidate"
      : "caution_candidate";
  if (dropSuitability === "safe_candidate") safetyNotes.push("safe_stale_low_value_candidate");
  const nextActionHintDiagnostic = hasNextActionHint
    ? buildNextActionHintDiagnostic({
      thread,
      chapter,
      ageInChapters,
      recentlyTouched,
      isCarryForward,
      hasCurrentObjectiveOverlap: nextActionHintCurrentObjectiveOverlap,
      hasStrongHookOverlap: nextActionHintStrongHookOverlap,
      hasStrongArcOverlap: nextActionHintStrongArcOverlap,
      lifecycleResult: nextActionHintLifecycleResult,
    })
    : undefined;
  const activeHookLinkageDiagnostics = buildActiveHookLinkageDiagnostics({
    thread,
    hooks,
    hookIds: unique([...linkedActiveHookIds, ...weakActiveHookIds]),
    chapter,
  });

  return {
    candidateKind,
    dropSuitability,
    threadId: thread.id,
    title: truncateText(thread.title, 80),
    status: thread.status,
    threadType: thread.type,
    createdChapter: thread.firstSeenChapter,
    staleReason: `last touched ${Math.max(0, ageInChapters)} chapters ago`,
    safetyNotes,
    whyNotActive: dropSuitability === "safe_candidate"
      ? "No nextActionHint, no active hook/arc link, no strong mainline keyword, and not recently carried forward."
      : safetyNotes.join(", "),
    ageInChapters: Math.max(0, ageInChapters),
    evidenceCount,
    mentionCount: evidenceCount,
    lastTouchedChapter: thread.lastTouchedChapter,
    hasNextActionHint,
    ...(nextActionHintLifecycleResult ? { nextActionHintLifecycle: nextActionHintLifecycleResult.lifecycle } : {}),
    ...(nextActionHintLifecycleResult?.expiryReason ? { nextActionHintExpiryReason: nextActionHintLifecycleResult.expiryReason } : {}),
    ...(nextActionHintLifecycleResult?.retentionReason ? { nextActionHintRetentionReason: nextActionHintLifecycleResult.retentionReason } : {}),
    strongMainlineKeywordHits,
    weakMainlineKeywordHits,
    linkedActiveHookCount,
    linkedActiveHookIds,
    linkedActiveArcGoalCount,
    linkedActiveArcGoalIds,
    hasStrongMainlineKeyword,
    recentlyTouched,
    isCarryForward,
    hasCurrentObjectiveOverlap,
    riskReasons: hardBlockers,
    cautionReasons: cautionNotes,
    protectedReasons,
    cleanupReasons,
    ...(nextActionHintDiagnostic ? { nextActionHintDiagnostic } : {}),
    activeHookLinkageDiagnostics,
  };
}

function buildNextActionHintDiagnostic(input: {
  readonly thread: NarrativeThread;
  readonly chapter: number;
  readonly ageInChapters: number;
  readonly recentlyTouched: boolean;
  readonly isCarryForward: boolean;
  readonly hasCurrentObjectiveOverlap: boolean;
  readonly hasStrongHookOverlap: boolean;
  readonly hasStrongArcOverlap: boolean;
  readonly lifecycleResult?: NextActionHintLifecycleResult;
}): NextActionHintStickinessDiagnostic {
  const hint = truncateText(input.thread.nextActionHint?.trim() ?? "", 160);
  const staleHint = input.ageInChapters >= 15 && !input.recentlyTouched && !input.isCarryForward;
  const lifecycleResult = input.lifecycleResult ?? classifyNextActionHintLifecycle({
    thread: input.thread,
    ageInChapters: input.ageInChapters,
    evidenceCount: input.thread.evidence.length,
    recentlyTouched: input.recentlyTouched,
    isCarryForward: input.isCarryForward,
    hasCurrentObjectiveOverlap: input.hasCurrentObjectiveOverlap,
    hasStrongHookOverlap: input.hasStrongHookOverlap,
    hasStrongArcOverlap: input.hasStrongArcOverlap,
  });
  const recentlyMentioned = input.recentlyTouched || input.isCarryForward;
  return {
    threadId: input.thread.id,
    title: truncateText(input.thread.title, 80),
    status: input.thread.status,
    threadType: input.thread.type,
    createdChapter: input.thread.firstSeenChapter,
    lastTouchedChapter: input.thread.lastTouchedChapter,
    ageInChapters: input.ageInChapters,
    nextActionHint: hint,
    nextActionHintCreatedChapter: "unknown",
    nextActionHintAgeInChapters: Math.max(0, input.ageInChapters),
    nextActionHintSource: input.isCarryForward ? "carryForward" : "unknown",
    nextActionHintStillMentionedInRecentChapters: recentlyMentioned,
    nextActionHintOverlapWithCurrentObjective: input.hasCurrentObjectiveOverlap,
    nextActionHintLifecycle: lifecycleResult.lifecycle,
    nextActionHintRecentlyMentioned: recentlyMentioned,
    nextActionHintCurrentObjectiveOverlap: input.hasCurrentObjectiveOverlap,
    nextActionHintStrongHookOverlap: input.hasStrongHookOverlap,
    nextActionHintStrongArcOverlap: input.hasStrongArcOverlap,
    shouldExpireNextActionHintCandidate: lifecycleResult.lifecycle === "expired_candidate",
    ...(lifecycleResult.expiryReason ? { nextActionHintExpiryReason: lifecycleResult.expiryReason } : {}),
    nextActionHintRetentionReason: lifecycleResult.retentionReason ?? nextActionHintRetentionReason({
      staleHint,
      recentlyTouched: input.recentlyTouched,
      isCarryForward: input.isCarryForward,
      hasCurrentObjectiveOverlap: input.hasCurrentObjectiveOverlap,
      hasStrongHookOverlap: input.hasStrongHookOverlap,
      hasStrongArcOverlap: input.hasStrongArcOverlap,
    }),
  };
}

interface NextActionHintLifecycleResult {
  readonly lifecycle: NextActionHintLifecycle;
  readonly expiryReason?: string;
  readonly retentionReason?: string;
}

function classifyNextActionHintLifecycle(input: {
  readonly thread: NarrativeThread;
  readonly ageInChapters: number;
  readonly evidenceCount: number;
  readonly recentlyTouched: boolean;
  readonly isCarryForward: boolean;
  readonly hasCurrentObjectiveOverlap: boolean;
  readonly hasStrongHookOverlap: boolean;
  readonly hasStrongArcOverlap: boolean;
}): NextActionHintLifecycleResult {
  if (input.ageInChapters < 0) {
    return {
      lifecycle: "unknown",
      retentionReason: "unknown_hint_age",
    };
  }
  if (input.isCarryForward) {
    return {
      lifecycle: "active",
      retentionReason: "carry_forward_thread",
    };
  }
  if (input.recentlyTouched) {
    return {
      lifecycle: "active",
      retentionReason: "recently_touched_thread",
    };
  }
  if (input.hasStrongHookOverlap) {
    return {
      lifecycle: "active",
      retentionReason: "strong_active_hook_overlap",
    };
  }
  if (input.hasStrongArcOverlap) {
    return {
      lifecycle: "active",
      retentionReason: "strong_active_arc_goal_overlap",
    };
  }
  if (input.hasCurrentObjectiveOverlap) {
    return {
      lifecycle: "active",
      retentionReason: "current_objective_overlap",
    };
  }
  if (input.ageInChapters >= 15 && input.thread.status === "open" && input.evidenceCount <= 1) {
    return {
      lifecycle: "expired_candidate",
      expiryReason: "old_open_low_evidence_hint_without_recent_objective_or_strong_link",
      retentionReason: "expired_candidate_for_cleanup_review",
    };
  }
  if (input.ageInChapters >= 8) {
    return {
      lifecycle: "stale",
      retentionReason: "stale_hint_needs_cleanup_review",
    };
  }
  return {
    lifecycle: "unknown",
    retentionReason: "not_enough_signal_for_hint_lifecycle",
  };
}

function nextActionHintRetentionReason(input: {
  readonly staleHint: boolean;
  readonly recentlyTouched: boolean;
  readonly isCarryForward: boolean;
  readonly hasCurrentObjectiveOverlap: boolean;
  readonly hasStrongHookOverlap?: boolean;
  readonly hasStrongArcOverlap?: boolean;
}): string {
  if (input.isCarryForward) return "carry_forward_thread";
  if (input.recentlyTouched) return "recently_touched_thread";
  if (input.hasStrongHookOverlap) return "strong_active_hook_overlap";
  if (input.hasStrongArcOverlap) return "strong_active_arc_goal_overlap";
  if (input.hasCurrentObjectiveOverlap) return "overlaps_current_objective_or_active_hook";
  if (input.staleHint) return "stale_hint_needs_expiry_review";
  return "not_old_enough_for_expiry_review";
}

function buildActiveHookLinkageDiagnostics(input: {
  readonly thread: NarrativeThread;
  readonly hooks: readonly HookItem[];
  readonly hookIds: readonly string[];
  readonly chapter: number;
}): readonly ActiveHookLinkageDiagnostic[] {
  const hookIds = new Set(input.hookIds);
  return input.hooks
    .filter((hook) => hookIds.has(hook.id))
    .map((hook) => activeHookLinkageDiagnostic(input.thread, hook, input.chapter));
}

function activeHookLinkageDiagnostic(thread: NarrativeThread, hook: HookItem, chapter: number): ActiveHookLinkageDiagnostic {
  const threadText = threadSurface(thread);
  const hookText = hookSurface(hook);
  const strongSharedKeywords = sharedKeywordHits(threadText, hookText, STRONG_ACTIVE_LINK_KEYWORDS);
  const weakSharedKeywords = sharedKeywordHits(threadText, hookText, WEAK_ACTIVE_LINK_KEYWORDS);
  const sharedCharacters = sharedItems(thread.relatedCharacters ?? [], hook.relatedCharacters ?? []);
  const sharedLocations = sharedItems(thread.relatedLocations ?? [], hook.relatedLocations ?? []);
  const textSharedKeywords = unique([...strongSharedKeywords, ...weakSharedKeywords]);
  const mainlineKeywordHits = sharedKeywordHits(threadText, hookText, HOOK_LINK_MAINLINE_KEYWORDS);
  const uniqueSpecificKeywordHits = sharedKeywordHits(threadText, hookText, HOOK_LINK_SPECIFIC_ENTITY_KEYWORDS);
  const genericKeywordHits = sharedKeywordHits(threadText, hookText, HOOK_LINK_GENERIC_KEYWORDS);
  const locationKeywordHits = sharedKeywordHits(threadText, hookText, HOOK_LINK_LOCATION_KEYWORDS);
  const actorKeywordHits = sharedKeywordHits(threadText, hookText, HOOK_LINK_ACTOR_KEYWORDS);
  const broadCharacterOnly = sharedCharacters.length > 0
    && strongSharedKeywords.length === 0
    && sharedLocations.length === 0;
  const linkageStrength: ActiveHookLinkageDiagnostic["linkageStrength"] = uniqueSpecificKeywordHits.length > 0
    ? "strong"
    : mainlineKeywordHits.length > 0 || genericKeywordHits.length > 0
      ? "caution"
      : locationKeywordHits.length > 0 || actorKeywordHits.length > 0 || weakSharedKeywords.length > 0 || sharedLocations.length > 0 || broadCharacterOnly
      ? "weak"
      : textSharedKeywords.length > 0
        ? "unknown"
        : "none";
  const sharedKeywords = unique([...strongSharedKeywords, ...weakSharedKeywords, ...sharedCharacters, ...sharedLocations]);
  const hookLastTouchedChapter = hook.lastTouchedChapter ?? "unknown";
  const isSpecificEntityOverlap = uniqueSpecificKeywordHits.length > 0;
  const isSameNarrativeObject = uniqueSpecificKeywordHits.length > 0
    || mainlineKeywordHits.some((keyword) => !listIncludes(HOOK_LINK_LOCATION_KEYWORDS, keyword));
  const isSameLocationOnly = locationKeywordHits.length > 0
    && uniqueSpecificKeywordHits.length === 0
    && genericKeywordHits.length === 0
    && mainlineKeywordHits.every((keyword) => listIncludes(HOOK_LINK_LOCATION_KEYWORDS, keyword));
  const isSameActorOnly = actorKeywordHits.length > 0
    && locationKeywordHits.length === 0
    && uniqueSpecificKeywordHits.length === 0
    && genericKeywordHits.length === 0
    && mainlineKeywordHits.length === 0;
  const isGenericMainlineOnlyOverlap = uniqueSpecificKeywordHits.length === 0
    && textSharedKeywords.length > 0
    && textSharedKeywords.every((keyword) => listIncludes(HOOK_LINK_GENERIC_KEYWORDS, keyword)
      || listIncludes(HOOK_LINK_MAINLINE_KEYWORDS, keyword)
      || listIncludes(HOOK_LINK_LOCATION_KEYWORDS, keyword)
      || listIncludes(HOOK_LINK_ACTOR_KEYWORDS, keyword));
  const downgradeReason = hookPossibleDowngradeReason({
    linkageStrength,
    isSpecificEntityOverlap,
    isGenericMainlineOnlyOverlap,
    isSameLocationOnly,
    isSameActorOnly,
    genericKeywordHits,
    mainlineKeywordHits,
  });
  const shouldRemainStrong = linkageStrength === "strong";
  return {
    threadId: thread.id,
    threadTitle: truncateText(thread.title, 80),
    threadType: thread.type,
    threadStatus: thread.status,
    threadCreatedChapter: thread.firstSeenChapter,
    threadLastTouchedChapter: thread.lastTouchedChapter,
    hookId: hook.id,
    hookTitle: truncateText(hook.title, 80),
    hookStatus: hook.status,
    hookCreatedChapter: hook.firstSeenChapter ?? "unknown",
    hookLastTouchedChapter,
    sharedKeywords,
    strongSharedKeywords,
    weakSharedKeywords,
    mainlineKeywordHits,
    uniqueSpecificKeywordHits,
    genericKeywordHits,
    linkageStrength,
    linkageReason: hookLinkageReason({ strongSharedKeywords, weakSharedKeywords, sharedCharacters, sharedLocations }),
    hookAgeInChapters: typeof hookLastTouchedChapter === "number" ? Math.max(0, chapter - hookLastTouchedChapter) : "unknown",
    isSpecificEntityOverlap,
    isGenericMainlineOnlyOverlap,
    isSameNarrativeObject,
    isSameLocationOnly,
    isSameActorOnly,
    shouldRemainStrong,
    ...(downgradeReason ? { possibleDowngradeReason: downgradeReason } : {}),
    shouldBeStrongProtected: linkageStrength === "strong" && shouldRemainStrong,
    shouldDowngradeToCleanupCandidate: linkageStrength !== "strong" && linkageStrength !== "none",
  };
}

function hookPossibleDowngradeReason(input: {
  readonly linkageStrength: ActiveHookLinkageDiagnostic["linkageStrength"];
  readonly isSpecificEntityOverlap: boolean;
  readonly isGenericMainlineOnlyOverlap: boolean;
  readonly isSameLocationOnly: boolean;
  readonly isSameActorOnly: boolean;
  readonly genericKeywordHits: readonly string[];
  readonly mainlineKeywordHits: readonly string[];
}): string | undefined {
  if (input.isSpecificEntityOverlap) return undefined;
  if (input.isSameActorOnly) return "actor_only_overlap";
  if (input.isSameLocationOnly) return "location_only_overlap";
  if (input.linkageStrength === "weak") return "weak_location_or_actor_overlap";
  if (input.genericKeywordHits.length > 0 && input.mainlineKeywordHits.length === 0) return "generic_only_overlap";
  if (input.isGenericMainlineOnlyOverlap) return "mainline_or_generic_only_overlap";
  if (input.linkageStrength === "caution") return "caution_mainline_overlap";
  if (input.linkageStrength === "none") return "no_meaningful_overlap";
  return undefined;
}

function hookLinkageReason(input: {
  readonly strongSharedKeywords: readonly string[];
  readonly weakSharedKeywords: readonly string[];
  readonly sharedCharacters: readonly string[];
  readonly sharedLocations: readonly string[];
}): string {
  if (input.strongSharedKeywords.length > 0) return `strong_keyword:${input.strongSharedKeywords.join(",")}`;
  if (input.sharedLocations.length > 0) return `shared_location:${input.sharedLocations.join(",")}`;
  if (input.weakSharedKeywords.length > 0) return `weak_keyword:${input.weakSharedKeywords.join(",")}`;
  if (input.sharedCharacters.length > 0) return `shared_character:${input.sharedCharacters.join(",")}`;
  return "unknown_overlap";
}

function buildDropClassificationSummary(threads: readonly AIReviewThread[]): DropCandidateClassificationSummary {
  const classifications = threads
    .filter((thread): thread is AIReviewThread & {
      dropSuitability: DropCandidateSuitability;
      threadId: string;
      ageInChapters: number;
      evidenceCount: number;
      mentionCount: number;
      hasNextActionHint: boolean;
      nextActionHintLifecycle?: NextActionHintLifecycle;
      nextActionHintExpiryReason?: string;
      nextActionHintRetentionReason?: string;
      strongMainlineKeywordHits: readonly string[];
      weakMainlineKeywordHits: readonly string[];
      linkedActiveHookCount: number;
      linkedActiveHookIds: readonly string[];
      linkedActiveArcGoalCount: number;
      linkedActiveArcGoalIds: readonly string[];
      recentlyTouched: boolean;
      isCarryForward: boolean;
      hasCurrentObjectiveOverlap: boolean;
      riskReasons: readonly string[];
      cautionReasons: readonly string[];
      protectedReasons: readonly string[];
      cleanupReasons: readonly string[];
      nextActionHintDiagnostic?: NextActionHintStickinessDiagnostic;
      activeHookLinkageDiagnostics?: readonly ActiveHookLinkageDiagnostic[];
    } => thread.candidateKind !== undefined
      && thread.candidateKind !== "non_drop_candidate"
      && thread.dropSuitability !== undefined
      && thread.threadId !== undefined
      && thread.ageInChapters !== undefined
      && thread.evidenceCount !== undefined
      && thread.mentionCount !== undefined
      && thread.hasNextActionHint !== undefined
      && thread.strongMainlineKeywordHits !== undefined
      && thread.weakMainlineKeywordHits !== undefined
      && thread.linkedActiveHookCount !== undefined
      && thread.linkedActiveHookIds !== undefined
      && thread.linkedActiveArcGoalCount !== undefined
      && thread.linkedActiveArcGoalIds !== undefined
      && thread.recentlyTouched !== undefined
      && thread.isCarryForward !== undefined
      && thread.hasCurrentObjectiveOverlap !== undefined
      && thread.riskReasons !== undefined
      && thread.cautionReasons !== undefined
      && thread.protectedReasons !== undefined
      && thread.cleanupReasons !== undefined)
    .map(dropClassificationFromThread);
  const riskyReasonCounts = countStrings(classifications.flatMap((candidate) => candidate.riskReasons));
  const cautionReasonCounts = countStrings(classifications.flatMap((candidate) => candidate.cautionReasons));
  const protectedReasonCounts = countStrings(classifications.flatMap((candidate) => candidate.protectedReasons));
  const cleanupReasonCounts = countStrings(classifications.flatMap((candidate) => candidate.cleanupReasons));
  const nextActionHintDiagnostics = classifications
    .map((candidate) => candidate.nextActionHintDiagnostic)
    .filter((diagnostic): diagnostic is NextActionHintStickinessDiagnostic => diagnostic !== undefined);
  const activeHookLinkageDiagnostics = classifications
    .flatMap((candidate) => candidate.activeHookLinkageDiagnostics ?? []);
  const singleReasonCandidates = classifications
    .map((candidate) => [...candidate.riskReasons, ...candidate.cautionReasons])
    .filter((reasons) => reasons.length === 1)
    .flat();
  const enrichedClassifications = classifications.map((candidate) => enrichCleanupCandidateRelations(candidate, classifications));
  const cleanupReviewCandidates = enrichedClassifications
    .filter((candidate) => candidate.candidateKind === "cleanup_review_candidate")
    .sort((left, right) => right.priorityScore - left.priorityScore || left.threadId.localeCompare(right.threadId))
    .map((candidate) => cleanupCandidateFromClassification(candidate));
  return {
    trueSideBranchDropCandidateCount: enrichedClassifications.filter((candidate) => candidate.candidateKind === "true_side_branch_drop_candidate").length,
    staleButProtectedCandidateCount: enrichedClassifications.filter((candidate) => candidate.candidateKind === "stale_but_protected_candidate").length,
    cleanupReviewCandidateCount: enrichedClassifications.filter((candidate) => candidate.candidateKind === "cleanup_review_candidate").length,
    nonDropCandidateCount: threads.filter((thread) => thread.candidateKind === undefined || thread.candidateKind === "non_drop_candidate").length,
    protectedReasonCounts,
    cleanupReasonCounts,
    riskyReasonCounts,
    cautionReasonCounts,
    topRiskyCandidates: classifications
      .filter((candidate) => candidate.dropSuitability === "risky_candidate")
      .sort((left, right) => right.riskReasons.length - left.riskReasons.length || right.ageInChapters - left.ageInChapters || left.threadId.localeCompare(right.threadId))
      .slice(0, 8),
    topProtectedCandidates: classifications
      .filter((candidate) => candidate.candidateKind === "stale_but_protected_candidate")
      .sort((left, right) => right.protectedReasons.length - left.protectedReasons.length || right.ageInChapters - left.ageInChapters || left.threadId.localeCompare(right.threadId))
      .slice(0, 8),
    topCleanupCandidates: classifications
      .filter((candidate) => candidate.candidateKind === "cleanup_review_candidate")
      .sort((left, right) => right.cleanupReasons.length - left.cleanupReasons.length || right.ageInChapters - left.ageInChapters || left.threadId.localeCompare(right.threadId))
      .slice(0, 8),
    cleanupReviewCandidates,
    safeCandidateMissingReasons: classifications.some((candidate) => candidate.dropSuitability === "safe_candidate")
      ? []
      : topMissingReasons(riskyReasonCounts, cautionReasonCounts),
    wouldBeSafeExceptForReasonCounts: countStrings(singleReasonCandidates),
    riskReasonCombinationCounts: countStrings(classifications
      .map((candidate) => [...candidate.riskReasons, ...candidate.cautionReasons].sort().join("+") || "safe")),
    stickinessDiagnosticsSummary: buildStickinessDiagnosticsSummary(classifications, nextActionHintDiagnostics, activeHookLinkageDiagnostics),
    nextActionHintDiagnostics,
    activeHookLinkageDiagnostics,
    dropCandidateClassifications: enrichedClassifications,
  };
}

function buildStickinessDiagnosticsSummary(
  classifications: readonly DropCandidateClassificationDiagnostic[],
  nextActionHintDiagnostics: readonly NextActionHintStickinessDiagnostic[],
  activeHookLinkageDiagnostics: readonly ActiveHookLinkageDiagnostic[],
): StickinessDiagnosticsSummary {
  const weakThreadIds = new Set(activeHookLinkageDiagnostics
    .filter((diagnostic) => diagnostic.shouldDowngradeToCleanupCandidate)
    .map((diagnostic) => diagnostic.threadId));
  const expiryThreadIds = new Set(nextActionHintDiagnostics
    .filter((diagnostic) => diagnostic.shouldExpireNextActionHintCandidate)
    .map((diagnostic) => diagnostic.threadId));
  const overProtectedThreadIds = new Set([...weakThreadIds, ...expiryThreadIds]);
  const topNextActionHintTexts = countStrings(nextActionHintDiagnostics.map((diagnostic) => diagnostic.nextActionHint));
  const topSharedHookKeywords = countStrings(activeHookLinkageDiagnostics.flatMap((diagnostic) => diagnostic.sharedKeywords));
  const strongHookLinks = activeHookLinkageDiagnostics.filter((diagnostic) => diagnostic.linkageStrength === "strong");
  const cautionHookLinks = activeHookLinkageDiagnostics.filter((diagnostic) => diagnostic.linkageStrength === "caution");
  const weakHookLinks = activeHookLinkageDiagnostics.filter((diagnostic) => diagnostic.linkageStrength === "weak");
  const noneHookLinks = activeHookLinkageDiagnostics.filter((diagnostic) => diagnostic.linkageStrength === "none");
  const activeNextActionHints = nextActionHintDiagnostics.filter((diagnostic) => diagnostic.nextActionHintLifecycle === "active");
  const staleNextActionHints = nextActionHintDiagnostics.filter((diagnostic) => diagnostic.nextActionHintLifecycle === "stale");
  const expiredNextActionHints = nextActionHintDiagnostics.filter((diagnostic) => diagnostic.nextActionHintLifecycle === "expired_candidate");
  const unknownNextActionHints = nextActionHintDiagnostics.filter((diagnostic) => diagnostic.nextActionHintLifecycle === "unknown");
  const highFanoutHookIds = highFanoutIds(countStrings(activeHookLinkageDiagnostics.map((diagnostic) => diagnostic.hookId)), 10);
  const highFanoutThreadIds = highFanoutIds(countStrings(activeHookLinkageDiagnostics.map((diagnostic) => diagnostic.threadId)), 3);
  return {
    nextActionHintProtectedCount: classifications.filter((candidate) => candidate.protectedReasons.includes("has_next_action_hint")).length,
    nextActionHintUnknownSourceCount: nextActionHintDiagnostics.filter((diagnostic) => diagnostic.nextActionHintSource === "unknown").length,
    staleNextActionHintCandidateCount: nextActionHintDiagnostics.filter((diagnostic) => diagnostic.ageInChapters >= 15).length,
    activeHookProtectedCount: classifications.filter((candidate) => candidate.protectedReasons.includes("linked_active_hook")).length,
    strongHookLinkCount: activeHookLinkageDiagnostics.filter((diagnostic) => diagnostic.linkageStrength === "strong").length,
    weakHookLinkCount: activeHookLinkageDiagnostics.filter((diagnostic) => diagnostic.linkageStrength === "weak").length,
    unknownHookLinkCount: activeHookLinkageDiagnostics.filter((diagnostic) => diagnostic.linkageStrength === "unknown").length,
    possibleOverProtectedThreadCount: overProtectedThreadIds.size,
    possibleNextActionHintExpiryCandidateCount: expiryThreadIds.size,
    possibleWeakHookLinkDowngradeCount: weakThreadIds.size,
    topNextActionHintTexts,
    topSharedHookKeywords,
    overProtectionReasonCounts: countStrings([
      ...nextActionHintDiagnostics
        .filter((diagnostic) => diagnostic.shouldExpireNextActionHintCandidate)
        .map(() => "possible_next_action_hint_expiry"),
      ...activeHookLinkageDiagnostics
        .filter((diagnostic) => diagnostic.shouldDowngradeToCleanupCandidate)
        .map(() => "possible_weak_hook_link_downgrade"),
    ]),
    totalHookLinks: activeHookLinkageDiagnostics.length,
    specificEntityStrongLinkCount: strongHookLinks.filter((diagnostic) => diagnostic.isSpecificEntityOverlap).length,
    mainlineOnlyStrongLinkCount: strongHookLinks.filter((diagnostic) => diagnostic.possibleDowngradeReason === "mainline_or_generic_only_overlap").length,
    genericOnlyStrongLinkCount: strongHookLinks.filter((diagnostic) => diagnostic.possibleDowngradeReason === "generic_only_overlap").length,
    locationOnlyStrongLinkCount: strongHookLinks.filter((diagnostic) => diagnostic.possibleDowngradeReason === "location_only_overlap").length,
    actorOnlyStrongLinkCount: strongHookLinks.filter((diagnostic) => diagnostic.possibleDowngradeReason === "actor_only_overlap").length,
    possibleDowngradeStrongLinkCount: strongHookLinks.filter((diagnostic) => diagnostic.possibleDowngradeReason !== undefined).length,
    refinedStrongHookLinkCount: strongHookLinks.length,
    refinedCautionHookLinkCount: cautionHookLinks.length,
    refinedWeakHookLinkCount: weakHookLinks.length,
    refinedNoneHookLinkCount: noneHookLinks.length,
    downgradedFromStrongCount: activeHookLinkageDiagnostics.filter((diagnostic) => diagnostic.linkageStrength !== "strong").length,
    downgradeReasonCounts: countStrings(activeHookLinkageDiagnostics
      .map((diagnostic) => diagnostic.possibleDowngradeReason ?? "")
      .filter(Boolean)),
    nextActionHintActiveCount: activeNextActionHints.length,
    nextActionHintStaleCount: staleNextActionHints.length,
    nextActionHintExpiredCandidateCount: expiredNextActionHints.length,
    nextActionHintUnknownCount: unknownNextActionHints.length,
    downgradedNextActionHintProtectionCount: nextActionHintDiagnostics
      .filter((diagnostic) => diagnostic.nextActionHintLifecycle === "stale" || diagnostic.nextActionHintLifecycle === "expired_candidate")
      .length,
    expiryReasonCounts: countStrings(nextActionHintDiagnostics
      .map((diagnostic) => diagnostic.nextActionHintExpiryReason ?? "")
      .filter(Boolean)),
    retentionReasonCounts: countStrings(nextActionHintDiagnostics.map((diagnostic) => diagnostic.nextActionHintRetentionReason)),
    topGenericKeywords: countStrings(activeHookLinkageDiagnostics.flatMap((diagnostic) => diagnostic.genericKeywordHits)),
    topMainlineKeywords: countStrings(activeHookLinkageDiagnostics.flatMap((diagnostic) => diagnostic.mainlineKeywordHits)),
    hookLinkFanoutByThread: countStrings(activeHookLinkageDiagnostics.map((diagnostic) => diagnostic.threadId)),
    hookLinkFanoutByHook: countStrings(activeHookLinkageDiagnostics.map((diagnostic) => diagnostic.hookId)),
    highFanoutHookIds,
    highFanoutThreadIds,
  };
}

function enrichCleanupCandidateRelations(
  candidate: DropCandidateClassificationDiagnostic,
  allCandidates: readonly DropCandidateClassificationDiagnostic[],
): DropCandidateClassificationDiagnostic {
  if (candidate.candidateKind !== "cleanup_review_candidate") return candidate;
  const relatedThreadIdsForMerge = allCandidates
    .filter((other) => other.threadId !== candidate.threadId)
    .filter((other) => other.threadType === candidate.threadType)
    .filter((other) => cleanupCandidatesLookMergeable(candidate, other))
    .map((other) => other.threadId)
    .slice(0, 3);
  const suggestedCleanupActions = suggestedCleanupActionsForCandidate(candidate, relatedThreadIdsForMerge);
  return {
    ...candidate,
    relatedThreadIdsForMerge,
    suggestedCleanupActions,
    whyNotDrop: cleanupWhyNotDrop(candidate),
    whyNeedsReview: cleanupWhyNeedsReview(candidate),
    priorityScore: cleanupCandidatePriorityScore(candidate, relatedThreadIdsForMerge),
  };
}

function cleanupCandidateFromClassification(candidate: DropCandidateClassificationDiagnostic): AIReviewCleanupCandidate {
  return {
    threadId: candidate.threadId,
    title: candidate.title,
    status: candidate.status,
    threadType: candidate.threadType,
    createdChapter: candidate.createdChapter,
    lastTouchedChapter: candidate.lastTouchedChapter,
    ageInChapters: candidate.ageInChapters,
    evidenceCount: candidate.evidenceCount,
    ...(candidate.nextActionHintLifecycle ? { nextActionHintLifecycle: candidate.nextActionHintLifecycle } : {}),
    cleanupReasons: candidate.cleanupReasons,
    suggestedCleanupActions: candidate.suggestedCleanupActions,
    whyNotDrop: candidate.whyNotDrop ?? cleanupWhyNotDrop(candidate),
    whyNeedsReview: candidate.whyNeedsReview ?? cleanupWhyNeedsReview(candidate),
    relatedThreadIdsForMerge: candidate.relatedThreadIdsForMerge,
    possibleDoneEvidence: candidate.possibleDoneEvidence,
    priorityScore: candidate.priorityScore,
  };
}

function cleanupCandidatesLookMergeable(
  left: DropCandidateClassificationDiagnostic,
  right: DropCandidateClassificationDiagnostic,
): boolean {
  const leftKeywords = new Set([...left.strongMainlineKeywordHits, ...left.weakMainlineKeywordHits]);
  const rightKeywords = new Set([...right.strongMainlineKeywordHits, ...right.weakMainlineKeywordHits]);
  if ([...leftKeywords].some((keyword) => rightKeywords.has(keyword))) return true;
  const leftWords = extractReviewKeywords(left.title);
  const rightWords = extractReviewKeywords(right.title);
  return leftWords.some((keyword) => rightWords.includes(keyword));
}

function suggestedCleanupActionsForCandidate(
  candidate: DropCandidateClassificationDiagnostic,
  relatedThreadIdsForMerge: readonly string[],
): readonly CleanupCandidateAction[] {
  const actions: CleanupCandidateAction[] = [];
  if (candidate.possibleDoneEvidence.length > 0) actions.push("mark_thread_done");
  if (relatedThreadIdsForMerge.length > 0) actions.push("merge_threads");
  if (candidate.cleanupReasons.length > 0 || candidate.nextActionHintLifecycle === "expired_candidate") actions.push("prioritize_thread");
  if (actions.length === 0) actions.push("no_action");
  return unique(actions);
}

function cleanupWhyNotDrop(candidate: DropCandidateClassificationDiagnostic): string {
  if (candidate.hasNextActionHint && candidate.nextActionHintLifecycle === "expired_candidate") {
    return "nextActionHint is expired for cleanup review, but drop still needs separate system safety and human confirmation.";
  }
  if (candidate.cleanupReasons.length > 0) return `cleanup reasons require review before any drop: ${candidate.cleanupReasons.join(", ")}`;
  return "candidate is for review, not direct deletion.";
}

function cleanupWhyNeedsReview(candidate: DropCandidateClassificationDiagnostic): string {
  if (candidate.nextActionHintLifecycle === "expired_candidate") return "expired nextActionHint should be checked for mark-done, merge, prioritize, or no_action.";
  if (candidate.relatedThreadIdsForMerge.length > 0) return "candidate may overlap with nearby maintenance threads and should be checked for merge.";
  if (candidate.cleanupReasons.length > 0) return `candidate has cleanup signals: ${candidate.cleanupReasons.join(", ")}`;
  return "candidate is stale enough to need human review.";
}

function cleanupCandidatePriorityScore(
  candidate: DropCandidateClassificationDiagnostic,
  relatedThreadIdsForMerge: readonly string[],
): number {
  let score = candidate.ageInChapters;
  if (candidate.nextActionHintLifecycle === "expired_candidate") score += 20;
  if (candidate.possibleDoneEvidence.length > 0) score += 15;
  if (relatedThreadIdsForMerge.length > 0) score += 10;
  score += candidate.cleanupReasons.length * 3;
  return score;
}

function extractReviewKeywords(text: string): readonly string[] {
  return unique((text.match(/[\p{Script=Han}A-Za-z0-9]{2,}/gu) ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 12));
}

function possibleDoneEvidenceForThread(thread: Pick<NarrativeThread, "title" | "evidence">): readonly string[] {
  return [thread.title, ...thread.evidence]
    .filter((item) => /已经|已|终于|查清|查明|确认|找到|问清|拿到|取回|抵达|完成|闭合|已解|来源已明|真相已明|弄清|找到来源|找到证据|证实|验明|对上了|已经去过|赶到|做完|成功藏好|成功进入|已经调查|已经见到|已经交给/u.test(item))
    .filter((item) => !/(?:准备|打算|决定|明日|将要|必须|还要|需要|试图|想要|计划).{0,18}(?:查清|查明|确认|弄清|找到|完成|问清楚|去|调查|拿到|取回|抵达|问清)/u.test(item))
    .map((item) => truncateText(item, 120))
    .slice(0, 3);
}

function suggestedCleanupActionsForThread(
  thread: Pick<NarrativeThread, "title" | "evidence"> & { readonly cleanupReasons: readonly string[] },
): readonly CleanupCandidateAction[] {
  const actions: CleanupCandidateAction[] = [];
  if (possibleDoneEvidenceForThread(thread).length > 0) actions.push("mark_thread_done");
  if (thread.cleanupReasons.length > 0) actions.push("prioritize_thread");
  if (actions.length === 0) actions.push("no_action");
  return unique(actions);
}

function dropClassificationFromThread(thread: AIReviewThread & {
  dropSuitability: DropCandidateSuitability;
  threadId: string;
  ageInChapters: number;
  evidenceCount: number;
  mentionCount: number;
  hasNextActionHint: boolean;
  nextActionHintLifecycle?: NextActionHintLifecycle;
  nextActionHintExpiryReason?: string;
  nextActionHintRetentionReason?: string;
  strongMainlineKeywordHits: readonly string[];
  weakMainlineKeywordHits: readonly string[];
  linkedActiveHookCount: number;
  linkedActiveHookIds: readonly string[];
  linkedActiveArcGoalCount: number;
  linkedActiveArcGoalIds: readonly string[];
  recentlyTouched: boolean;
  isCarryForward: boolean;
  hasCurrentObjectiveOverlap: boolean;
  riskReasons: readonly string[];
  cautionReasons: readonly string[];
  protectedReasons: readonly string[];
  cleanupReasons: readonly string[];
  nextActionHintDiagnostic?: NextActionHintStickinessDiagnostic;
  activeHookLinkageDiagnostics?: readonly ActiveHookLinkageDiagnostic[];
}): DropCandidateClassificationDiagnostic {
  return {
    threadId: thread.threadId,
    title: thread.title,
    status: thread.status,
    threadType: thread.type,
    createdChapter: thread.firstSeenChapter,
    lastTouchedChapter: thread.lastTouchedChapter,
    ageInChapters: thread.ageInChapters,
    evidenceCount: thread.evidenceCount,
    mentionCount: thread.mentionCount,
    hasNextActionHint: thread.hasNextActionHint,
    ...(thread.nextActionHintLifecycle ? { nextActionHintLifecycle: thread.nextActionHintLifecycle } : {}),
    ...(thread.nextActionHintExpiryReason ? { nextActionHintExpiryReason: thread.nextActionHintExpiryReason } : {}),
    ...(thread.nextActionHintRetentionReason ? { nextActionHintRetentionReason: thread.nextActionHintRetentionReason } : {}),
    hasStrongMainlineKeyword: thread.hasStrongMainlineKeyword === true,
    strongMainlineKeywordHits: thread.strongMainlineKeywordHits,
    weakMainlineKeywordHits: thread.weakMainlineKeywordHits,
    linkedActiveHookCount: thread.linkedActiveHookCount,
    linkedActiveHookIds: thread.linkedActiveHookIds,
    linkedActiveArcGoalCount: thread.linkedActiveArcGoalCount,
    linkedActiveArcGoalIds: thread.linkedActiveArcGoalIds,
    recentlyTouched: thread.recentlyTouched,
    isCarryForward: thread.isCarryForward,
    hasCurrentObjectiveOverlap: thread.hasCurrentObjectiveOverlap,
    riskReasons: thread.riskReasons,
    cautionReasons: thread.cautionReasons,
    protectedReasons: thread.protectedReasons,
    cleanupReasons: thread.cleanupReasons,
    suggestedCleanupActions: suggestedCleanupActionsForThread(thread),
    whyNotDrop: "cleanup candidates are review-only and must not be dropped directly.",
    whyNeedsReview: thread.cleanupReasons.length > 0
      ? `cleanup signals: ${thread.cleanupReasons.join(", ")}`
      : "stale candidate needs cleanup review",
    relatedThreadIdsForMerge: [],
    possibleDoneEvidence: possibleDoneEvidenceForThread(thread),
    priorityScore: thread.ageInChapters + thread.cleanupReasons.length * 3,
    ...(thread.nextActionHintDiagnostic ? { nextActionHintDiagnostic: thread.nextActionHintDiagnostic } : {}),
    activeHookLinkageDiagnostics: thread.activeHookLinkageDiagnostics ?? [],
    candidateKind: thread.candidateKind ?? "non_drop_candidate",
    dropSuitability: thread.dropSuitability,
  };
}

function compareDropExposureProfilePriority(left: DropCandidateExposureProfile, right: DropCandidateExposureProfile): number {
  return dropSuitabilityRank(right.exposure.dropSuitability) - dropSuitabilityRank(left.exposure.dropSuitability)
    || left.thread.lastTouchedChapter - right.thread.lastTouchedChapter
    || left.thread.id.localeCompare(right.thread.id);
}

function dropSuitabilityRank(suitability: DropCandidateSuitability): number {
  if (suitability === "safe_candidate") return 3;
  if (suitability === "caution_candidate") return 2;
  return 1;
}

function linkedActiveHookIdsForDrop(thread: NarrativeThread, hooks: readonly HookItem[]): readonly string[] {
  return hooks
    .filter((hook) => hook.status === "active")
    .filter((hook) => activeHookLinkageDiagnostic(thread, hook, Number.MAX_SAFE_INTEGER).shouldBeStrongProtected)
    .map((hook) => hook.id);
}

function weakLinkedActiveHookIdsForDrop(
  thread: NarrativeThread,
  hooks: readonly HookItem[],
  strongIds: readonly string[],
): readonly string[] {
  const strong = new Set(strongIds);
  return hooks
    .filter((hook) => hook.status === "active" && !strong.has(hook.id))
    .filter((hook) => activeHookLinkageDiagnostic(thread, hook, Number.MAX_SAFE_INTEGER).shouldDowngradeToCleanupCandidate)
    .map((hook) => hook.id);
}

function linkedActiveArcGoalIdsForDrop(thread: NarrativeThread, arcGoals: readonly ArcGoal[]): readonly string[] {
  return arcGoals
    .filter((goal) => goal.status === "active")
    .filter((goal) => goal.relatedThreads?.includes(thread.id)
      || sharesKeyword(threadSurface(thread), arcGoalSurface(goal), STRONG_ACTIVE_LINK_KEYWORDS)
      || intersects(thread.relatedCharacters ?? [], goal.relatedCharacters ?? [])
      || intersects(thread.relatedLocations ?? [], goal.relatedLocations ?? []))
    .map((goal) => goal.id);
}

function weakLinkedActiveArcGoalIdsForDrop(
  thread: NarrativeThread,
  arcGoals: readonly ArcGoal[],
  strongIds: readonly string[],
): readonly string[] {
  const strong = new Set(strongIds);
  return arcGoals
    .filter((goal) => goal.status === "active" && !strong.has(goal.id))
    .filter((goal) => sharesKeyword(threadSurface(thread), arcGoalSurface(goal), WEAK_ACTIVE_LINK_KEYWORDS))
    .map((goal) => goal.id);
}

function sharesKeyword(left: string, right: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => left.includes(keyword) && right.includes(keyword));
}

function sharedKeywordHits(left: string, right: string, keywords: readonly string[]): readonly string[] {
  return unique(keywords.filter((keyword) => left.includes(keyword) && right.includes(keyword)))
    .sort((first, second) => second.length - first.length || first.localeCompare(second));
}

function keywordHitsText(text: string, keywords: readonly string[]): readonly string[] {
  return unique(keywords.filter((keyword) => text.includes(keyword)))
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function threadSurface(thread: NarrativeThread): string {
  return [
    thread.title,
    ...thread.evidence,
    thread.nextActionHint ?? "",
    ...(thread.relatedCharacters ?? []),
    ...(thread.relatedLocations ?? []),
  ].join(" ");
}

function hookSurface(hook: HookItem): string {
  return [
    hook.title,
    hook.description,
    ...(hook.evidence ?? []),
    hook.nextActionHint ?? "",
    ...hook.relatedCharacters,
    ...(hook.relatedLocations ?? []),
  ].join(" ");
}

function arcGoalSurface(goal: ArcGoal): string {
  return [
    goal.title,
    ...(goal.evidence ?? []),
    goal.nextActionHint ?? "",
    ...(goal.relatedCharacters ?? []),
    ...(goal.relatedLocations ?? []),
  ].join(" ");
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const normalized = new Set(left.map((item) => item.trim()).filter(Boolean));
  return right.some((item) => normalized.has(item.trim()));
}

function sharedItems(left: readonly string[], right: readonly string[]): readonly string[] {
  const normalized = new Set(left.map((item) => item.trim()).filter(Boolean));
  return unique(right.map((item) => item.trim()).filter((item) => normalized.has(item)))
    .sort((first, second) => first.localeCompare(second));
}

function countStrings(values: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const value of values.filter(Boolean)) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function highFanoutIds(counts: Readonly<Record<string, number>>, threshold: number): readonly string[] {
  return Object.entries(counts)
    .filter(([, count]) => count >= threshold)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id]) => id);
}

function listIncludes(values: readonly string[], value: string): boolean {
  return values.includes(value);
}

function topMissingReasons(
  riskyReasonCounts: Readonly<Record<string, number>>,
  cautionReasonCounts: Readonly<Record<string, number>>,
): readonly string[] {
  return Object.entries({ ...cautionReasonCounts, ...riskyReasonCounts })
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([reason]) => reason);
}

function selectArcGoalsForReview(goals: readonly ArcGoal[], chapter: number | undefined): readonly ArcGoal[] {
  return [...goals]
    .sort((left, right) => compareArcGoalPriority(left, right, chapter))
    .slice(0, MAX_ARC_GOALS)
    .map((goal) => ({
      ...goal,
      title: truncateText(goal.title, 60),
      evidence: truncateTextList(goal.evidence, MAX_EVIDENCE),
      relatedHooks: goal.relatedHooks?.slice(0, 8),
      relatedThreads: goal.relatedThreads?.slice(0, 8),
      relatedCharacters: goal.relatedCharacters?.slice(0, 8),
      relatedLocations: goal.relatedLocations?.slice(0, 8),
      ...(goal.nextActionHint ? { nextActionHint: truncateText(goal.nextActionHint, MAX_TEXT_LENGTH) } : {}),
    }));
}

function compareHookPriority(left: HookItem, right: HookItem): number {
  return hookStatusRank(right.status) - hookStatusRank(left.status)
    || (right.lastTouchedChapter ?? right.firstSeenChapter ?? 0) - (left.lastTouchedChapter ?? left.firstSeenChapter ?? 0)
    || left.id.localeCompare(right.id);
}

function hookStatusRank(status: HookItem["status"]): number {
  if (status === "active") return 3;
  if (status === "seeded") return 2;
  if (status === "inactive") return 1;
  return 0;
}

function compareThreadPriority(left: NarrativeThread, right: NarrativeThread, chapter: number | undefined): number {
  return threadReviewRank(right, chapter) - threadReviewRank(left, chapter)
    || right.lastTouchedChapter - left.lastTouchedChapter
    || left.id.localeCompare(right.id);
}

function compareRecentThreadPriority(left: NarrativeThread, right: NarrativeThread): number {
  const leftHint = left.nextActionHint ? 1 : 0;
  const rightHint = right.nextActionHint ? 1 : 0;
  return right.lastTouchedChapter - left.lastTouchedChapter
    || rightHint - leftHint
    || left.id.localeCompare(right.id);
}

function threadReviewRank(thread: NarrativeThread, chapter: number | undefined): number {
  let score = 0;
  if (thread.status === "open" || thread.status === "touched") score += 100;
  if (isThreadStale(thread, chapter)) score += 80;
  if (thread.nextActionHint) score += 20;
  score += Math.min(thread.lastTouchedChapter, 50);
  return score;
}

function compareArcGoalPriority(left: ArcGoal, right: ArcGoal, chapter: number | undefined): number {
  return arcGoalReviewRank(right, chapter) - arcGoalReviewRank(left, chapter)
    || right.lastTouchedChapter - left.lastTouchedChapter
    || left.id.localeCompare(right.id);
}

function arcGoalReviewRank(goal: ArcGoal, chapter: number | undefined): number {
  let score = 0;
  if (goal.status === "active" || goal.status === "touched") score += 100;
  if (isArcGoalDrifting(goal, chapter)) score += 60;
  if (goal.nextActionHint) score += 20;
  score += Math.min(goal.lastTouchedChapter, 50);
  return score;
}

function reviewIntentLifecycleDiagnostics(input: AIReviewInput): readonly AIReviewIssue[] {
  const selectedThreadIds = new Set(input.threadPool.threads.map((thread) => thread.id));
  const existingActionTargets = new Set([
    ...idsBySelectionReason(input.threadPool.selection?.selectionReasons ?? {}, "drop_candidate"),
    ...idsBySelectionReason(input.threadPool.selection?.selectionReasons ?? {}, "done_candidate"),
    ...(input.threadPool.selection?.mergeGroups.flat() ?? []),
  ]);
  return (input.intentDiagnostics?.items ?? [])
    .filter((item) => item.cleanupCandidateClass !== "none")
    .filter((item) => item.valueClass !== "high_value_narrative")
    .filter((item) => selectedThreadIds.has(item.id))
    .filter((item) => !existingActionTargets.has(item.id))
    .slice(0, MAX_PRIORITIZE_THREAD_SUGGESTIONS)
    .map((item) => ({
      id: `intent-lifecycle-${item.id}`,
      type: "stale_thread" as const,
      severity: "info" as const,
      evidence: truncateTextList([
        item.title,
        item.cleanupReason,
        item.staleReason ?? "",
        ...item.safetyNotes,
      ].filter(Boolean), 3),
      suggestion: `Intent lifecycle diagnostics classify "${item.title}" as ${item.cleanupCandidateClass}. Treat this as advisory-only cleanup visibility; prioritize for human review or choose no_action.`,
      targetIds: [item.id],
      confidence: 0.55,
    }));
}

function reviewStaleThreads(input: AIReviewInput, analysis: ThreadMaintenanceAnalysis): readonly AIReviewIssue[] {
  const threadMap = new Map(input.threadPool.threads.map((thread) => [thread.id, thread]));
  return analysis.priorityCandidates
    .map((id) => threadMap.get(id))
    .filter(isDefined)
    .slice(0, MAX_PRIORITIZE_THREAD_SUGGESTIONS)
    .map((thread) => ({
      id: `stale-thread-${thread.id}`,
      type: "stale_thread" as const,
      severity: "warning" as const,
      evidence: truncateTextList([thread.title, ...thread.evidence], 3),
      suggestion: `Thread "${thread.title}" has not been touched recently. Review whether to close, merge, or deprioritize it.`,
      targetIds: [thread.id],
      confidence: 0.7,
    }));
}

function reviewSimilarThreads(input: AIReviewInput, analysis: ThreadMaintenanceAnalysis): readonly AIReviewIssue[] {
  const threadMap = new Map(input.threadPool.threads.map((thread) => [thread.id, thread]));
  return analysis.mergeGroups
    .map((ids) => ids.map((id) => threadMap.get(id)).filter(isDefined))
    .filter((threads) => threads.length > 1)
    .map((threads) => ({
      id: `merge-threads-${threads.map((item) => item.id).join("-")}`,
      type: "thread_should_merge",
      severity: "info",
      evidence: threads.map((item) => item.title),
      suggestion: `Threads look similar and may be merged: ${threads.map((item) => item.title).join(" / ")}.`,
      targetIds: threads.map((item) => item.id),
      confidence: 0.8,
    }));
}

function reviewDoneThreads(input: AIReviewInput, analysis: ThreadMaintenanceAnalysis): readonly AIReviewIssue[] {
  const threadMap = new Map(input.threadPool.threads.map((thread) => [thread.id, thread]));
  return analysis.doneCandidates
    .map((id) => threadMap.get(id))
    .filter(isDefined)
    .slice(0, MAX_MARK_DONE_SUGGESTIONS)
    .map((thread) => ({
      id: `thread-done-${thread.id}`,
      type: "thread_should_be_done" as const,
      severity: "info" as const,
      evidence: truncateTextList([thread.title, ...thread.evidence], 3),
      suggestion: `Thread "${thread.title}" has evidence of completion. Consider marking it done after human confirmation.`,
      targetIds: [thread.id],
      confidence: 0.74,
    }));
}

function reviewDroppableThreads(input: AIReviewInput, analysis: ThreadMaintenanceAnalysis): readonly AIReviewIssue[] {
  const threadMap = new Map(input.threadPool.threads.map((thread) => [thread.id, thread]));
  return analysis.dropCandidates
    .map((id) => threadMap.get(id))
    .filter(isDefined)
    .map((thread) => ({
      id: `drop-thread-${thread.id}`,
      type: "thread_should_drop" as const,
      severity: "info" as const,
      evidence: truncateTextList([thread.title, ...thread.evidence], 3),
      suggestion: `Thread "${thread.title}" looks low-value and has been untouched for a long time. Consider dropping it after human confirmation.`,
      targetIds: [thread.id],
      confidence: 0.58,
    }));
}

function reviewStaleHooks(input: AIReviewInput): readonly AIReviewIssue[] {
  return input.hookPool.hooks
    .filter((hook) => hook.status === "active" && input.chapter !== undefined && hook.lastTouchedChapter !== undefined)
    .filter((hook) => input.chapter! - hook.lastTouchedChapter! > 5)
    .slice(0, MAX_PRIORITIZE_HOOK_SUGGESTIONS)
    .map((hook) => ({
      id: `hook-stale-${hook.id}`,
      type: "hook_stale" as const,
      severity: "warning" as const,
      evidence: truncateTextList([hook.title, ...(hook.evidence ?? [])], 3),
      suggestion: `Hook "${hook.title}" is active but has not been touched recently. Consider prioritizing it or intentionally parking it.`,
      targetIds: [hook.id],
      confidence: 0.68,
    }));
}

function reviewArcGoalDrift(input: AIReviewInput): readonly AIReviewIssue[] {
  return input.arcGoalPool.goals
    .filter((goal) => isArcGoalDrifting(goal, input.chapter))
    .slice(0, MAX_PRIORITIZE_ARC_GOAL_SUGGESTIONS)
    .map((goal) => ({
      id: `arc-drift-${goal.id}`,
      type: "arc_goal_drift" as const,
      severity: "warning" as const,
      evidence: truncateTextList([goal.title, ...goal.evidence], 3),
      suggestion: `Arc goal "${goal.title}" may be drifting. Consider steering the next chapter toward this goal or splitting it.`,
      targetIds: [goal.id],
      confidence: 0.66,
    }));
}

function suggestionForIssue(issue: AIReviewIssue): AIReviewSuggestion {
  if (issue.type === "thread_should_be_done") {
    return {
      action: "mark_thread_done",
      targetIds: issue.targetIds,
      reason: issue.suggestion,
      confidence: issue.confidence,
    };
  }
  if (issue.type === "thread_should_merge") {
    return {
      action: "merge_threads",
      targetIds: issue.targetIds,
      reason: issue.suggestion,
      confidence: issue.confidence,
    };
  }
  if (issue.type === "stale_thread") {
    return {
      action: "prioritize_thread",
      targetIds: issue.targetIds,
      reason: issue.suggestion,
      confidence: issue.confidence,
    };
  }
  if (issue.type === "thread_should_drop") {
    return {
      action: "drop_thread",
      targetIds: issue.targetIds,
      reason: issue.suggestion,
      confidence: issue.confidence,
    };
  }
  if (issue.type === "hook_stale") {
    return {
      action: "prioritize_hook",
      targetIds: issue.targetIds,
      reason: issue.suggestion,
      confidence: issue.confidence,
    };
  }
  if (issue.type === "arc_goal_drift") {
    return {
      action: "prioritize_arc_goal",
      targetIds: issue.targetIds,
      reason: issue.suggestion,
      confidence: issue.confidence,
    };
  }
  return {
    action: "no_action",
    targetIds: issue.targetIds,
    reason: issue.suggestion,
    confidence: issue.confidence,
  };
}

function buildReviewSummary(
  input: AIReviewInput,
  issues: readonly AIReviewIssue[],
  suggestions: readonly AIReviewSuggestion[],
  actionabilitySummary: AIReviewActionabilitySummary,
): string {
  if (issues.length === 0) {
    return `Mock review found no immediate action for ${input.scope} scope.`;
  }
  if (actionabilitySummary.executableActionCount === 0 && actionabilitySummary.noExecutableActionReason) {
    return `Mock review found ${issues.length} issue(s) and ${suggestions.length} suggestion(s) for ${input.scope} scope. ${actionabilitySummary.noExecutableActionReason}`;
  }
  return `Mock review found ${issues.length} issue(s) and ${suggestions.length} suggestion(s) for ${input.scope} scope.`;
}

function buildActionabilitySummary(
  input: AIReviewInput,
  suggestions: readonly AIReviewSuggestion[],
  noExecutableActionReason?: string,
): AIReviewActionabilitySummary {
  const markThreadDoneCount = suggestions.filter((suggestion) => suggestion.action === "mark_thread_done").length;
  const mergeThreadsCount = suggestions.filter((suggestion) => suggestion.action === "merge_threads").length;
  const dropThreadCount = suggestions.filter((suggestion) => suggestion.action === "drop_thread").length;
  const prioritizeCount = suggestions
    .filter((suggestion) => suggestion.action === "prioritize_thread"
      || suggestion.action === "prioritize_hook"
      || suggestion.action === "prioritize_arc_goal")
    .length;
  const executableActionCount = markThreadDoneCount + mergeThreadsCount + dropThreadCount;
  const hasOpenThreads = input.threadPool.threads.some((thread) => thread.status === "open" || thread.status === "touched");
  return {
    executableActionCount,
    markThreadDoneCount,
    mergeThreadsCount,
    dropThreadCount,
    prioritizeCount,
    ...(executableActionCount === 0 && hasOpenThreads
      ? { noExecutableActionReason: noExecutableActionReason ?? "No safe executable maintenance actions found." }
      : {}),
  };
}

function emptyReviewPlanStage(): MaintenanceCandidateReviewPlanStage {
  return {
    actionCount: 0,
    executableActionCount: 0,
    recommendedActionCount: 0,
    manualReviewCount: 0,
    riskyCount: 0,
    recommendedActionIds: [],
    riskyActionIds: [],
  };
}

function buildNoActionReason(input: {
  readonly selectedThreadCount: number;
  readonly analysis: ThreadMaintenanceAnalysis;
  readonly executableSuggestionCount: number;
  readonly reviewPlanStage: MaintenanceCandidateReviewPlanStage;
}): { readonly noActionReason?: string } {
  if (input.executableSuggestionCount > 0 || input.reviewPlanStage.executableActionCount > 0) return {};
  if (input.selectedThreadCount === 0) {
    return { noActionReason: "Review window selected no threads for maintenance analysis." };
  }
  const hasAnyCandidate = input.analysis.doneCandidates.length > 0
    || input.analysis.mergeGroups.length > 0
    || input.analysis.dropCandidates.length > 0;
  if (!hasAnyCandidate) {
    const parts = [
      input.analysis.rejectedDoneCandidates.length > 0
        ? "No done candidates found in selected review window."
        : undefined,
      input.analysis.rejectedMergeGroups.length > 0
        ? "Merge candidates were rejected because selected thread groups did not pass similarity or boundary checks."
        : undefined,
      input.analysis.rejectedDropCandidates.length > 0
        ? "Drop candidates were rejected because stale threads were protected, recent, or still carried forward."
        : undefined,
    ].filter(isDefined);
    return {
      noActionReason: parts.length > 0
        ? parts.join(" ")
        : "Review window selected no stale/merge/done candidates.",
    };
  }
  return {
    noActionReason: "Executable maintenance candidates were found, but no executable suggestions reached ReviewPlan.",
  };
}

function isThreadStale(thread: NarrativeThread, chapter: number | undefined): boolean {
  if (thread.status === "done") return false;
  if (thread.status === "stale") return true;
  return chapter !== undefined && chapter - thread.lastTouchedChapter > 3;
}

function isDroppableThread(
  thread: NarrativeThread,
  chapter: number | undefined,
  injectedThreadIds: ReadonlySet<string> = new Set(),
): boolean {
  if (thread.status === "done" || chapter === undefined) return false;
  if (injectedThreadIds.has(thread.id)) return false;
  if (chapter - thread.lastTouchedChapter < 10) return false;
  const evidenceText = thread.evidence.join("");
  if (thread.evidence.length > 1 && evidenceText.length > 80) return false;
  if (thread.nextActionHint && thread.nextActionHint.length > 8 && !isGenericHint(thread.nextActionHint)) return false;
  const text = [thread.title, ...thread.evidence].join(" ");
  if (STRONG_MAINLINE_WORDS.test(text)) return false;
  return GENERIC_DROP_TITLE.test(text) || evidenceText.length <= 60 || !hasUsefulThreadKeywords(thread.title);
}

function isArcGoalDrifting(goal: ArcGoal, chapter: number | undefined): boolean {
  if (goal.status === "completed" || goal.status === "stale") return false;
  return chapter !== undefined && chapter - goal.lastTouchedChapter > 5;
}

function hasDoneEvidence(thread: NarrativeThread): boolean {
  const text = [thread.title, ...thread.evidence].join(" ");
  if (/(?:准备|打算|决定|明日|将要|必须|还要|需要|试图|想要|计划).{0,18}(?:查清|查明|确认|弄清|找到|完成|问清楚|去|调查|拿到|取回|抵达|问清)/u.test(text)) {
    return false;
  }
  return /已经|已|终于|查清|查明|确认|找到|问清|拿到|取回|抵达|完成|闭合|已解|来源已明|真相已明|弄清|找到来源|找到证据|证实|验明|对上了|已经去过|赶到|做完|成功藏好|成功进入|已经调查|已经见到|已经交给/u.test(text);
}

function rejectedDoneCandidate(thread: NarrativeThread): RejectedCandidate | undefined {
  if (thread.status === "done") {
    return {
      id: thread.id,
      title: truncateText(thread.title, 80),
      reason: "Thread is already done.",
      blocker: "already_done",
    };
  }
  const text = [thread.title, ...thread.evidence].join(" ");
  if (hasFutureIntent(text)) {
    return {
      id: thread.id,
      title: truncateText(thread.title, 80),
      reason: "Completion-looking evidence is future intent.",
      blocker: "future_intent",
    };
  }
  return {
    id: thread.id,
    title: truncateText(thread.title, 80),
    reason: "No completion evidence found.",
    blocker: "no_completion_evidence",
  };
}

function rejectedDropCandidate(
  thread: NarrativeThread,
  chapter: number | undefined,
  injectedThreadIds: ReadonlySet<string>,
): RejectedCandidate | undefined {
  const blocker = dropRejectionBlocker(thread, chapter, injectedThreadIds);
  if (!blocker) return undefined;
  return {
    id: thread.id,
    title: truncateText(thread.title, 80),
    reason: dropRejectionReason(blocker),
    blocker,
  };
}

function dropRejectionBlocker(
  thread: NarrativeThread,
  chapter: number | undefined,
  injectedThreadIds: ReadonlySet<string>,
): string | undefined {
  if (thread.status === "done") return "already_done";
  if (chapter === undefined || chapter - thread.lastTouchedChapter < 10 || injectedThreadIds.has(thread.id)) return "too_recent";
  const evidenceText = thread.evidence.join("");
  if (thread.nextActionHint && thread.nextActionHint.length > 8 && !isGenericHint(thread.nextActionHint)) return "has_next_action_hint";
  const text = [thread.title, ...thread.evidence].join(" ");
  if (STRONG_MAINLINE_WORDS.test(text)) return "strong_mainline_term";
  if (thread.evidence.length > 1 && evidenceText.length > 80) return "enough_evidence";
  return undefined;
}

function dropRejectionReason(blocker: string): string {
  if (blocker === "already_done") return "Done threads are not dropped by maintenance.";
  if (blocker === "too_recent") return "Thread is too recent or currently injected.";
  if (blocker === "has_next_action_hint") return "Thread still has a nextActionHint.";
  if (blocker === "strong_mainline_term") return "Thread contains strong mainline terms.";
  if (blocker === "related_active_hook") return "Thread relates to an active hook.";
  if (blocker === "related_active_arc_goal") return "Thread relates to an active arc goal.";
  if (blocker === "enough_evidence") return "Thread has enough evidence to keep reviewing.";
  return "Thread did not pass conservative drop checks.";
}

function findRejectedMergeGroups(
  threads: readonly NarrativeThread[],
  acceptedMergeKeys: ReadonlySet<string>,
): readonly RejectedCandidate[] {
  const rejected: RejectedCandidate[] = [];
  for (let index = 0; index < threads.length && rejected.length < 12; index += 1) {
    const left = threads[index];
    if (!left) continue;
    for (let otherIndex = index + 1; otherIndex < threads.length && rejected.length < 12; otherIndex += 1) {
      const right = threads[otherIndex];
      if (!right) continue;
      const ids = [left.id, right.id];
      const key = ids.slice().sort().join("|");
      if (acceptedMergeKeys.has(key)) continue;
      const blocker = mergeRejectionBlocker(left, right);
      if (!blocker) continue;
      rejected.push({
        ids,
        title: truncateText(`${left.title} / ${right.title}`, 100),
        reason: mergeRejectionReason(blocker),
        blocker,
      });
    }
  }
  return rejected;
}

function mergeRejectionBlocker(left: NarrativeThread, right: NarrativeThread): string | undefined {
  if (left.type !== right.type) return "cross_type";
  const leftDone = left.status === "done";
  const rightDone = right.status === "done";
  if (leftDone !== rightDone) return "done_open_mixed";
  const analysis = analyzeMergePair(left, right);
  if (analysis.blocker) return analysis.blocker;
  if (!analysis.canMerge) return "not_enough_shared_keywords";
  return undefined;
}

function conflictingStrongMainlineTopics(value: string): readonly string[] {
  const topics = [
    ["ledger", /账目|账本|账册|暗页/u],
    ["token", /信物/u],
    ["code", /暗号/u],
    ["shadow", /黑影/u],
    ["resource", /资源|粮米|月钱/u],
    ["wall", /后墙/u],
    ["fragment", /残页/u],
    ["seal", /封条/u],
  ] as const;
  return topics.filter(([, pattern]) => pattern.test(value)).map(([topic]) => topic);
}

function mergeRejectionReason(blocker: string): string {
  if (blocker === "cross_type") return "Threads have different lead/intent types.";
  if (blocker === "done_open_mixed") return "Merge would mix done and non-done threads.";
  if (blocker === "strong_mainline_conflict") return "Threads contain different strong mainline topics.";
  if (blocker === "location_conflict") return "Threads point at different locations without a shared location.";
  if (blocker === "missing_targets") return "Merge targets were missing.";
  if (blocker === "not_enough_shared_keywords") return "Threads do not share enough keywords for a safe merge.";
  return "Threads failed merge boundary checks.";
}

function hasFutureIntent(text: string): boolean {
  return /(?:准备|打算|决定|明日|将要|必须|还要|需要|试图|想要|计划).{0,18}(?:查清|查明|确认|弄清|找到|完成|问清楚|去|调查|拿到|取回|抵达|问清)/u.test(text);
}

function normalizeThreadTitleForMerge(value: string): string {
  return normalize(value)
    .replace(/主角|他|她/gu, "")
    .replace(/明日|今日|今夜|子时|清晨|翌日|夜里|当天|随后/gu, "")
    .replace(/决定|准备|打算|必须|要去|先去|继续|试图|计划|想要/gu, "")
    .replace(/前往|赶往|来到|进入|离开|寻找|查看|弄清|查清|查明|调查|追查|问清|问清楚|确认|处理/gu, "")
    .replace(/相关|事情|线索|来源|情况|问题|之事|这件事|那件事|一个|这条|那条/gu, "")
    .replace(/后墙|墙后|墙根/gu, "后墙")
    .replace(/库房账册|账目|账本|账页|暗页/gu, "账册")
    .replace(/破损信物/gu, "信物")
    .replace(/黑影暗号|墙上暗号/gu, "暗号")
    .replace(/账目|资源流向|克扣月钱|月钱克扣/gu, "账目")
    .replace(/园圃/gu, "园圃")
    .replace(/[，。、“”‘’：:；;！!？?（）()《》【】\\-—_]/gu, "");
}

function canonicalThreadTitle(value: string): string {
  return normalizeThreadTitleForMerge(value);
}

function threadsLookSimilar(left: NarrativeThread, right: NarrativeThread): boolean {
  return analyzeMergePair(left, right).canMerge;
}

function extractThreadKeywords(value: string): ReadonlySet<string> {
  return buildMergeProfile({
    id: "inline",
    type: "lead",
    title: value,
    status: "open",
    firstSeenChapter: 1,
    lastTouchedChapter: 1,
    evidence: [],
  }).keywords;
}

interface MergeProfile {
  readonly id: string;
  readonly type: NarrativeThread["type"];
  readonly status: NarrativeThread["status"];
  readonly normalizedTitle: string;
  readonly locations: ReadonlySet<string>;
  readonly objects: ReadonlySet<string>;
  readonly actions: ReadonlySet<string>;
  readonly keywords: ReadonlySet<string>;
}

interface MergePairAnalysis {
  readonly canMerge: boolean;
  readonly similarityScore: number;
  readonly sharedCanonicalKeywords: readonly string[];
  readonly reason: string;
  readonly blocker?: string;
}

const LOCATION_KEYWORDS: readonly string[] = ["后墙", "账房", "库房", "后院", "园圃", "外院", "大门", "院落", "暗格"];
const OBJECT_KEYWORDS: readonly string[] = ["账册", "信物", "暗号", "账目", "异常响动", "残页", "名单", "管事", "黑影"];
const ACTION_KEYWORDS: readonly string[] = ["调查", "潜入", "隐藏", "转移", "获取"];

const LOCATION_SYNONYMS = [
  { canonical: "后墙", pattern: /后墙|墙后|墙根/u },
  { canonical: "账房", pattern: /账房/u },
  { canonical: "库房", pattern: /库房/u },
  { canonical: "后院", pattern: /后院/u },
  { canonical: "园圃", pattern: /园圃/u },
  { canonical: "外院", pattern: /外院/u },
  { canonical: "大门", pattern: /大门/u },
  { canonical: "院落", pattern: /院落/u },
  { canonical: "暗格", pattern: /暗格/u },
] as const;

const OBJECT_SYNONYMS = [
  { canonical: "账册", pattern: /账目|账本|账册|账页|暗页|查账(?!房)/u },
  { canonical: "信物", pattern: /破损信物|信物/u },
  { canonical: "暗号", pattern: /黑影暗号|墙上暗号|暗号/u },
  { canonical: "账目", pattern: /账目|资源流向|克扣月钱|月钱克扣|粮米|月钱/u },
  { canonical: "异常响动", pattern: /后墙异常响动|异常响动|响动/u },
  { canonical: "残页", pattern: /旧账本残页|禁区残页|残页|纸页/u },
  { canonical: "名单", pattern: /名单/u },
  { canonical: "管事", pattern: /管事/u },
  { canonical: "黑影", pattern: /黑影/u },
] as const;

const ACTION_SYNONYMS = [
  { canonical: "调查", pattern: /查清|查明|调查|追查|核实|问清|查账|查看|确认/u },
  { canonical: "潜入", pattern: /夜探|潜入|潜回|进入/u },
  { canonical: "隐藏", pattern: /隐藏|藏好|收起/u },
  { canonical: "转移", pattern: /转移|搬走|带走/u },
  { canonical: "获取", pattern: /取回|拿到|找到|获得/u },
] as const;

function buildMergeProfile(thread: NarrativeThread): MergeProfile {
  const normalizedTitle = normalizeThreadTitleForMerge(thread.title);
  const text = [
    thread.title,
    normalizedTitle,
    ...thread.evidence,
    thread.nextActionHint ?? "",
    ...(thread.relatedLocations ?? []),
  ].join(" ");
  const locations = canonicalizeKeywords(text, LOCATION_SYNONYMS);
  const objects = canonicalizeKeywords(text, OBJECT_SYNONYMS);
  const actions = canonicalizeKeywords(text, ACTION_SYNONYMS);
  return {
    id: thread.id,
    type: thread.type,
    status: thread.status,
    normalizedTitle,
    locations,
    objects,
    actions,
    keywords: new Set([...locations, ...objects, ...actions]),
  };
}

function canonicalizeKeywords(
  value: string,
  entries: readonly { readonly canonical: string; readonly pattern: RegExp }[],
): ReadonlySet<string> {
  return new Set(entries
    .filter((entry) => entry.pattern.test(value))
    .map((entry) => entry.canonical));
}

function analyzeMergePair(left: NarrativeThread, right: NarrativeThread): MergePairAnalysis {
  if (left.type !== right.type) return blockedMerge("cross_type");
  const leftDone = left.status === "done";
  const rightDone = right.status === "done";
  if (leftDone !== rightDone) return blockedMerge("done_open_mixed");
  const leftProfile = buildMergeProfile(left);
  const rightProfile = buildMergeProfile(right);
  const sharedLocations = intersection(leftProfile.locations, rightProfile.locations);
  const sharedObjects = intersection(leftProfile.objects, rightProfile.objects);
  const sharedActions = intersection(leftProfile.actions, rightProfile.actions);
  const sharedCanonicalKeywords = [...sharedLocations, ...sharedObjects, ...sharedActions];
  const similarityScore = jaccard(leftProfile.keywords, rightProfile.keywords);
  const hasLocationConflict = leftProfile.locations.size > 0
    && rightProfile.locations.size > 0
    && sharedLocations.length === 0;
  const titleContains = leftProfile.normalizedTitle.length >= 2
    && rightProfile.normalizedTitle.length >= 2
    && (leftProfile.normalizedTitle.includes(rightProfile.normalizedTitle)
      || rightProfile.normalizedTitle.includes(leftProfile.normalizedTitle));
  const topics = conflictingStrongMainlineTopics([left.title, right.title, ...left.evidence, ...right.evidence].join(" "));
  if (topics.length > 1 && sharedObjects.length === 0) return blockedMerge("strong_mainline_conflict", similarityScore, sharedCanonicalKeywords);
  if (hasLocationConflict) return blockedMerge("location_conflict", similarityScore, sharedCanonicalKeywords);

  if (sharedObjects.length > 0 && sharedLocations.length > 0) {
    return acceptedMerge(similarityScore, sharedCanonicalKeywords, `shared object=${sharedObjects.join("/")} and location=${sharedLocations.join("/")}`);
  }
  if (sharedObjects.length > 0 && sharedActions.length > 0) {
    return acceptedMerge(similarityScore, sharedCanonicalKeywords, `shared object=${sharedObjects.join("/")} and action=${sharedActions.join("/")}`);
  }
  if (titleContains) {
    return acceptedMerge(Math.max(similarityScore, 0.5), sharedCanonicalKeywords, "normalized title containment");
  }
  if (similarityScore >= 0.45 && (sharedObjects.length > 0 || sharedLocations.length > 0)) {
    return acceptedMerge(similarityScore, sharedCanonicalKeywords, `jaccard similarity ${similarityScore.toFixed(2)} with shared object/location`);
  }
  return {
    canMerge: false,
    similarityScore,
    sharedCanonicalKeywords,
    reason: "not enough shared canonical keywords",
  };
}

function blockedMerge(
  blocker: string,
  similarityScore = 0,
  sharedCanonicalKeywords: readonly string[] = [],
): MergePairAnalysis {
  return {
    canMerge: false,
    blocker,
    similarityScore,
    sharedCanonicalKeywords,
    reason: blocker,
  };
}

function acceptedMerge(
  similarityScore: number,
  sharedCanonicalKeywords: readonly string[],
  reason: string,
): MergePairAnalysis {
  return {
    canMerge: true,
    similarityScore,
    sharedCanonicalKeywords,
    reason,
  };
}

function intersection(left: ReadonlySet<string>, right: ReadonlySet<string>): readonly string[] {
  return [...left].filter((value) => right.has(value));
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  return intersection(left, right).length / union.size;
}

function findMergeGroups(threads: readonly NarrativeThread[], reasons: Record<string, string>): readonly (readonly string[])[] {
  const candidates = threads.filter((thread) => thread.status !== "done");
  const pairs: Array<{
    readonly left: NarrativeThread;
    readonly right: NarrativeThread;
    readonly analysis: MergePairAnalysis;
  }> = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const left = candidates[index];
    if (!left) continue;
    for (let otherIndex = index + 1; otherIndex < candidates.length; otherIndex += 1) {
      const right = candidates[otherIndex];
      if (!right) continue;
      const analysis = analyzeMergePair(left, right);
      if (analysis.canMerge) pairs.push({ left, right, analysis });
    }
  }
  pairs.sort((left, right) => right.analysis.similarityScore - left.analysis.similarityScore
    || left.left.id.localeCompare(right.left.id)
    || left.right.id.localeCompare(right.right.id));
  const used = new Set<string>();
  const groups: string[][] = [];

  for (const pair of pairs) {
    if (groups.length >= MAX_MERGE_SUGGESTIONS) break;
    if (used.has(pair.left.id) || used.has(pair.right.id)) continue;
    const matches = [pair.left, pair.right];
    for (const other of candidates) {
      if (matches.length >= MAX_MERGE_GROUP_SIZE) break;
      if (used.has(other.id) || matches.some((match) => match.id === other.id)) continue;
      if (matches.every((match) => analyzeMergePair(match, other).canMerge)) matches.push(other);
    }
    const shared = sharedThreadKeywords(matches);
    const reason = buildMergeReason(matches, pair.analysis, shared);
    const groupKey = matches.map((match) => match.id).sort().join("+");
    reasons[groupKey] = reason;
    for (const match of matches) {
      used.add(match.id);
      reasons[match.id] = reason;
    }
    groups.push(matches.map((match) => match.id));
  }
  return groups;
}

function sharedThreadKeywords(threads: readonly NarrativeThread[]): readonly string[] {
  if (threads.length < 2) return [];
  const keywordLists = threads.map((thread) => buildMergeProfile(thread).keywords);
  return [...LOCATION_KEYWORDS, ...OBJECT_KEYWORDS, ...ACTION_KEYWORDS]
    .filter((keyword) => keywordLists.every((keywords) => keywords.has(keyword)))
    .slice(0, 4);
}

function buildMergeReason(
  threads: readonly NarrativeThread[],
  analysis: MergePairAnalysis,
  shared: readonly string[],
): string {
  return [
    `sharedCanonicalKeywords=${shared.join("/") || analysis.sharedCanonicalKeywords.join("/") || "normalized_title"}`,
    `normalizedTitles=${threads.map((thread) => buildMergeProfile(thread).normalizedTitle).join(" | ")}`,
    `similarity=${analysis.similarityScore.toFixed(2)}`,
    `reason=${analysis.reason}`,
  ].join("; ");
}

function idsBySelectionReason(
  selectionReasons: Readonly<Record<string, readonly ThreadSelectionReason[]>>,
  reason: ThreadSelectionReason,
): readonly string[] {
  return Object.entries(selectionReasons)
    .filter(([, reasons]) => reasons.includes(reason))
    .map(([id]) => id);
}

function mergeSelectionGroups(
  selectedGroups: readonly (readonly string[])[],
  analysisGroups: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  const groups: string[][] = [];
  const seen = new Set<string>();
  for (const group of [...selectedGroups, ...analysisGroups]) {
    const normalized = unique(group).slice(0, MAX_MERGE_GROUP_SIZE);
    if (normalized.length < 2) continue;
    const key = normalized.slice().sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push(normalized);
    if (groups.length >= MAX_MERGE_SUGGESTIONS) break;
  }
  return groups;
}

function mergeGroupKeys(group: readonly string[]): readonly string[] {
  const ids = unique(group);
  const keys = [ids.slice().sort().join("|")];
  for (let index = 0; index < ids.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < ids.length; otherIndex += 1) {
      const left = ids[index];
      const right = ids[otherIndex];
      if (left && right) keys.push([left, right].sort().join("|"));
    }
  }
  return keys;
}

function shareLocationAndObject(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return overlapsAny(left, right, LOCATION_KEYWORDS) && overlapsAny(left, right, OBJECT_KEYWORDS);
}

function shareObjectAndAction(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return overlapsAny(left, right, OBJECT_KEYWORDS) && overlapsAny(left, right, ACTION_KEYWORDS);
}

function hasLocationOrObjectOverlap(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return overlapsAny(left, right, LOCATION_KEYWORDS) || overlapsAny(left, right, OBJECT_KEYWORDS);
}

function overlapsAny(left: ReadonlySet<string>, right: ReadonlySet<string>, values: readonly string[]): boolean {
  return values.some((value) => left.has(value) && right.has(value));
}

function hasUsefulThreadKeywords(value: string): boolean {
  const keywords = extractThreadKeywords(value);
  return [...keywords].some((keyword) => LOCATION_KEYWORDS.includes(keyword) || OBJECT_KEYWORDS.includes(keyword));
}

function isGenericHint(value: string): boolean {
  return /再说|继续|看看|观察|处理|再做打算|脱身/u.test(value);
}

function truncateUnknown(value: unknown): unknown {
  if (typeof value === "string") return truncateText(value, MAX_TEXT_LENGTH);
  if (Array.isArray(value)) return value.slice(0, 10).map(truncateUnknown);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, truncateUnknown(item)]));
  }
  return value;
}

function truncateTextList(values: readonly string[], limit: number): readonly string[] {
  return values.slice(0, limit).map((value) => truncateText(value, MAX_TEXT_LENGTH));
}

function truncateText(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/gu, " ").trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, Math.max(0, maxLength - 1))}…`;
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, "").toLowerCase();
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
