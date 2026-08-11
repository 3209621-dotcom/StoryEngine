/**
 * POST /api/workspace-patch/apply — server-authoritative tiny Markdown patch apply.
 */
import {
  assertStoryEngineProject,
  guardProjectPath,
  readJsonBody,
  readString,
  readStringAllowEmpty,
  writeJson,
  type MiddlewareStack,
} from "../lib/project-io.js";
import {
  applyWorkspacePatch,
  validateWorkspacePatchTransactionRoot,
  type WorkspacePatchApplyErrorCode,
  type WorkspacePatchApplyInput,
} from "../lib/workspace-patch-apply.js";
import { createSnapshot } from "../lib/snapshot.js";

export function registerWorkspacePatchApplyRoutes(middlewares: MiddlewareStack): void {
  middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/api/workspace-patch/apply")) {
      next();
      return;
    }

    if (req.method !== "POST") {
      writeJson(res, 405, { ok: false, code: "method_not_allowed", error: "Only POST is supported." });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const projectDir = readString(body.projectPath);
      if (!projectDir) {
        writeJson(res, 400, { ok: false, code: "missing_project_path", error: "projectPath is required." });
        return;
      }
      if (!guardProjectPath(res, projectDir)) return;
      await assertStoryEngineProject(projectDir);

      const inputResult = readWorkspacePatchApplyInput(body, projectDir);
      if (!inputResult.ok) {
        writeJson(res, 400, {
          ok: false,
          code: inputResult.code,
          error: inputResult.error,
          reasons: [],
          warnings: [],
        });
        return;
      }

      const transactionRoot = await validateWorkspacePatchTransactionRoot(inputResult.input);
      if (!transactionRoot.ok) {
        writeTransactionRootUnsafe(res, transactionRoot.reasons);
        return;
      }

      try {
        await createSnapshot(projectDir, "工作区补丁前快照");
      } catch (error) {
        // Recovery runs inside createSnapshot. If the transaction root changed
        // after the first guard, preserve the route's structured safety
        // contract instead of collapsing the refusal into a generic 500.
        const currentTransactionRoot = await validateWorkspacePatchTransactionRoot(inputResult.input);
        if (!currentTransactionRoot.ok) {
          writeTransactionRootUnsafe(res, currentTransactionRoot.reasons);
          return;
        }
        throw error;
      }
      const result = await applyWorkspacePatch(inputResult.input);
      writeJson(res, result.ok ? 200 : statusForWorkspacePatchApplyError(result.code), { ...result });
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        code: "workspace_patch_apply_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function writeTransactionRootUnsafe(res: Parameters<typeof writeJson>[0], reasons: readonly string[]): void {
  writeJson(res, 403, {
    ok: false,
    code: "transaction_root_unsafe",
    error: "Workspace patch transaction root is unsafe.",
    reasons,
    warnings: [],
  });
}

function readWorkspacePatchApplyInput(body: Record<string, unknown>, projectDir: string): {
  readonly ok: true;
  readonly input: WorkspacePatchApplyInput;
} | {
  readonly ok: false;
  readonly code: WorkspacePatchApplyErrorCode;
  readonly error: string;
} {
  const targetPath = readString(body.targetPath);
  if (!targetPath) return { ok: false, code: "missing_target_path", error: "targetPath is required." };

  const beforeText = readStringAllowEmpty(body.beforeText);
  if (beforeText === undefined) return { ok: false, code: "missing_before_text", error: "beforeText is required." };

  const afterText = readStringAllowEmpty(body.afterText);
  if (afterText === undefined) return { ok: false, code: "missing_after_text", error: "afterText is required." };

  const expectedBeforeHash = readString(body.expectedBeforeHash);
  if (!expectedBeforeHash) {
    return { ok: false, code: "missing_expected_before_hash", error: "expectedBeforeHash is required." };
  }

  const idempotencyKey = readString(body.idempotencyKey);
  if (!idempotencyKey) return { ok: false, code: "missing_idempotency_key", error: "idempotencyKey is required." };

  const patchId = readString(body.patchId) ?? readString(body.previewId);
  if (!patchId) return { ok: false, code: "missing_patch_id", error: "patchId or previewId is required." };

  if (body.userConfirmed !== true) {
    return { ok: false, code: "missing_user_confirmation", error: "userConfirmed=true is required." };
  }

  return {
    ok: true,
    input: {
      projectDir,
      targetPath,
      beforeText,
      afterText,
      patchId,
      expectedBeforeHash,
      userConfirmed: true,
      idempotencyKey,
    },
  };
}

function statusForWorkspacePatchApplyError(code: WorkspacePatchApplyErrorCode): number {
  if (
    code === "missing_project_path"
    || code === "missing_target_path"
    || code === "missing_expected_before_hash"
    || code === "missing_idempotency_key"
    || code === "missing_before_text"
    || code === "missing_after_text"
    || code === "missing_patch_id"
    || code === "missing_user_confirmation"
    || code === "path_safety_failed"
  ) {
    return 400;
  }
  if (
    code === "target_not_allowed_v0"
    || code === "target_disk_unsafe"
    || code === "transaction_root_unsafe"
    || code === "transaction_file_unsafe"
    || code === "temp_file_unsafe"
  ) {
    return 403;
  }
  if (code === "write_failed") return 500;
  return 409;
}
