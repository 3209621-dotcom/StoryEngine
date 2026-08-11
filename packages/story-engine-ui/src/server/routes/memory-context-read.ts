/**
 * POST /api/memory/context/read - read-only memory context adapter route.
 */
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import {
  assertStoryEngineProject,
  isRecord,
  isSafeProjectPath,
  readJsonBody,
  readNumber,
  readString,
  writeJson,
  type MiddlewareStack,
} from "../lib/project-io.js";
import {
  loadMemoryContextRuntimeAdapter,
  type MemoryContextRuntimeAdapterResult,
} from "../../agent-command-center/memory-context-runtime-adapter.js";
import type { MemoryReadRuntimeLimits } from "../../agent-command-center/memory-read-runtime.js";

type RouteStatus = MemoryContextRuntimeAdapterResult["status"];

type MemoryContextReadRoutePayload = {
  readonly ok: boolean;
  readonly status: RouteStatus;
  readonly viewModel: MemoryContextRuntimeAdapterResult["viewModel"];
  readonly warnings: readonly string[];
  readonly blockingReasons: readonly string[];
  readonly normalizedPath: string;
  readonly readOnly: true;
  readonly canWrite: false;
  readonly canInjectAutomatically: false;
  readonly didReadFile: boolean;
  readonly didWriteMemory: false;
  readonly didInjectAutomatically: false;
  readonly requestId?: string;
  readonly safety: {
    readonly noStateJsonWrite: true;
    readonly noMemoryWrite: true;
    readonly noMarkdownWrite: true;
    readonly noFormalCommit: true;
    readonly noPromptInjection: true;
    readonly noConfirmApplyEffect: true;
  };
};

const ROUTE_PATH = "/api/memory/context/read";
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/u;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\/u;

export function registerMemoryContextReadRoutes(middlewares: MiddlewareStack): void {
  middlewares.use(async (req, res, next) => {
    if (!isExactMemoryContextReadRoute(req.url)) {
      next();
      return;
    }

    if (req.method !== "POST") {
      writeJson(res, 405, {
        ok: false,
        code: "method_not_allowed",
        error: "Only POST is supported.",
      });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      writeJson(res, 400, routePayload({
        status: "failed",
        viewModel: null,
        warnings: [`malformed JSON body: ${errorMessage(error)}`],
        blockingReasons: [],
        normalizedPath: "",
        didReadFile: false,
      }));
      return;
    }

    try {
      const requestId = readString(body.requestId);
      const projectRoot = readString(body.projectPath) ?? readString(body.projectRoot);
      if (!projectRoot) {
        writeJson(res, 400, routePayload({
          status: "blocked",
          viewModel: null,
          warnings: [],
          blockingReasons: ["project path is required."],
          normalizedPath: "",
          didReadFile: false,
          requestId,
        }));
        return;
      }

      if (!isSafeProjectPath(projectRoot)) {
        writeJson(res, 400, routePayload({
          status: "blocked",
          viewModel: null,
          warnings: [],
          blockingReasons: ["project path blocked by project path guard."],
          normalizedPath: "",
          didReadFile: false,
          requestId,
        }));
        return;
      }

      const routeProjectRootSafety = await validateMemoryContextReadProjectRoot(projectRoot);
      if (!routeProjectRootSafety.allowed) {
        writeJson(res, 400, routePayload({
          status: "blocked",
          viewModel: null,
          warnings: [],
          blockingReasons: routeProjectRootSafety.blockingReasons,
          normalizedPath: "",
          didReadFile: false,
          requestId,
        }));
        return;
      }

      try {
        await assertStoryEngineProject(routeProjectRootSafety.realProjectRoot);
      } catch (error) {
        writeJson(res, 400, routePayload({
          status: "blocked",
          viewModel: null,
          warnings: [],
          blockingReasons: [`StoryEngine project guard blocked: ${errorMessage(error)}`],
          normalizedPath: "",
          didReadFile: false,
          requestId,
        }));
        return;
      }

      const memoryTargetPath = readString(body.memoryTargetPath);
      if (!memoryTargetPath) {
        writeJson(res, 400, routePayload({
          status: "blocked",
          viewModel: null,
          warnings: [],
          blockingReasons: ["memoryTargetPath is required."],
          normalizedPath: "",
          didReadFile: false,
          requestId,
        }));
        return;
      }

      if (isAbsoluteMemoryTargetPath(memoryTargetPath)) {
        writeJson(res, 400, routePayload({
          status: "blocked",
          viewModel: null,
          warnings: [],
          blockingReasons: ["absolute memoryTargetPath is blocked at the route boundary."],
          normalizedPath: "",
          didReadFile: false,
          requestId,
        }));
        return;
      }

      const adapterResult = await loadMemoryContextRuntimeAdapter({
        projectRoot: routeProjectRootSafety.realProjectRoot,
        memoryTargetPath,
        limits: readLimits(body.limits),
        displayContext: {
          requestId,
        },
      });

      writeJson(res, 200, routePayload({
        status: adapterResult.status,
        viewModel: adapterResult.viewModel,
        warnings: adapterResult.warnings,
        blockingReasons: adapterResult.blockingReasons,
        normalizedPath: adapterResult.normalizedPath,
        didReadFile: adapterResult.didReadFile,
        requestId,
      }));
    } catch (error) {
      writeJson(res, 500, routePayload({
        status: "failed",
        viewModel: null,
        warnings: [`memory context route failed: ${errorMessage(error)}`],
        blockingReasons: [],
        normalizedPath: "",
        didReadFile: false,
      }));
    }
  });
}

