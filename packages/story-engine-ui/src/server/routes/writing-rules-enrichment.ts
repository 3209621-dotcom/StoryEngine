/**
 * GET /api/writing-rules-enrichment?project=... — 读项目的写作规则做厚结构
 * （.story-engine-ui/writing-rules-enrichment.json）。由 generate_writing_rules_enrichment 工具落盘，
 * WritingRulesCodexPanel 据此填充风格特征指纹（fingerprints）与反 AI 写作规则（antiRules）。
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

export function registerWritingRulesEnrichmentRoutes(middlewares: MiddlewareStack): void {
  middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/api/writing-rules-enrichment")) {
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
        const raw = await readFile(join(projectDir, ".story-engine-ui", "writing-rules-enrichment.json"), "utf-8");
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
