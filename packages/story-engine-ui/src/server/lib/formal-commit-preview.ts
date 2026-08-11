import type { CommitPreviewTransactionMetadata } from "./transaction-hardening.js";

export type FormalCommitPreviewStatus = "ready" | "blocked" | "failed" | "unavailable";

export type FormalCommitPreviewBlockingReason =
  | "missing_project_path"
  | "unsafe_project_path"
  | "missing_chapter_target"
  | "missing_workspace_diff"
  | "stale_hash"
  | "context_mismatch"
  | "protected_target"
  | "missing_snapshot_manifest"
  | "missing_transaction_backup"
  | "formal_commit_confirm_unavailable"
  | "server_validation_unavailable"
  | "missing_confirm_request_context"
  | `forbidden_field:${string}`;

export interface FormalCommitPreviewSafety {
  readonly noStateJsonWrite: true;
  readonly noMarkdownWrite: true;
  readonly noMemoryWrite: true;
  readonly noFormalCommit: true;
  readonly noConfirmRoute: true;
  readonly noFormalWriteButton: true;
  readonly noCommitEngine: true;
  readonly noCommitFastDraft: true;
  readonly noApplyCommit: true;
  readonly noWorkspacePatchApply: true;
  readonly noAgentAutoApply: true;
  readonly noRollback: true;
  readonly noMultiFileApply: true;
}

// Confirm-route hashes are intentionally different from transaction-hardening hashes.
// The chapter-only confirm route validates `previewHash` and `workspaceDraftId` against
// the current workspace draft Markdown hash, and validates `baseHash` against the
// current committed chapter Markdown hash. Do not substitute `transaction.previewHash`
// or `transaction.projectHash` here; those describe preview transaction identity, not
// the chapter-only confirm route's stale-write guards.
export interface FormalCommitPreviewConfirmRequestContext {
  readonly projectPath: string;
  readonly chapterTarget: number;
  readonly previewHash: string;
  readonly baseHash: string;
  readonly workspaceDraftId: string;
  readonly readinessStatus: "ready_for_formal_review";
}

export interface FormalCommitChapterOnlyConfirmReadiness {
  readonly status: "ready" | "blocked";
  readonly blockingReasons: readonly FormalCommitPreviewBlockingReason[];
  readonly confirmRequestContextAvailable: boolean;
  readonly serverFlagRequiredForWrite: true;
  readonly fullFormalCommitReady: false;
  readonly doesNotUpdateState: true;
  readonly readinessStatus: "ready_for_formal_review" | null;
}

export interface FormalCommitPreviewRouteResult {
  readonly status: FormalCommitPreviewStatus;
  readonly formalCommitPlan: unknown | null;
  readonly wouldChangeFiles: readonly string[];
  readonly wouldUpdateState: boolean;
  readonly blockingReasons: readonly FormalCommitPreviewBlockingReason[];
  readonly warnings: readonly string[];
  readonly requestId?: string;
  readonly dryRun: true;
  readonly readOnly: true;
  readonly didWriteState: false;
  readonly didWriteMarkdown: false;
  readonly didWriteMemory: false;
  readonly didFormalCommit: false;
  // Route-level preview remains dry-run only: it does not mint a confirm token,
  // does not authorize a write, and should keep these flags false/true even when
  // the UI renders a separate explicit chapter-only confirm affordance from
  // `confirmRequestContext`. The actual confirm route stays server-flag-gated.
  readonly canConfirm: false;
  readonly confirmUnavailable: true;
  readonly previewToken: null;
  readonly confirmRequestContext?: FormalCommitPreviewConfirmRequestContext;
  readonly chapterOnlyConfirmReadiness: FormalCommitChapterOnlyConfirmReadiness;
  readonly safety: FormalCommitPreviewSafety;
}

