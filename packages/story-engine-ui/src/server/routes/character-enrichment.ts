/**
 * GET /api/character-enrichment?project=... — 读项目的角色做厚结构（.story-engine-ui/character-enrichment.json）。
 * 由 generate_character_enrichment 工具落盘，CharacterCodexPanel 据此填充三层人格 / 成长弧 / 情绪外露 / 日常锚点。
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

export function registerCharacterEnrichmentRoutes(middlewares: MiddlewareStack): void {
  middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/api/character-enrichment")) {
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
        const raw = await readFile(join(projectDir, ".story-engine-ui", "character-enrichment.json"), "utf-8");
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
