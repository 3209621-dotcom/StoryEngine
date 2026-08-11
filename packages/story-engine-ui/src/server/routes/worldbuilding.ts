/**
 * GET /api/worldbuilding?project=... — 读项目的厚版世界观结构（.story-engine-ui/worldbuilding.json）。
 * 由 generate_worldbuilding 工具落盘，前端 WorldbuildingCodexPanel 据此渲染卡片/关系网。
 * 文件不存在（还没生成过）→ ok:true, worldbuilding:null（不是错误）。
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

export function registerWorldbuildingRoutes(middlewares: MiddlewareStack): void {
  middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/api/worldbuilding")) {
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

      let worldbuilding: unknown = null;
      try {
        const raw = await readFile(join(projectDir, ".story-engine-ui", "worldbuilding.json"), "utf-8");
        worldbuilding = JSON.parse(raw);
      } catch {
        // 还没生成过 → null
      }
      writeJson(res, 200, { ok: true, worldbuilding });
    } catch (error) {
      writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
