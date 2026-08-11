import { classifyWorkspaceRole } from "./hybrid-workspace.js";
import {
  classifyMarkdownDocumentType,
  getMarkdownDocumentPolicy,
  type MarkdownWorkspaceDocumentType,
} from "./markdown-workspace.js";

export type WorkspacePatchChangeKind = "create" | "update" | "delete_proposal";
export type WorkspacePatchRiskLevel = "low" | "medium" | "high" | "blocked";

export interface WorkspacePatchPreviewInput {
  readonly targetPath: string;
  readonly beforeText: string;
  readonly afterText: string;
  readonly title?: string;
  readonly reason?: string;
}

export interface WorkspacePatchPreviewAudit {
  readonly isPreviewOnly: true;
  readonly willWriteFiles: false;
  readonly willWriteMemory: false;
  readonly willModifyStateJson: false;
  readonly willApplyPatch: false;
  readonly generatedAt: string;
}

export interface WorkspacePatchPreview {
  readonly patchId: string;
  readonly targetPath: string;
  readonly documentType: MarkdownWorkspaceDocumentType;
  readonly title: string;
  readonly summary: string;
  readonly beforeText: string;
  readonly afterText: string;
  readonly diffText: string;
  readonly changeKind: WorkspacePatchChangeKind;
  readonly riskLevel: WorkspacePatchRiskLevel;
  readonly requiresConfirmation: boolean;
  readonly requiresStrongConfirmation: boolean;
  readonly canApplyInV1: false;
  readonly blockedReasons: readonly string[];
  readonly warnings: readonly string[];
  readonly audit: WorkspacePatchPreviewAudit;
}

const BLOCKED_WORKSPACE_ROLES = new Set(["json_state", "memory_record", "transaction_record", "formal_commit_artifact"]);

export function buildMarkdownPatchPreview(input: WorkspacePatchPreviewInput): WorkspacePatchPreview {
  const targetPath = normalizePreviewPath(input.targetPath);
  const documentType = classifyMarkdownDocumentType(targetPath);
  const riskLevel = classifyPatchRisk(targetPath);
  const blockedReasons = getBlockedReasons(targetPath, documentType);
  const markdownPolicy = getMarkdownDocumentPolicy(documentType);
  const changeKind = classifyChangeKind(input.beforeText, input.afterText);
  const warnings = getPatchPreviewWarnings(targetPath, documentType, riskLevel);

  return {
    patchId: `patch-preview-${stablePreviewId(targetPath, input.beforeText, input.afterText)}`,
    targetPath,
    documentType,
    title: input.title ?? defaultPreviewTitle(documentType, changeKind),
    summary: buildPatchSummary(targetPath, documentType, changeKind, riskLevel, input.reason),
    beforeText: input.beforeText,
    afterText: input.afterText,
    diffText: buildLineDiff(input.beforeText, input.afterText),
    changeKind,
    riskLevel,
    requiresConfirmation: blockedReasons.length === 0 && markdownPolicy.requiresPatchConfirmation,
    requiresStrongConfirmation: blockedReasons.length === 0 && markdownPolicy.requiresStrongConfirmation,
    canApplyInV1: false,
    blockedReasons,
    warnings,
    audit: {
      isPreviewOnly: true,
      willWriteFiles: false,
      willWriteMemory: false,
      willModifyStateJson: false,
      willApplyPatch: false,
      generatedAt: new Date(0).toISOString(),
    },
  };
}

export function buildLineDiff(beforeText: string, afterText: string): string {
  const beforeLines = splitPreviewLines(beforeText);
  const afterLines = splitPreviewLines(afterText);
  const maxLineCount = Math.max(beforeLines.length, afterLines.length);
  const diffLines: string[] = [];

  for (let index = 0; index < maxLineCount; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];

    if (beforeLine === afterLine && beforeLine !== undefined) {
      diffLines.push(`  ${beforeLine}`);
      continue;
    }

    if (beforeLine !== undefined) diffLines.push(`- ${beforeLine}`);
    if (afterLine !== undefined) diffLines.push(`+ ${afterLine}`);
  }

  return diffLines.join("\n");
}