export interface FormalCommitPreviewInput {
  readonly projectPath?: string | null;
  readonly chapterTarget?: number | string | null;
  readonly workspaceDraftId?: string | null;
  readonly commitPlan?: unknown;
  readonly requestId?: string;
  readonly transaction?: CommitPreviewTransactionMetadata | null;
  readonly confirmRequestContext?: FormalCommitPreviewConfirmRequestContext;
  readonly staleHash?: boolean;
  readonly contextMismatch?: boolean;
  readonly protectedTarget?: boolean;
  readonly snapshotManifestAvailable?: boolean;
  readonly transactionBackupAvailable?: boolean;
  readonly serverValidationAvailable?: boolean;
  readonly confirmRouteAvailable?: boolean;
  readonly additionalBlockingReasons?: readonly FormalCommitPreviewBlockingReason[];
}

const FORBIDDEN_PREVIEW_FIELDS = [
  "rawPatchText",
  "patchText",
  "arbitraryFilePath",
  "filePath",
  "path",
  "stateJson",
  "stateJsonPayload",
  "markdownContent",
  "directMarkdownContent",
  "changedFiles",
  "confirm",
  "apply",
  "write",
  "commit",
  "agentAutoApply",
  "rollback",
  "memoryWrite",
  "formalCommit",
] as const;

export function findForbiddenFormalCommitPreviewFields(body: Record<string, unknown>): string[] {
  return FORBIDDEN_PREVIEW_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
}

export function buildFormalCommitPreviewResult(input: FormalCommitPreviewInput): FormalCommitPreviewRouteResult {
  const chapter = resolveChapterNumber(input.chapterTarget);
  const blockingReasons = uniqueReasons([
    ...(!input.projectPath ? ["missing_project_path" as const] : []),
    ...(chapter === null ? ["missing_chapter_target" as const] : []),
    ...(!input.workspaceDraftId?.trim() ? ["missing_workspace_diff" as const] : []),
    ...(input.staleHash ? ["stale_hash" as const] : []),
    ...(input.contextMismatch ? ["context_mismatch" as const] : []),
    ...(input.protectedTarget ? ["protected_target" as const] : []),
    ...(input.snapshotManifestAvailable !== true ? ["missing_snapshot_manifest" as const] : []),
    ...(input.transactionBackupAvailable !== true ? ["missing_transaction_backup" as const] : []),
    ...(input.serverValidationAvailable !== true ? ["server_validation_unavailable" as const] : []),
    ...(input.confirmRouteAvailable === true ? [] : ["formal_commit_confirm_unavailable" as const]),
    ...(input.additionalBlockingReasons ?? []),
  ]);
  const wouldChangeFiles = chapter === null
    ? []
    : derivePreviewChangedFiles({ chapter, commitPlan: input.commitPlan ?? {} });
  const nonConfirmBlockingReasons = blockingReasons.filter((reason) => reason !== "formal_commit_confirm_unavailable");
  const status: FormalCommitPreviewStatus = nonConfirmBlockingReasons.length > 0
    ? "blocked"
    : blockingReasons.includes("formal_commit_confirm_unavailable")
      ? "unavailable"
      : "ready";
  const chapterOnlyConfirmReadiness = buildChapterOnlyConfirmReadiness({
    projectPath: input.projectPath,
    chapter,
    workspaceDraftId: input.workspaceDraftId,
    confirmRequestContext: input.confirmRequestContext,
    staleHash: input.staleHash,
    contextMismatch: input.contextMismatch,
    protectedTarget: input.protectedTarget,
  });

  return {
    status,
    formalCommitPlan: input.commitPlan ?? null,
    wouldChangeFiles,
    wouldUpdateState: wouldChangeFiles.some((file) => !file.startsWith("chapters/")),
    blockingReasons,
    warnings: buildWarnings(blockingReasons),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    dryRun: true,
    readOnly: true,
    didWriteState: false,
    didWriteMarkdown: false,
    didWriteMemory: false,
    didFormalCommit: false,
    canConfirm: false,
    confirmUnavailable: true,
    previewToken: null,
    ...(input.confirmRequestContext ? { confirmRequestContext: input.confirmRequestContext } : {}),
    chapterOnlyConfirmReadiness,
    safety: formalCommitPreviewSafety(),
  };
}

