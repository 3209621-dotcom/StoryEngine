/**
 * GET /api/foreshadowing-overrides?project=... — 读项目的伏笔大小覆盖表
 * （.story-engine-ui/foreshadowing-overrides.json）。
 * 由 set_foreshadowing_importance 工具落盘，面板展示时 shownSize = override ?? 引擎派生的 size。
 * 文件不存在（从未覆盖过）→ ok:true, overrides:{}（不是错误）。
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

export function registerForeshadowingOverridesRoutes(middlewares: MiddlewareStack): void {
  middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/api/foreshadowing-overrides")) {
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

      let overrides: Record<string, string> = {};
      try {
        const raw = await readFile(join(projectDir, ".story-engine-ui", "foreshadowing-overrides.json"), "utf-8");
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          overrides = parsed as Record<string, string>;
        }
      } catch {
        // 还没写过覆盖 → 空表
      }
      writeJson(res, 200, { ok: true, overrides });
    } catch (error) {
      writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