function readLimits(value: unknown): Partial<MemoryReadRuntimeLimits> | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...(readNumber(value.maxFileBytes) !== undefined ? { maxFileBytes: readNumber(value.maxFileBytes) } : {}),
    ...(readNumber(value.maxMemoryItems) !== undefined ? { maxMemoryItems: readNumber(value.maxMemoryItems) } : {}),
    ...(readNumber(value.maxTextLengthPerItem) !== undefined
      ? { maxTextLengthPerItem: readNumber(value.maxTextLengthPerItem) }
      : {}),
  };
}

function routePayload(input: {
  readonly status: RouteStatus;
  readonly viewModel: MemoryContextRuntimeAdapterResult["viewModel"];
  readonly warnings: readonly string[];
  readonly blockingReasons: readonly string[];
  readonly normalizedPath: string;
  readonly didReadFile: boolean;
  readonly requestId?: string;
}): MemoryContextReadRoutePayload {
  return {
    ok: input.status === "ready" || input.status === "warning",
    status: input.status,
    viewModel: input.viewModel,
    warnings: input.warnings,
    blockingReasons: input.blockingReasons,
    normalizedPath: input.normalizedPath,
    readOnly: true,
    canWrite: false,
    canInjectAutomatically: false,
    didReadFile: input.didReadFile,
    didWriteMemory: false,
    didInjectAutomatically: false,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    safety: {
      noStateJsonWrite: true,
      noMemoryWrite: true,
      noMarkdownWrite: true,
      noFormalCommit: true,
      noPromptInjection: true,
      noConfirmApplyEffect: true,
    },
  };
}

function isExactMemoryContextReadRoute(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url, "http://localhost").pathname === ROUTE_PATH;
  } catch {
    return false;
  }
}

async function validateMemoryContextReadProjectRoot(projectRoot: string): Promise<
  | {
      readonly allowed: true;
      readonly realProjectRoot: string;
    }
  | {
      readonly allowed: false;
      readonly blockingReasons: readonly string[];
    }
> {
  const resolvedProjectRoot = resolve(projectRoot);
  try {
    const projectRootInfo = await lstat(resolvedProjectRoot);
    if (projectRootInfo.isSymbolicLink()) {
      return {
        allowed: false,
        blockingReasons: ["project root symlink is blocked before StoryEngine project validation."],
      };
    }

    const realProjectRoot = await realpath(resolvedProjectRoot);
    if (!isSafeProjectPath(realProjectRoot) || !isPathInsideOrSame(resolve(homedir()), realProjectRoot)) {
      return {
        allowed: false,
        blockingReasons: ["project root realpath is outside allowed home containment."],
      };
    }

    return { allowed: true, realProjectRoot };
  } catch (error) {
    return {
      allowed: false,
      blockingReasons: [`project root disk guard failed: ${errorMessage(error)}`],
    };
  }
}

function isPathInsideOrSame(root: string, target: string): boolean {
  const relation = relative(root, target);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function isAbsoluteMemoryTargetPath(memoryTargetPath: string): boolean {
  return (
    isAbsolute(memoryTargetPath) ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(memoryTargetPath) ||
    WINDOWS_UNC_PATH_PATTERN.test(memoryTargetPath)
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