export function classifyPatchRisk(targetPath: string): WorkspacePatchRiskLevel {
  const normalizedPath = normalizePreviewPath(targetPath);
  const workspaceRole = classifyWorkspaceRole(normalizedPath);
  const documentType = classifyMarkdownDocumentType(normalizedPath);

  if (BLOCKED_WORKSPACE_ROLES.has(workspaceRole) || documentType === "unknown_markdown") return "blocked";
  if (documentType === "skill_markdown" || documentType === "constitution_markdown") return "high";
  if (documentType === "character_markdown" || documentType === "world_markdown" || documentType === "outline_markdown") return "medium";

  return "low";
}

export function canPreviewPatchForPath(targetPath: string): boolean {
  return classifyPatchRisk(targetPath) !== "blocked";
}

export function summarizePatchPreview(preview: WorkspacePatchPreview): string {
  return [
    preview.targetPath,
    preview.documentType,
    `changeKind=${preview.changeKind}`,
    `risk=${preview.riskLevel}`,
    `previewOnly=${String(preview.audit.isPreviewOnly)}`,
    `canApplyInV1=${String(preview.canApplyInV1)}`,
    `willWriteMemory=${String(preview.audit.willWriteMemory)}`,
  ].join("; ");
}

function getBlockedReasons(targetPath: string, documentType: MarkdownWorkspaceDocumentType): string[] {
  const workspaceRole = classifyWorkspaceRole(targetPath);

  if (workspaceRole === "json_state") return ["json_state paths cannot receive Markdown patch previews in V1."];
  if (workspaceRole === "memory_record") return ["memory_record paths cannot receive Markdown patch previews in V1."];
  if (workspaceRole === "transaction_record") return ["transaction_record paths cannot receive Markdown patch previews in V1."];
  if (workspaceRole === "formal_commit_artifact") {
    return ["formal_commit_artifact paths cannot receive Markdown patch previews in V1."];
  }
  if (documentType === "unknown_markdown") return ["unknown_markdown paths are blocked until classified."];

  return [];
}

function getPatchPreviewWarnings(
  targetPath: string,
  documentType: MarkdownWorkspaceDocumentType,
  riskLevel: WorkspacePatchRiskLevel,
): string[] {
  const warnings: string[] = ["Preview only: this helper will not apply patches or write files."];

  if (riskLevel === "high" && documentType === "skill_markdown") {
    warnings.push("Skill Markdown is high impact and requires confirmation with an impact explanation.");
  }
  if (riskLevel === "high" && documentType === "constitution_markdown") {
    warnings.push("Constitution Markdown is high impact and requires strong confirmation.");
  }
  if (riskLevel === "blocked") {
    warnings.push(`${targetPath} is blocked for Workspace Patch Diff Preview V1.`);
  }

  return warnings;
}

function buildPatchSummary(
  targetPath: string,
  documentType: MarkdownWorkspaceDocumentType,
  changeKind: WorkspacePatchChangeKind,
  riskLevel: WorkspacePatchRiskLevel,
  reason?: string,
): string {
  const reasonSuffix = reason ? ` Reason: ${reason}` : "";

  return `${changeKind} preview for ${targetPath} (${documentType}, ${riskLevel} risk).${reasonSuffix}`;
}

function defaultPreviewTitle(documentType: MarkdownWorkspaceDocumentType, changeKind: WorkspacePatchChangeKind): string {
  if (changeKind === "create") return `Create ${documentType}`;
  if (changeKind === "delete_proposal") return `Delete proposal for ${documentType}`;
  return `Update ${documentType}`;
}

function classifyChangeKind(beforeText: string, afterText: string): WorkspacePatchChangeKind {
  if (beforeText.length === 0 && afterText.length > 0) return "create";
  if (beforeText.length > 0 && afterText.length === 0) return "delete_proposal";
  return "update";
}

function splitPreviewLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.split(/\r?\n/);
}

function normalizePreviewPath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").replace(/^\/+/, "");
}

function stablePreviewId(targetPath: string, beforeText: string, afterText: string): string {
  let hash = 0;
  const source = `${targetPath}\n${beforeText}\n---\n${afterText}`;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}
