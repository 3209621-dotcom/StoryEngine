import { classifyWorkspaceRole } from "./hybrid-workspace.js";
import { getMarkdownDocumentPolicy } from "./markdown-workspace.js";
import type { WorkspacePatchPreview } from "./workspace-patch-preview.js";

export type WorkspacePatchApplyReadinessDecision =
  | "ready"
  | "needs_confirmation"
  | "needs_strong_confirmation"
  | "blocked"
  | "forbidden";

export interface WorkspacePatchApplyReadinessInput {
  readonly preview: WorkspacePatchPreview;
  readonly userConfirmed: boolean;
  readonly strongConfirmed: boolean;
  readonly currentFileHash?: string;
  readonly expectedBeforeHash?: string;
  readonly targetPath: string;
  readonly serverApplyAuthorized?: boolean;
}

export interface WorkspacePatchApplyReadinessAudit {
  readonly isReadinessOnly: true;
  readonly willWriteFiles: false;
  readonly willWriteMemory: false;
  readonly willReadFiles: false;
  readonly willApplyPatch: false;
  readonly willModifyStateJson: false;
  readonly generatedAt: string;
}

export interface WorkspacePatchApplyReadinessResult {
  readonly readyToApply: boolean;
  readonly decision: WorkspacePatchApplyReadinessDecision;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly audit: WorkspacePatchApplyReadinessAudit;
}

const PROTECTED_ROLES = new Set(["json_state", "memory_record", "transaction_record", "formal_commit_artifact"]);

export function evaluateWorkspacePatchApplyReadiness(
  input: WorkspacePatchApplyReadinessInput,
): WorkspacePatchApplyReadinessResult {
  const reasons = getBlockingReasons(input);
  const warnings = getReadinessWarnings(input.preview);
  const requiredChecks = getRequiredChecks(input.preview);

  const decision = decideReadiness(input, reasons);

  return {
    readyToApply: decision === "ready",
    decision,
    reasons: decision === "ready" ? [] : reasons,
    warnings,
    requiredChecks,
    audit: buildReadinessAudit(),
  };
}

export function summarizePatchApplyReadiness(readiness: WorkspacePatchApplyReadinessResult): string {
  return [
    `decision=${readiness.decision}`,
    `readyToApply=${String(readiness.readyToApply)}`,
    `willWriteFiles=${String(readiness.audit.willWriteFiles)}`,
    `willWriteMemory=${String(readiness.audit.willWriteMemory)}`,
    `willReadFiles=${String(readiness.audit.willReadFiles)}`,
    `willApplyPatch=${String(readiness.audit.willApplyPatch)}`,
    `willModifyStateJson=${String(readiness.audit.willModifyStateJson)}`,
  ].join("; ");
}

function decideReadiness(
  input: WorkspacePatchApplyReadinessInput,
  blockingReasons: readonly string[],
): WorkspacePatchApplyReadinessDecision {
  if (blockingReasons.length > 0) return "blocked";
  if (input.preview.requiresStrongConfirmation && !input.strongConfirmed) return "needs_strong_confirmation";
  if (input.preview.requiresConfirmation && !input.userConfirmed) return "needs_confirmation";
  if (!input.preview.canApplyInV1 && input.serverApplyAuthorized !== true) return "blocked";

  return "ready";
}

function getBlockingReasons(input: WorkspacePatchApplyReadinessInput): string[] {
  const reasons: string[] = [];
  const { preview } = input;
  const workspaceRole = classifyWorkspaceRole(input.targetPath);

  if (PROTECTED_ROLES.has(workspaceRole)) {
    reasons.push(`${workspaceRole} paths are protected and cannot be applied by Workspace Patch Apply V1.`);
  }

  if (preview.riskLevel === "blocked") {
    reasons.push(`${preview.documentType} preview is blocked.`);
  }

  if (preview.documentType === "unknown_markdown") {
    reasons.push("unknown_markdown previews are blocked until classified.");
  }

  for (const blockedReason of preview.blockedReasons) {
    reasons.push(blockedReason);
  }

  if (input.expectedBeforeHash && input.currentFileHash && input.expectedBeforeHash !== input.currentFileHash) {
    reasons.push("stale patch: expectedBeforeHash does not match currentFileHash.");
  }

  if (preview.audit.isPreviewOnly !== true) {
    reasons.push("preview-only audit is required before patch apply readiness.");
  }

  if (preview.audit.willWriteFiles !== false) {
    reasons.push("willWriteFiles must remain false during readiness evaluation.");
  }

  if (preview.audit.willWriteMemory !== false) {
    reasons.push("willWriteMemory must remain false during readiness evaluation.");
  }

  if (preview.audit.willApplyPatch !== false) {
    reasons.push("willApplyPatch must remain false during readiness evaluation.");
  }

  if (preview.audit.willModifyStateJson !== false) {
    reasons.push("willModifyStateJson must remain false during readiness evaluation.");
  }

  if (!preview.canApplyInV1 && input.serverApplyAuthorized !== true && !requiresMissingConfirmation(input)) {
    reasons.push("canApplyInV1 is false; this helper is readiness-only and cannot permit V1 apply.");
  }

  return uniqueStrings(reasons);
}

function requiresMissingConfirmation(input: WorkspacePatchApplyReadinessInput): boolean {
  return (
    (input.preview.requiresStrongConfirmation && !input.strongConfirmed) ||
    (input.preview.requiresConfirmation && !input.userConfirmed)
  );
}

function getRequiredChecks(preview: WorkspacePatchPreview): string[] {
  const checks = [
    "preview_first",
    "preview_only_audit",
    "protected_path_check",
    "stale_hash_check",
    "change_summary_required",
    "rollback_audit_strategy_required",
  ];

  if (preview.requiresConfirmation) checks.push("user_confirmation");
  if (preview.requiresStrongConfirmation) checks.push("strong_confirmation");

  return checks;
}

function getReadinessWarnings(preview: WorkspacePatchPreview): string[] {
  const warnings = ["Workspace Patch Apply is a future high-risk write capability; this helper only evaluates readiness."];
  const policy = getMarkdownDocumentPolicy(preview.documentType);

  if (preview.documentType === "skill_markdown") {
    warnings.push("skill Markdown changes can affect agent behavior and must explain impact before confirmation.");
  }

  if (preview.documentType === "constitution_markdown") {
    warnings.push("constitution Markdown changes require strong confirmation before any future apply.");
  }

  for (const note of policy.notes) {
    if (note.toLowerCase().includes("confirmation") || note.toLowerCase().includes("impact")) warnings.push(note);
  }

  return uniqueStrings(warnings);
}

function buildReadinessAudit(): WorkspacePatchApplyReadinessAudit {
  return {
    isReadinessOnly: true,
    willWriteFiles: false,
    willWriteMemory: false,
    willReadFiles: false,
    willApplyPatch: false,
    willModifyStateJson: false,
    generatedAt: new Date(0).toISOString(),
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
