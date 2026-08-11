/**
 * GET /api/location-enrichment?project=... — 读项目的地点做厚结构（.story-engine-ui/location-enrichment.json）。
 * 由 generate_location_enrichment 工具落盘，LocationCodexPanel 据此填充表面印象 / 进入限制 / 离开代价 /
 * 关联势力 / 状态标签（按地点名为键的 byLocation Record，面板按 location.locations 顺序映射成数组）。
 * 文件不存在（还没做过厚）→ ok:true, enrichment:null（不是错误）。
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

export function registerLocationEnrichmentRoutes(middlewares: MiddlewareStack): void {
  middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/api/location-enrichment")) {
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
        const raw = await readFile(join(projectDir, ".story-engine-ui", "location-enrichment.json"), "utf-8");
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
