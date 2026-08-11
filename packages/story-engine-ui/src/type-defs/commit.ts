export type CommitSelectiveDecisionState = "accept" | "reject" | "defer";

export interface CommitPreviewCandidate {
  readonly id: string;
  readonly name: string;
  readonly targetId?: string;
  readonly changeType?: string;
  readonly before?: string;
  readonly after?: string;
  readonly evidence?: string;
  readonly severity?: "info" | "warning" | "error" | "high";
  readonly requiresUserConfirm?: boolean;
}

export interface CommitSelectiveConfirmationState {
  readonly assets: Readonly<Record<string, CommitSelectiveDecisionState>>;
  readonly locations: Readonly<Record<string, CommitSelectiveDecisionState>>;
  readonly characterKnowledge: Readonly<Record<string, CommitSelectiveDecisionState>>;
}

export interface CommitPreviewTransactionUiMetadata {
  readonly version: "transaction-hardening-v1";
  readonly transactionId: string;
  readonly previewHash: string;
  readonly projectHash: string;
  readonly chapter: number;
  readonly draftHash: string;
  readonly commitPlanHash: string;
  readonly selectiveCandidateSummaryHash: string;
}

export interface CommitPreviewUiReport {
  readonly transaction?: CommitPreviewTransactionUiMetadata;
  readonly transactionId?: string;
  readonly previewHash?: string;
  readonly passed?: boolean;
  readonly highRiskIssueCount?: number;
  readonly requiresExplicitOverride?: boolean;
  readonly qualityGate?: {
    readonly blockingCount: number;
    readonly draftConfirmed: number;
    readonly draftNeedsConfirmation: number;
    readonly semanticConfirmed: number;
    readonly semanticNeedsConfirmation: number;
    readonly message: string;
  };
  readonly blockingReasons: readonly string[];
  readonly issues: readonly string[];
  /** 人物名近形漂移：本章出现的名字疑似把已确立角色名写歪（引擎确定性判定）。固定展示成明确提醒，不阻断入库。 */
  readonly nameDriftFindings: readonly { readonly establishedName: string; readonly driftedVariant: string }[];
  /** 伏笔/线索待收口：某伏笔/线索连续多章没推进（引擎确定性判定：active/open 超 3 章未触及）。固定展示成明确提醒，不阻断入库。 */
  readonly staleThreadWarnings: readonly { readonly kind: string; readonly title: string; readonly chaptersSinceTouched: number; readonly lastTouchedChapter: number }[];
  readonly timelineChange?: string;
  readonly hookChanges: readonly string[];
  readonly threadChanges: readonly string[];
  readonly arcGoalChanges: readonly string[];
  readonly characterChanges: readonly string[];
  readonly worldChanges: readonly string[];
  readonly assetChanges: {
    readonly newAssetCandidates: readonly CommitPreviewCandidate[];
    readonly assetStatusChanges: readonly CommitPreviewCandidate[];
    readonly assetUsageEvidence: readonly CommitPreviewCandidate[];
    readonly unregisteredAssetWarnings: readonly CommitPreviewCandidate[];
  };
  readonly locationChanges: {
    readonly newLocationCandidates: readonly CommitPreviewCandidate[];
    readonly locationTransitionCandidates: readonly CommitPreviewCandidate[];
    readonly spatialViolationWarnings: readonly CommitPreviewCandidate[];
  };
  readonly characterKnowledgeChanges: {
    readonly stateChanges: readonly CommitPreviewCandidate[];
    readonly knowledgeKnownChanges: readonly CommitPreviewCandidate[];
    readonly knowledgeUnknownChanges: readonly CommitPreviewCandidate[];
    readonly characterMatrixCandidates: readonly CommitPreviewCandidate[];
    readonly forbiddenRevealTouches: readonly CommitPreviewCandidate[];
  };
}
