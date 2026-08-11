/**
 * GET /api/matrix-enrichment?project=... — 读项目的角色矩阵做厚结构（.story-engine-ui/matrix-enrichment.json）。
 * 由 generate_matrix_enrichment 工具落盘，CharacterMatrixCodexPanel 据此填充叙事岗位（matrixOverrides）
 * 与关系账本厚字段（relationshipExtras）。文件不存在（还没做过厚）→ ok:true, enrichment:null（不是错误）。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertStoryEngineProject,
  guardProjectPath,
  requireBodyString,
  writeJson,
  type MiddlewareStack,
} from "../lib/project-io.js";

export function registerMatrixEnrichmentRoutes(middlewares: MiddlewareStack): void {
  middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/api/matrix-enrichment")) {
      next();
      return;
    }
    try {
      if (req.method !== "GET") {
        writeJson(res, 405, { ok: false, error: "Only GET is supported." });
        return;
      }
      const url = new URL(req.url ?? "", "http://localhost");
      const projectDir = requireBodyString(url.searchParams.get("project"), "项目路径不能为空。");
      if (!guardProjectPath(res, projectDir)) return;
      await assertStoryEngineProject(projectDir);

      let enrichment: unknown = null;
      try {
        const raw = await readFile(join(projectDir, ".story-engine-ui", "matrix-enrichment.json"), "utf-8");
        enrichment = JSON.parse(raw);
      } catch {
        // 还没做过厚 → null
      }
      writeJson(res, 200, { ok: true, enrichment });
    } catch (error) {
      writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
