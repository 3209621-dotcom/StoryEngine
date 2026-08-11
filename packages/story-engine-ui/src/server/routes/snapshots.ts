/**
 * GET /api/snapshots?project=<dir> — list snapshot history newest-first.
 * POST /api/snapshots/restore — restore project to a snapshot.
 */
import {
  readJsonBody,
  guardProjectPath,
  requireBodyString,
  assertStoryEngineProject,
  writeJson,
  type MiddlewareStack,
} from "../lib/project-io.js";
import { humanizeUndoLabel, isPostWriteSettlementSnapshot, listSnapshots, restoreSnapshot } from "../lib/snapshot.js";

// ---------------------------------------------------------------------------
// Route registrar
// ---------------------------------------------------------------------------

export function registerSnapshotsRoutes(middlewares: MiddlewareStack): void {
  middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/api/snapshots")) {
      next();
      return;
    }

    try {
      const url = new URL(req.url ?? "", "http://localhost");

      if (req.method === "GET" && url.pathname === "/api/snapshots") {
        const projectDir = requireBodyString(url.searchParams.get("project"), "项目路径不能为空。");
        if (!guardProjectPath(res, projectDir)) return;
        await assertStoryEngineProject(projectDir);
        // 在路由边界把 label 人话化（agent:commit_apply → 入库）；不下沉到 listSnapshots——
        // undoLastChange 依赖原始 label 做 isRestoreArtifact/^agent: 匹配，提前 humanize 会破坏它。
        // 过滤掉「落盘收尾」工程 commit（afterfix #2）：它只为把写产物收进 git、让工作树干净，不是用户动作，
        // 不该出现在操作历史里（否则每个写操作多一条无意义条目）。
        const raw = (await listSnapshots(projectDir)).filter((s) => !isPostWriteSettlementSnapshot(s.label));
        const snapshots = raw.map((s) => ({ ...s, label: humanizeUndoLabel(s.label) }));
        writeJson(res, 200, { ok: true, snapshots });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/snapshots/restore") {
        const body = await readJsonBody(req);
        const projectDir = requireBodyString(body.projectPath, "项目路径不能为空。");
        if (!guardProjectPath(res, projectDir)) return;
        await assertStoryEngineProject(projectDir);
        const id = requireBodyString(body.id, "快照 id 不能为空。");
        const restored = await restoreSnapshot(projectDir, id);
        writeJson(res, 200, { ok: true, restored });
        return;
      }

      writeJson(res, 405, { ok: false, error: "Unsupported snapshots endpoint." });
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
