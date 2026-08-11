/**
 * POST /api/chapter-steering — generates a steering draft for the next chapter.
 */
import { buildChapterSteeringDraft } from "@actalk/story-engine";
import {
  guardProjectPath,
  readJsonBody,
  readPacing,
  readRevealLevel,
  readString,
  readStringList,
  readPositiveInteger,
  writeJson,
  type MiddlewareStack,
} from "../lib/project-io.js";

export function registerChapterSteeringRoutes(middlewares: MiddlewareStack): void {
  middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/api/chapter-steering")) {
      next();
      return;
    }

    try {
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "Only POST is supported." });
        return;
      }

      const body = await readJsonBody(req);
      const projectDir = readString(body.projectPath);
      const userDirection = readString(body.userDirection);
      if (!projectDir) {
        writeJson(res, 400, { ok: false, error: "Project path is required." });
        return;
      }
      if (!guardProjectPath(res, projectDir)) return;
      if (!userDirection) {
        writeJson(res, 400, { ok: false, error: "下一章方向不能为空。" });
        return;
      }

      const chapter = readPositiveInteger(body.chapter);
      const maxSuggestions = readPositiveInteger(body.maxSuggestions);
      const pacing = readPacing(body.pacing);
      const revealLevel = readRevealLevel(body.revealLevel);
      const draft = await buildChapterSteeringDraft({
        projectDir,
        userDirection,
        ...(chapter !== undefined ? { chapter } : {}),
        ...(maxSuggestions !== undefined ? { maxSuggestions } : {}),
        ...(pacing !== undefined ? { pacing } : {}),
        ...(revealLevel !== undefined ? { revealLevel } : {}),
        mustInclude: readStringList(body.mustInclude),
        mustAvoid: readStringList(body.mustAvoid),
      });

      writeJson(res, 200, { ok: true, draft });
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
