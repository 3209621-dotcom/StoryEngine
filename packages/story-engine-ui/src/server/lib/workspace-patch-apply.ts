import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  classifyMarkdownDocumentType,
  type MarkdownWorkspaceDocumentType,
} from "../../agent-command-center/markdown-workspace.js";
import {
  evaluateWorkspacePatchApplyReadiness,
} from "../../agent-command-center/workspace-patch-apply-readiness.js";
import {
  normalizeWorkspacePatchTargetPath,
  validateWorkspacePatchTargetPath,
} from "../../agent-command-center/workspace-patch-path-safety.js";
import {
  buildLineDiff,
  buildMarkdownPatchPreview,
} from "../../agent-command-center/workspace-patch-preview.js";

export interface WorkspacePatchApplyInput {
  readonly projectDir: string;
  readonly targetPath: string;
  readonly beforeText: string;
  readonly afterText: string;
  readonly patchId?: string;
  readonly previewId?: string;
  readonly expectedBeforeHash: string;
  readonly userConfirmed: boolean;
  readonly idempotencyKey: string;
}

export interface WorkspacePatchApplySuccess {
  readonly ok: true;
  readonly patchApplyTxId: string;
  readonly targetPath: string;
  readonly documentType: MarkdownWorkspaceDocumentType;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly changeSummary: string;
  readonly changedFiles: readonly string[];
  readonly rollbackAvailable: boolean;
  readonly rollbackNote: string;
  readonly noStateJsonWrite: true;
  readonly noMemoryWrite: true;
  readonly noFormalCommitApply: true;
  readonly warnings: readonly string[];
  readonly transactionPath: string;
}

export interface WorkspacePatchApplyFailure {
  readonly ok: false;
  readonly code: WorkspacePatchApplyErrorCode;
  readonly error: string;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
}

export type WorkspacePatchApplyResult = WorkspacePatchApplySuccess | WorkspacePatchApplyFailure;

export interface WorkspacePatchApplyRuntimeHooks {
  readonly writeAppliedManifest?: (transactionDir: string, manifest: WorkspacePatchApplyManifest) => Promise<void>;
  readonly afterTempWriteBeforeRename?: () => Promise<void>;
  readonly renameTempFile?: (tempFile: string, targetFile: string) => Promise<void>;
}

export type WorkspacePatchTransactionRootValidation = {
  readonly ok: true;
  readonly transactionPath: string;
} | {
  readonly ok: false;
  readonly transactionPath: string;
  readonly reasons: readonly string[];
};

export type WorkspacePatchApplyErrorCode =
  | "missing_project_path"
  | "missing_target_path"
  | "missing_expected_before_hash"
  | "missing_idempotency_key"
  | "missing_before_text"
  | "missing_after_text"
  | "missing_patch_id"
  | "missing_user_confirmation"
  | "path_safety_failed"
  | "target_not_allowed_v0"
  | "target_read_failed"
  | "target_disk_unsafe"
  | "transaction_root_unsafe"
  | "transaction_file_unsafe"
  | "temp_file_unsafe"
  | "preview_before_hash_mismatch"
  | "preview_id_mismatch"
  | "stale_hash_mismatch"
  | "readiness_failed"
  | "idempotency_key_conflict"
  | "write_failed";

interface WorkspacePatchApplyManifest {
  readonly version: "workspace-patch-apply-v0";
  readonly status: "prepared" | "applied" | "failed";
  readonly patchApplyTxId: string;
  readonly targetPath: string;
  readonly documentType: MarkdownWorkspaceDocumentType;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly patchId: string;
  readonly idempotencyKey: string;
  readonly userConfirmed: boolean;
  readonly appliedAt?: string;
  readonly rollbackAvailable: boolean;
  readonly rollbackNote: string;
  readonly changedFiles: readonly string[];
  readonly transactionPath: string;
  readonly changeSummaryPath: string;
  readonly previousContentPath: string;
  readonly nextContentPath: string;
  readonly noStateJsonWrite: true;
  readonly noMemoryWrite: true;
  readonly noFormalCommitApply: true;
  readonly cleanupArchive: false;
  readonly error?: string;
}

const WORKSPACE_PATCH_APPLY_V0_ALLOWED_DOCUMENT_TYPES = new Set<MarkdownWorkspaceDocumentType>([
  "chapter_markdown",
  "draft_markdown",
  "outline_markdown",
  "note_markdown",
  "review_markdown",
  "quality_report_markdown",
  "task_log_markdown",
]);

