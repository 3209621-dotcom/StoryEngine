/**
 * GET /api/health — 运行环境健康探针（桌面前置·任务①）。
 *
 * 当前只探一件事：系统 git 是否可用。快照/撤销链路（snapshot.ts）吃系统 git，
 * Windows 测试者大概率没装——缺 git 不阻塞启动（写作照常），但前端要亮黄条提示
 * 「快照与撤销不可用」，别让用户以为有后悔药实际没有（绝不静默降级）。
 * 探测结果进程内缓存（探一次贵在 spawn，git 可用性运行期不会变）。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { resolveGitCommand } from "../lib/data-dirs.js";
import { writeJson, type MiddlewareStack } from "../lib/project-io.js";

const execFileAsync = promisify(execFile);

let cachedGitAvailable: boolean | undefined;

export async function probeGitAvailable(): Promise<boolean> {
  if (cachedGitAvailable !== undefined) return cachedGitAvailable;
  try {
    await execFileAsync(resolveGitCommand(), ["--version"], { timeout: 5000 });
    cachedGitAvailable = true;
  } catch {
    cachedGitAvailable = false;
  }
  return cachedGitAvailable;
}

/** 仅测试用：重置探测缓存。 */
export function resetGitProbeCacheForTest(value?: boolean): void {
  cachedGitAvailable = value;
}

export function registerHealthRoutes(middlewares: MiddlewareStack): void {
  middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/api/health")) {
      next();
      return;
    }
    if (req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "Only GET is supported." });
      return;
    }
    const gitAvailable = await probeGitAvailable();
    writeJson(res, 200, { ok: true, gitAvailable });
  });
}