function buildChapterOnlyConfirmReadiness(input: {
  readonly projectPath?: string | null;
  readonly chapter: number | null;
  readonly workspaceDraftId?: string | null;
  readonly confirmRequestContext?: FormalCommitPreviewConfirmRequestContext;
  readonly staleHash?: boolean;
  readonly contextMismatch?: boolean;
  readonly protectedTarget?: boolean;
}): FormalCommitChapterOnlyConfirmReadiness {
  const blockingReasons = uniqueReasons([
    ...(!input.projectPath ? ["missing_project_path" as const] : []),
    ...(input.chapter === null ? ["missing_chapter_target" as const] : []),
    ...(!input.workspaceDraftId?.trim() ? ["missing_workspace_diff" as const] : []),
    ...(input.staleHash ? ["stale_hash" as const] : []),
    ...(input.contextMismatch ? ["context_mismatch" as const] : []),
    ...(input.protectedTarget ? ["protected_target" as const] : []),
    ...(!input.confirmRequestContext ? ["missing_confirm_request_context" as const] : []),
  ]);
  const ready = blockingReasons.length === 0;
  return {
    status: ready ? "ready" : "blocked",
    blockingReasons,
    confirmRequestContextAvailable: Boolean(input.confirmRequestContext),
    serverFlagRequiredForWrite: true,
    fullFormalCommitReady: false,
    doesNotUpdateState: true,
    readinessStatus: ready ? "ready_for_formal_review" : null,
  };
}

export function formalCommitPreviewSafety(): FormalCommitPreviewSafety {
  return {
    noStateJsonWrite: true,
    noMarkdownWrite: true,
    noMemoryWrite: true,
    noFormalCommit: true,
    noConfirmRoute: true,
    noFormalWriteButton: true,
    noCommitEngine: true,
    noCommitFastDraft: true,
    noApplyCommit: true,
    noWorkspacePatchApply: true,
    noAgentAutoApply: true,
    noRollback: true,
    noMultiFileApply: true,
  };
}

function buildWarnings(blockingReasons: readonly FormalCommitPreviewBlockingReason[]): string[] {
  const warnings: string[] = [];
  if (blockingReasons.includes("formal_commit_confirm_unavailable")) {
    warnings.push("formal commit confirm route is not implemented");
  }
  if (blockingReasons.includes("server_validation_unavailable")) {
    warnings.push("server validation is not available in preview route V0");
  }
  return warnings;
}

function resolveChapterNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function derivePreviewChangedFiles(input: { readonly chapter: number; readonly commitPlan: unknown }): string[] {
  const commitPlan = asRecord(input.commitPlan);
  const changedFiles: string[] = [`chapters/${String(input.chapter).padStart(4, "0")}.md`];
  if (!commitPlan) return changedFiles;
  if (hasNonEmptyArray(commitPlan.timelineEvents)) addUnique(changedFiles, "timeline/events.json");
  if (hasNonEmptyArray(commitPlan.hookUpdates) || hasNonEmptyArray(commitPlan.hookTrackingUpdates)) {
    addUnique(changedFiles, "story/hooks.json");
  }
  if (hasNonEmptyArray(commitPlan.threadTrackingUpdates)) addUnique(changedFiles, "story/threads.json");
  if (hasNonEmptyArray(commitPlan.arcGoalUpdates)) addUnique(changedFiles, "story/arc-goals.json");
  if (commitPlan.worldUpdates !== undefined) addUnique(changedFiles, "world/state.json");
  if (commitPlan.calendar !== undefined) addUnique(changedFiles, "time/calendar.json");
  return changedFiles;
}

function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function addUnique(items: string[], item: string): void {
  if (!items.includes(item)) items.push(item);
}

function uniqueReasons(
  reasons: readonly FormalCommitPreviewBlockingReason[],
): FormalCommitPreviewBlockingReason[] {
  const result: FormalCommitPreviewBlockingReason[] = [];
  for (const reason of reasons) {
    if (!result.includes(reason)) result.push(reason);
  }
  return result;
}