const WORKSPACE_PATCH_ROLLBACK_NOTE = "rollbackAvailable means transaction backup exists; UI undo is not yet implemented.";

const WORKSPACE_PATCH_SUCCESS_SAFETY_FIELDS = {
  noStateJsonWrite: true,
  noMemoryWrite: true,
  noFormalCommitApply: true,
} as const;

export async function applyWorkspacePatch(
  input: WorkspacePatchApplyInput,
  runtimeHooks: WorkspacePatchApplyRuntimeHooks = {},
): Promise<WorkspacePatchApplyResult> {
  const requiredFieldsResult = validateRequiredFields(input);
  if (requiredFieldsResult) return requiredFieldsResult;

  const pathSafety = validateWorkspacePatchTargetPath({
    projectRoot: input.projectDir,
    targetPath: input.targetPath,
  });
  if (!pathSafety.ok) {
    return failure("path_safety_failed", "Workspace patch target path failed safety validation.", pathSafety.reasons, pathSafety.warnings);
  }

  const targetPath = pathSafety.normalizedPath;
  const documentType = classifyMarkdownDocumentType(targetPath);
  if (!WORKSPACE_PATCH_APPLY_V0_ALLOWED_DOCUMENT_TYPES.has(documentType)) {
    return failure("target_not_allowed_v0", `${documentType} is not allowed for Workspace Patch Apply V0.`, [], pathSafety.warnings);
  }

  const targetFile = resolve(input.projectDir, targetPath);
  const diskSafety = await validateRuntimeTargetFile({
    projectDir: input.projectDir,
    targetPath,
    targetFile,
  });
  if (!diskSafety.ok) {
    return failure(diskSafety.code, diskSafety.error, diskSafety.reasons, pathSafety.warnings);
  }

  const patchId = input.patchId ?? input.previewId;
  if (!patchId) {
    return failure("missing_patch_id", "Workspace patch apply requires patchId or previewId.", [], pathSafety.warnings);
  }

  const preview = buildMarkdownPatchPreview({
    targetPath,
    beforeText: input.beforeText,
    afterText: input.afterText,
  });
  if (preview.patchId !== patchId) {
    return failure("preview_id_mismatch", "patchId does not match server-recomputed patch preview.", [], pathSafety.warnings);
  }

  const beforeHash = sha256(input.beforeText);
  const afterHash = sha256(input.afterText);
  const patchApplyTxId = workspacePatchTransactionId(input.idempotencyKey);
  const transactionSafety = await validateWorkspacePatchTransactionRoot(input);
  const transactionPath = transactionSafety.transactionPath;
  const transactionDir = join(input.projectDir, transactionPath);
  if (!transactionSafety.ok) {
    return failure("transaction_root_unsafe", "Workspace patch transaction root is unsafe.", transactionSafety.reasons, pathSafety.warnings);
  }

  const idempotency = await checkIdempotency({
    transactionDir,
    idempotencyKey: input.idempotencyKey,
    targetPath,
    beforeHash,
    afterHash,
    patchId,
  });
  if (idempotency.blockedCode) {
    return failure(idempotency.blockedCode, idempotency.error, idempotency.reasons, pathSafety.warnings);
  }
  if (idempotency.conflict) {
    return failure("idempotency_key_conflict", "idempotencyKey already belongs to a different workspace patch apply request.", idempotency.reasons, pathSafety.warnings);
  }
  if (idempotency.result) {
    return { ...idempotency.result, warnings: [...idempotency.result.warnings, "idempotency replay: existing workspace patch apply transaction returned."] };
  }

  const newTransactionSafety = await validateNewTransactionDirectoryForWrite(transactionDir);
  if (!newTransactionSafety.ok) {
    return failure(newTransactionSafety.code, "Workspace patch transaction files are unsafe.", newTransactionSafety.reasons, pathSafety.warnings);
  }

  const currentContent = await readFile(targetFile, "utf-8").catch(() => undefined);
  if (currentContent === undefined) {
    return failure("target_read_failed", "Target Markdown file could not be read.", [], pathSafety.warnings);
  }
  const currentFileHash = sha256(currentContent);
  if (currentFileHash !== input.expectedBeforeHash) {
    return failure("stale_hash_mismatch", "Target file changed after preview; expectedBeforeHash does not match current file.", [], pathSafety.warnings);
  }
  if (beforeHash !== input.expectedBeforeHash) {
    return failure("preview_before_hash_mismatch", "beforeText hash does not match expectedBeforeHash.", [], pathSafety.warnings);
  }

  const readiness = evaluateWorkspacePatchApplyReadiness({
    preview,
    targetPath,
    userConfirmed: input.userConfirmed,
    strongConfirmed: false,
    currentFileHash,
    expectedBeforeHash: input.expectedBeforeHash,
    serverApplyAuthorized: true,
  });
  if (!readiness.readyToApply) {
    return failure("readiness_failed", `Workspace patch apply readiness failed: ${readiness.decision}.`, readiness.reasons, [
      ...pathSafety.warnings,
      ...readiness.warnings,
    ]);
  }

  const changedFiles = [targetPath];
  const changeSummary = buildChangeSummary({
    targetPath,
    documentType,
    beforeHash,
    afterHash,
    patchId,
    diffText: buildLineDiff(input.beforeText, input.afterText),
  });
  const manifestBase: Omit<WorkspacePatchApplyManifest, "status" | "appliedAt" | "error"> = {
    version: "workspace-patch-apply-v0",
    patchApplyTxId,
    targetPath,
    documentType,
    beforeHash,
    afterHash,
    patchId,
    idempotencyKey: input.idempotencyKey,
    userConfirmed: true,
    rollbackAvailable: true,
    rollbackNote: WORKSPACE_PATCH_ROLLBACK_NOTE,
    changedFiles,
    transactionPath,
    changeSummaryPath: `${transactionPath}/change-summary.md`,
    previousContentPath: `${transactionPath}/before.md`,
    nextContentPath: `${transactionPath}/after.md`,
    noStateJsonWrite: true,
    noMemoryWrite: true,
    noFormalCommitApply: true,
    cleanupArchive: false,
  };

  const ensuredTransactionDir = await ensureSafeTransactionDirectory({
    projectDir: input.projectDir,
    transactionPath,
  }).catch((error) => ({
    ok: false as const,
    reasons: [error instanceof Error ? error.message : String(error)],
  }));
  if (!ensuredTransactionDir.ok) {
    return failure("transaction_root_unsafe", "Workspace patch transaction root is unsafe.", ensuredTransactionDir.reasons, pathSafety.warnings);
  }
  const outputFileSafety = await validateTransactionOutputFilesAvailable(transactionDir);
  if (!outputFileSafety.ok) {
    return failure("transaction_file_unsafe", "Workspace patch transaction files are unsafe.", outputFileSafety.reasons, pathSafety.warnings);
  }

  try {
    await writeTransactionFiles(transactionDir, manifestBase, "prepared", input.beforeText, input.afterText, changeSummary);
  } catch (error) {
    await writeManifest(transactionDir, {
      ...manifestBase,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    }, { replaceExisting: true }).catch(() => undefined);
    return failure("write_failed", "Workspace patch apply failed while writing prepared transaction files.", [
      error instanceof Error ? error.message : String(error),
    ], pathSafety.warnings);
  }

  const tempFile = join(dirname(targetFile), `${sanitizeTempName(targetPath)}.${patchApplyTxId}.tmp`);
  const tempFileSafety = await validateTempFileAvailable(tempFile);
  if (!tempFileSafety.ok) {
    return failure("temp_file_unsafe", "Workspace patch temp file is unsafe.", tempFileSafety.reasons, pathSafety.warnings);
  }

  try {
    await writeFile(tempFile, input.afterText, { encoding: "utf-8", flag: "wx" });
  } catch (error) {
    await writeManifest(transactionDir, {
      ...manifestBase,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    }, { replaceExisting: true }).catch(() => undefined);
    return failure("write_failed", "Workspace patch apply failed while writing transaction or target file.", [
      error instanceof Error ? error.message : String(error),
    ], pathSafety.warnings);
  }
  const writtenTempSafety = await validateWrittenTempFile(tempFile);
  if (!writtenTempSafety.ok) {
    const cleanupWarnings = await cleanupTempFile(tempFile);
    return failure("temp_file_unsafe", "Workspace patch temp file is unsafe.", writtenTempSafety.reasons, [
      ...pathSafety.warnings,
      ...cleanupWarnings,
    ]);
  }

  try {
    await runtimeHooks.afterTempWriteBeforeRename?.();
  } catch (error) {
    const cleanupWarnings = await cleanupTempFile(tempFile);
    await writeManifest(transactionDir, {
      ...manifestBase,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    }, { replaceExisting: true }).catch(() => undefined);
    return failure("write_failed", "Workspace patch apply failed before final rename.", [
      error instanceof Error ? error.message : String(error),
    ], [
      ...pathSafety.warnings,
      ...cleanupWarnings,
    ]);
  }

  const finalDiskSafety = await validateRuntimeTargetFile({
    projectDir: input.projectDir,
    targetPath,
    targetFile,
  });
  if (!finalDiskSafety.ok) {
    const cleanupWarnings = await cleanupTempFile(tempFile);
    return failure(finalDiskSafety.code, finalDiskSafety.error, finalDiskSafety.reasons, [
      ...pathSafety.warnings,
      ...cleanupWarnings,
    ]);
  }
  const finalCurrentContent = await readFile(targetFile, "utf-8").catch(() => undefined);
  if (finalCurrentContent === undefined) {
    const cleanupWarnings = await cleanupTempFile(tempFile);
    return failure("target_read_failed", "Target Markdown file could not be read before final rename.", [], [
      ...pathSafety.warnings,
      ...cleanupWarnings,
    ]);
  }
  const finalCurrentHash = sha256(finalCurrentContent);
  if (finalCurrentHash !== input.expectedBeforeHash) {
    const cleanupWarnings = await cleanupTempFile(tempFile);
    return failure("stale_hash_mismatch", "Target file changed before final rename; expectedBeforeHash does not match current file.", [], [
      ...pathSafety.warnings,
      ...cleanupWarnings,
    ]);
  }

  const finalTempSafety = await validateFinalTempFileBeforeRename(tempFile, afterHash);
  if (!finalTempSafety.ok) {
    const cleanupWarnings = await cleanupTempFile(tempFile);
    return failure("temp_file_unsafe", "Workspace patch temp file is unsafe before final rename.", finalTempSafety.reasons, [
      ...pathSafety.warnings,
      ...cleanupWarnings,
    ]);
  }

  try {
    const renameTempFile = runtimeHooks.renameTempFile ?? rename;
    await renameTempFile(tempFile, targetFile);
  } catch (error) {
    const cleanupWarnings = await cleanupTempFile(tempFile);
    await writeManifest(transactionDir, {
      ...manifestBase,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    }, { replaceExisting: true }).catch(() => undefined);
    return failure("write_failed", "Workspace patch apply failed while writing transaction or target file.", [
      error instanceof Error ? error.message : String(error),
    ], [
      ...pathSafety.warnings,
      ...cleanupWarnings,
    ]);
  }

  const appliedAt = new Date().toISOString();
  try {
    const writeAppliedManifest = runtimeHooks.writeAppliedManifest
      ?? ((dir: string, manifest: WorkspacePatchApplyManifest) => writeManifest(dir, manifest, { replaceExisting: true }));
    await writeAppliedManifest(transactionDir, { ...manifestBase, status: "applied", appliedAt });
  } catch (error) {
    return {
      ok: true,
      patchApplyTxId,
      targetPath,
      documentType,
      beforeHash,
      afterHash,
      changeSummary,
      changedFiles,
      rollbackAvailable: true,
      rollbackNote: WORKSPACE_PATCH_ROLLBACK_NOTE,
      ...WORKSPACE_PATCH_SUCCESS_SAFETY_FIELDS,
      warnings: [
        ...pathSafety.warnings,
        `post_apply_audit_failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
      transactionPath,
    };
  }

  return {
    ok: true,
    patchApplyTxId,
    targetPath,
    documentType,
    beforeHash,
    afterHash,
    changeSummary,
    changedFiles,
    rollbackAvailable: true,
    rollbackNote: WORKSPACE_PATCH_ROLLBACK_NOTE,
    ...WORKSPACE_PATCH_SUCCESS_SAFETY_FIELDS,
    warnings: pathSafety.warnings,
    transactionPath,
  };
}

/**
 * Read-only transaction-root guard for callers that must create a snapshot
 * before applying the patch. The apply path repeats this check so the guard is
 * not treated as authorization across the snapshot boundary.
 */
export async function validateWorkspacePatchTransactionRoot(
  input: Pick<WorkspacePatchApplyInput, "projectDir" | "idempotencyKey">,
): Promise<WorkspacePatchTransactionRootValidation> {
  const transactionPath = `.story-engine-tx/workspace-patches/${workspacePatchTransactionId(input.idempotencyKey)}`;
  const result = await validateTransactionRootSafety({
    projectDir: input.projectDir,
    transactionPath,
  });
  return result.ok
    ? { ok: true, transactionPath }
    : { ok: false, transactionPath, reasons: result.reasons };
}

function workspacePatchTransactionId(idempotencyKey: string): string {
  return `workspace-patch-${sha256(idempotencyKey).slice(0, 16)}`;
}

function validateRequiredFields(input: WorkspacePatchApplyInput): WorkspacePatchApplyFailure | undefined {
  if (!input.projectDir.trim()) return failure("missing_project_path", "projectPath is required.", [], []);
  if (!input.targetPath.trim()) return failure("missing_target_path", "targetPath is required.", [], []);
  if (input.beforeText === undefined) return failure("missing_before_text", "beforeText is required.", [], []);
  if (input.afterText === undefined) return failure("missing_after_text", "afterText is required.", [], []);
  if (!input.expectedBeforeHash.trim()) return failure("missing_expected_before_hash", "expectedBeforeHash is required.", [], []);
  if (!input.idempotencyKey.trim()) return failure("missing_idempotency_key", "idempotencyKey is required.", [], []);
  if (input.userConfirmed !== true) {
    return failure("missing_user_confirmation", "Workspace patch apply requires userConfirmed=true.", [], []);
  }
  return undefined;
}

function failure(
  code: WorkspacePatchApplyErrorCode,
  error: string,
  reasons: readonly string[],
  warnings: readonly string[],
): WorkspacePatchApplyFailure {
  return {
    ok: false,
    code,
    error,
    reasons,
    warnings,
  };
}

async function validateRuntimeTargetFile(input: {
  readonly projectDir: string;
  readonly targetPath: string;
  readonly targetFile: string;
}): Promise<{
  readonly ok: boolean;
  readonly code: "target_read_failed" | "target_disk_unsafe";
  readonly error: string;
  readonly reasons: readonly string[];
}> {
  const segmentSafety = await validateTargetSegments(input.projectDir, input.targetPath);
  if (!segmentSafety.ok) {
    return {
      ok: false,
      code: "target_disk_unsafe",
      error: "Target path segment is not safe for Workspace Patch Apply V0.",
      reasons: segmentSafety.reasons,
    };
  }

  const realContainment = await validateRealParentContainment(input.projectDir, input.targetFile);
  if (!realContainment.ok) {
    return {
      ok: false,
      code: "target_disk_unsafe",
      error: "Target real parent path is outside the project root.",
      reasons: realContainment.reasons,
    };
  }

  const targetInfo = await lstat(input.targetFile).catch(() => undefined);
  if (!targetInfo) {
    return {
      ok: false,
      code: "target_read_failed",
      error: "Target Markdown file does not exist.",
      reasons: [],
    };
  }
  if (!targetInfo.isFile()) {
    return {
      ok: false,
      code: "target_disk_unsafe",
      error: "Target path must be a regular non-symlink file.",
      reasons: ["target is not a regular non-symlink file."],
    };
  }
  return { ok: true, code: "target_read_failed", error: "", reasons: [] };
}

async function validateTargetSegments(projectDir: string, targetPath: string): Promise<{ readonly ok: boolean; readonly reasons: readonly string[] }> {
  const reasons: string[] = [];
  const segments = normalizeWorkspacePatchTargetPath(targetPath).split("/").filter(Boolean);
  let currentPath = resolve(projectDir);

  for (let index = 0; index < segments.length; index += 1) {
    currentPath = join(currentPath, segments[index]);
    const segmentInfo = await lstat(currentPath).catch(() => undefined);
    if (!segmentInfo) {
      if (index < segments.length - 1) {
        reasons.push(`${segments.slice(0, index + 1).join("/")} does not exist.`);
      }
      break;
    }
    if (segmentInfo.isSymbolicLink()) {
      reasons.push(`${segments.slice(0, index + 1).join("/")} is a symlink and cannot be a patch apply target segment.`);
      break;
    }
    if (index < segments.length - 1 && !segmentInfo.isDirectory()) {
      reasons.push(`${segments.slice(0, index + 1).join("/")} is not a directory.`);
      break;
    }
    if (index === segments.length - 1 && !segmentInfo.isFile()) {
      reasons.push(`${targetPath} is not a regular file.`);
      break;
    }
  }

  return { ok: reasons.length === 0, reasons };
}

async function validateRealParentContainment(projectDir: string, targetFile: string): Promise<{ readonly ok: boolean; readonly reasons: readonly string[] }> {
  const realProjectRoot = await realpath(projectDir).catch(() => undefined);
  if (!realProjectRoot) {
    return { ok: false, reasons: ["project root realpath could not be resolved."] };
  }

  const realTargetParent = await realpath(dirname(targetFile)).catch(() => undefined);
  if (!realTargetParent) {
    return { ok: false, reasons: ["target parent realpath could not be resolved."] };
  }

  const relativeParent = relative(realProjectRoot, realTargetParent);
  if (relativeParent === "" || (!relativeParent.startsWith("..") && !isAbsolute(relativeParent))) {
    return { ok: true, reasons: [] };
  }

  return { ok: false, reasons: ["target parent realpath escapes the project root."] };
}

async function validateTransactionRootSafety(input: {
  readonly projectDir: string;
  readonly transactionPath: string;
}): Promise<{ readonly ok: boolean; readonly reasons: readonly string[] }> {
  const realProjectRoot = await realpath(input.projectDir).catch(() => undefined);
  if (!realProjectRoot) {
    return { ok: false, reasons: ["project root realpath could not be resolved."] };
  }

  const transactionRoot = join(input.projectDir, ".story-engine-tx");
  const transactionParent = join(transactionRoot, "workspace-patches");
  const transactionDir = join(input.projectDir, input.transactionPath);
  const reasons: string[] = [];

  for (const candidate of [
    { path: transactionRoot, label: ".story-engine-tx" },
    { path: transactionParent, label: ".story-engine-tx/workspace-patches" },
    { path: transactionDir, label: input.transactionPath },
  ]) {
    const candidateInfo = await lstat(candidate.path).catch(() => undefined);
    if (!candidateInfo) continue;
    if (candidateInfo.isSymbolicLink()) {
      reasons.push(`${candidate.label} is a symlink and cannot be used for workspace patch transactions.`);
      continue;
    }
    if (!candidateInfo.isDirectory()) {
      reasons.push(`${candidate.label} is not a directory.`);
    }
  }

  for (const candidate of [
    { path: transactionRoot, label: ".story-engine-tx" },
    { path: transactionParent, label: ".story-engine-tx/workspace-patches" },
    { path: transactionDir, label: input.transactionPath },
  ]) {
    const realCandidate = await realpath(candidate.path).catch(() => undefined);
    if (!realCandidate) continue;
    const relativeCandidate = relative(realProjectRoot, realCandidate);
    if (relativeCandidate !== "" && (relativeCandidate.startsWith("..") || isAbsolute(relativeCandidate))) {
      reasons.push(`${candidate.label} realpath escapes the project root.`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}

async function ensureSafeTransactionDirectory(input: {
  readonly projectDir: string;
  readonly transactionPath: string;
}): Promise<{ readonly ok: boolean; readonly reasons: readonly string[] }> {
  const transactionRoot = join(input.projectDir, ".story-engine-tx");
  const transactionParent = join(transactionRoot, "workspace-patches");
  const transactionDir = join(input.projectDir, input.transactionPath);

  for (const directory of [transactionRoot, transactionParent, transactionDir]) {
    const beforeCreate = await validateTransactionRootSafety(input);
    if (!beforeCreate.ok) return beforeCreate;
    await mkdirIfMissing(directory);
    const afterCreate = await validateTransactionRootSafety(input);
    if (!afterCreate.ok) return afterCreate;
  }

  return validateTransactionRootSafety(input);
}

async function mkdirIfMissing(directory: string): Promise<void> {
  try {
    await mkdir(directory);
  } catch (error) {
    if ((error as { readonly code?: string }).code !== "EEXIST") throw error;
  }
}

async function checkIdempotency(input: {
  readonly transactionDir: string;
  readonly idempotencyKey: string;
  readonly targetPath: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly patchId: string;
}): Promise<{
  readonly blockedCode?: "transaction_file_unsafe";
  readonly error: string;
  readonly conflict: boolean;
  readonly reasons: readonly string[];
  readonly result?: WorkspacePatchApplySuccess;
}> {
  const transactionInfo = await lstat(input.transactionDir).catch(() => undefined);
  if (!transactionInfo) return { conflict: false, error: "", reasons: [] };

  const manifestPath = join(input.transactionDir, "manifest.json");
  const manifestInfo = await lstat(manifestPath).catch(() => undefined);
  if (!manifestInfo) return { conflict: false, error: "", reasons: [] };
  if (manifestInfo.isSymbolicLink()) {
    return {
      blockedCode: "transaction_file_unsafe",
      error: "Workspace patch transaction manifest is unsafe.",
      conflict: false,
      reasons: ["manifest.json is a symlink and cannot be used for workspace patch idempotency replay."],
    };
  }
  if (!manifestInfo.isFile()) {
    return {
      blockedCode: "transaction_file_unsafe",
      error: "Workspace patch transaction manifest is unsafe.",
      conflict: false,
      reasons: ["manifest.json is not a regular file."],
    };
  }

  const manifest = await readManifest(input.transactionDir);
  if (!manifest) {
    return {
      conflict: true,
      error: "",
      reasons: ["existing transaction manifest is not a valid applied workspace patch manifest."],
    };
  }

  const matching = manifest.idempotencyKey === input.idempotencyKey
    && manifest.targetPath === input.targetPath
    && manifest.beforeHash === input.beforeHash
    && manifest.afterHash === input.afterHash
    && manifest.patchId === input.patchId
    && manifest.status === "applied";
  if (!matching) {
    return {
      conflict: true,
      error: "",
      reasons: ["existing transaction manifest does not match the new request payload."],
    };
  }

  return {
    conflict: false,
    error: "",
    reasons: [],
    result: {
      ok: true,
      patchApplyTxId: manifest.patchApplyTxId,
      targetPath: manifest.targetPath,
      documentType: manifest.documentType,
      beforeHash: manifest.beforeHash,
      afterHash: manifest.afterHash,
      changeSummary: await readFile(join(input.transactionDir, "change-summary.md"), "utf-8").catch(() => ""),
      changedFiles: manifest.changedFiles,
      rollbackAvailable: manifest.rollbackAvailable,
      rollbackNote: manifest.rollbackNote ?? WORKSPACE_PATCH_ROLLBACK_NOTE,
      ...WORKSPACE_PATCH_SUCCESS_SAFETY_FIELDS,
      warnings: [],
      transactionPath: manifest.transactionPath,
    },
  };
}

async function readManifest(transactionDir: string): Promise<WorkspacePatchApplyManifest | undefined> {
  const raw = await readFile(join(transactionDir, "manifest.json"), "utf-8").catch(() => undefined);
  if (!raw) return undefined;
  let parsed: Partial<WorkspacePatchApplyManifest>;
  try {
    parsed = JSON.parse(raw) as Partial<WorkspacePatchApplyManifest>;
  } catch {
    return undefined;
  }
  if (parsed.version !== "workspace-patch-apply-v0" || !parsed.patchApplyTxId || !parsed.targetPath) return undefined;
  return parsed as WorkspacePatchApplyManifest;
}

async function validateNewTransactionDirectoryForWrite(transactionDir: string): Promise<{
  readonly ok: true;
} | {
  readonly ok: false;
  readonly code: "idempotency_key_conflict" | "transaction_file_unsafe";
  readonly reasons: readonly string[];
}> {
  const transactionInfo = await lstat(transactionDir).catch(() => undefined);
  if (!transactionInfo) return { ok: true };

  const outputSafety = await validateTransactionOutputFilesAvailable(transactionDir);
  if (!outputSafety.ok) {
    return { ok: false, code: "transaction_file_unsafe", reasons: outputSafety.reasons };
  }

  return {
    ok: false,
    code: "idempotency_key_conflict",
    reasons: ["existing transaction directory does not contain a replayable applied manifest."],
  };
}

async function validateTransactionOutputFilesAvailable(transactionDir: string): Promise<{
  readonly ok: boolean;
  readonly reasons: readonly string[];
}> {
  const reasons: string[] = [];
  for (const fileName of ["before.md", "after.md", "change-summary.md", "manifest.json"]) {
    const outputPath = join(transactionDir, fileName);
    const outputInfo = await lstat(outputPath).catch(() => undefined);
    if (!outputInfo) continue;
    if (outputInfo.isSymbolicLink()) {
      reasons.push(`${fileName} is a symlink and cannot be overwritten by workspace patch apply.`);
      continue;
    }
    reasons.push(`${fileName} already exists and cannot be overwritten by a new workspace patch transaction.`);
  }
  return { ok: reasons.length === 0, reasons };
}

async function writeTransactionFiles(
  transactionDir: string,
  manifestBase: Omit<WorkspacePatchApplyManifest, "status" | "appliedAt" | "error">,
  status: WorkspacePatchApplyManifest["status"],
  beforeText: string,
  afterText: string,
  changeSummary: string,
): Promise<void> {
  await writeExclusiveTransactionFile(join(transactionDir, "before.md"), beforeText);
  await writeExclusiveTransactionFile(join(transactionDir, "after.md"), afterText);
  await writeExclusiveTransactionFile(join(transactionDir, "change-summary.md"), changeSummary);
  await writeManifest(transactionDir, { ...manifestBase, status });
}

async function writeExclusiveTransactionFile(filePath: string, content: string): Promise<void> {
  const fileInfo = await lstat(filePath).catch(() => undefined);
  if (fileInfo) {
    throw new Error(`${filePath} already exists and cannot be overwritten.`);
  }
  await writeFile(filePath, content, { encoding: "utf-8", flag: "wx" });
}

async function writeManifest(
  transactionDir: string,
  manifest: WorkspacePatchApplyManifest,
  options: { readonly replaceExisting?: boolean } = {},
): Promise<void> {
  const manifestPath = join(transactionDir, "manifest.json");
  const manifestInfo = await lstat(manifestPath).catch(() => undefined);
  if (manifestInfo?.isSymbolicLink()) {
    throw new Error("manifest.json is a symlink and cannot be used for workspace patch apply.");
  }
  if (manifestInfo && !manifestInfo.isFile()) {
    throw new Error("manifest.json is not a regular file.");
  }
  if (manifestInfo && options.replaceExisting !== true) {
    throw new Error("manifest.json already exists and cannot be overwritten by a new workspace patch transaction.");
  }

  const tempManifestPath = join(transactionDir, `manifest.${manifest.status}.${manifest.patchApplyTxId}.tmp`);
  await writeExclusiveTransactionFile(tempManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(tempManifestPath, manifestPath);
}

async function validateTempFileAvailable(tempFile: string): Promise<{ readonly ok: boolean; readonly reasons: readonly string[] }> {
  const tempInfo = await lstat(tempFile).catch(() => undefined);
  if (!tempInfo) return { ok: true, reasons: [] };
  if (tempInfo.isSymbolicLink()) {
    return { ok: false, reasons: ["temp file is a symlink and cannot be used for workspace patch apply."] };
  }
  return { ok: false, reasons: ["temp file already exists and cannot be overwritten by Workspace Patch Apply V0."] };
}

async function validateWrittenTempFile(tempFile: string): Promise<{ readonly ok: boolean; readonly reasons: readonly string[] }> {
  const tempInfo = await lstat(tempFile).catch(() => undefined);
  if (!tempInfo) return { ok: false, reasons: ["temp file was not created."] };
  if (tempInfo.isSymbolicLink()) {
    return { ok: false, reasons: ["temp file became a symlink before rename."] };
  }
  if (!tempInfo.isFile()) {
    return { ok: false, reasons: ["temp file is not a regular file before rename."] };
  }
  return { ok: true, reasons: [] };
}

async function validateFinalTempFileBeforeRename(
  tempFile: string,
  expectedAfterHash: string,
): Promise<{ readonly ok: boolean; readonly reasons: readonly string[] }> {
  const tempSafety = await validateWrittenTempFile(tempFile);
  if (!tempSafety.ok) return tempSafety;

  const tempContent = await readFile(tempFile, "utf-8").catch(() => undefined);
  if (tempContent === undefined) {
    return { ok: false, reasons: ["temp file could not be read before rename."] };
  }
  if (sha256(tempContent) !== expectedAfterHash) {
    return { ok: false, reasons: ["temp file content hash does not match afterText hash."] };
  }
  return { ok: true, reasons: [] };
}

async function cleanupTempFile(tempFile: string): Promise<readonly string[]> {
  const tempInfo = await lstat(tempFile).catch(() => undefined);
  if (!tempInfo) return [];
  if (tempInfo.isSymbolicLink() || !tempInfo.isFile()) {
    return ["temp cleanup skipped because file is not a regular temp file."];
  }

  try {
    await unlink(tempFile);
    return [];
  } catch (error) {
    return [`temp_cleanup_failed: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function buildChangeSummary(input: {
  readonly targetPath: string;
  readonly documentType: MarkdownWorkspaceDocumentType;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly patchId: string;
  readonly diffText: string;
}): string {
  return [
    "# Workspace Patch Apply V0 Change Summary",
    "",
    `- Target: ${input.targetPath}`,
    `- Document type: ${input.documentType}`,
    `- Patch id: ${input.patchId}`,
    `- Before hash: ${input.beforeHash}`,
    `- After hash: ${input.afterHash}`,
    "- Changed files:",
    `  - ${input.targetPath}`,
    "",
    "## Safety",
    "",
    "- This is a Markdown Workspace edit, not Formal Commit apply.",
    "- No state JSON was written.",
    "- No memory was written.",
    "- Formal Commit was not called.",
    "- Rollback is metadata-backed only; UI undo is not yet implemented.",
    "",
    "## Diff",
    "",
    "```diff",
    input.diffText,
    "```",
    "",
  ].join("\n");
}

function sanitizeTempName(path: string): string {
  return normalizeWorkspacePatchTargetPath(path).split("/").at(-1)?.replace(/[^a-zA-Z0-9._-]/gu, "-") || "workspace-patch";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}
