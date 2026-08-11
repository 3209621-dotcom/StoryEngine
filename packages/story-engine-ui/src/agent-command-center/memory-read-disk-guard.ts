import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  normalizeMemoryReadPath,
  preflightMemoryReadPath,
  type MemoryReadPathSafetyInput,
  type MemoryReadPathTargetRole,
} from "./memory-read-path-safety.js";

export type MemoryReadDiskGuardTargetRole =
  | MemoryReadPathTargetRole
  | "blocked_project_root_symlink"
  | "blocked_memory_ancestor_symlink"
  | "blocked_target_symlink"
  | "blocked_target_realpath_outside_project"
  | "blocked_target_directory"
  | "blocked_non_regular_file"
  | "blocked_disk_check_failed";

export interface MemoryReadDiskGuardResult {
  readonly allowed: boolean;
  readonly normalizedPath: string;
  readonly realProjectRoot: string | null;
  readonly realTargetPath: string | null;
  readonly targetRole: MemoryReadDiskGuardTargetRole;
  readonly blockingReasons: readonly string[];
  readonly isRegularFile: boolean;
  readonly symlinkBlocked: boolean;
  readonly willReadFile: false;
  readonly willWriteMemory: false;
  readonly willInjectAutomatically: false;
}

export async function guardMemoryReadDiskPath(input: MemoryReadPathSafetyInput): Promise<MemoryReadDiskGuardResult> {
  const preflight = preflightMemoryReadPath(input);
  if (!preflight.allowed) {
    return blocked({
      normalizedPath: preflight.normalizedPath,
      realProjectRoot: null,
      realTargetPath: null,
      targetRole: preflight.targetRole,
      blockingReasons: preflight.blockingReasons,
      isRegularFile: false,
      symlinkBlocked: false,
    });
  }

  const projectRootPath = resolve(input.projectRoot);
  const targetPath = resolve(projectRootPath, preflight.normalizedPath);

  try {
    const projectRootStat = await lstat(projectRootPath);
    const realProjectRoot = await realpath(projectRootPath);

    if (projectRootStat.isSymbolicLink()) {
      return blocked({
        normalizedPath: preflight.normalizedPath,
        realProjectRoot,
        realTargetPath: null,
        targetRole: "blocked_project_root_symlink",
        blockingReasons: ["projectRoot symlink blocked for memory read disk guard."],
        isRegularFile: false,
        symlinkBlocked: true,
      });
    }

    const ancestorBlock = await checkAncestorSegments({
      projectRootPath,
      realProjectRoot,
      normalizedPath: preflight.normalizedPath,
    });
    if (ancestorBlock) return ancestorBlock;

    const targetStat = await lstat(targetPath);

    if (targetStat.isSymbolicLink()) {
      const realTargetPath = await safeRealPath(targetPath);
      return blocked({
        normalizedPath: preflight.normalizedPath,
        realProjectRoot,
        realTargetPath,
        targetRole: realTargetPath && !isContainedBy(realProjectRoot, realTargetPath)
          ? "blocked_target_realpath_outside_project"
          : "blocked_target_symlink",
        blockingReasons: [
          realTargetPath && !isContainedBy(realProjectRoot, realTargetPath)
            ? "target realpath outside project root blocked for memory read disk guard."
            : "target file symlink blocked for memory read disk guard.",
        ],
        isRegularFile: false,
        symlinkBlocked: true,
      });
    }

    if (targetStat.isDirectory()) {
      return blocked({
        normalizedPath: preflight.normalizedPath,
        realProjectRoot,
        realTargetPath: null,
        targetRole: "blocked_target_directory",
        blockingReasons: ["target directory blocked for memory read disk guard."],
        isRegularFile: false,
        symlinkBlocked: false,
      });
    }

    if (!targetStat.isFile()) {
      return blocked({
        normalizedPath: preflight.normalizedPath,
        realProjectRoot,
        realTargetPath: null,
        targetRole: "blocked_non_regular_file",
        blockingReasons: ["target non-regular file blocked for memory read disk guard."],
        isRegularFile: false,
        symlinkBlocked: false,
      });
    }

    const realTargetPath = await realpath(targetPath);
    if (!isContainedBy(realProjectRoot, realTargetPath)) {
      return blocked({
        normalizedPath: preflight.normalizedPath,
        realProjectRoot,
        realTargetPath,
        targetRole: "blocked_target_realpath_outside_project",
        blockingReasons: ["target realpath outside project root blocked for memory read disk guard."],
        isRegularFile: false,
        symlinkBlocked: false,
      });
    }

    return {
      allowed: true,
      normalizedPath: preflight.normalizedPath,
      realProjectRoot,
      realTargetPath,
      targetRole: "allowed_memory_source",
      blockingReasons: [],
      isRegularFile: true,
      symlinkBlocked: false,
      willReadFile: false,
      willWriteMemory: false,
      willInjectAutomatically: false,
    };
  } catch (error) {
    return blocked({
      normalizedPath: preflight.normalizedPath,
      realProjectRoot: null,
      realTargetPath: null,
      targetRole: "blocked_disk_check_failed",
      blockingReasons: [`memory disk guard check failed: ${errorMessage(error)}`],
      isRegularFile: false,
      symlinkBlocked: false,
    });
  }
}

async function checkAncestorSegments(input: {
  readonly projectRootPath: string;
  readonly realProjectRoot: string;
  readonly normalizedPath: string;
}): Promise<MemoryReadDiskGuardResult | null> {
  const segments = input.normalizedPath.split("/").filter(Boolean);

  for (let index = 1; index < segments.length; index += 1) {
    const ancestorPath = resolve(input.projectRootPath, ...segments.slice(0, index));
    const ancestorStat = await lstat(ancestorPath);
    if (!ancestorStat.isSymbolicLink()) continue;

    const realAncestorPath = await safeRealPath(ancestorPath);
    return blocked({
      normalizedPath: input.normalizedPath,
      realProjectRoot: input.realProjectRoot,
      realTargetPath: realAncestorPath,
      targetRole: "blocked_memory_ancestor_symlink",
      blockingReasons: [
        realAncestorPath && !isContainedBy(input.realProjectRoot, realAncestorPath)
          ? "memory ancestor symlink escape blocked for memory read disk guard."
          : "memory ancestor symlink blocked for memory read disk guard.",
      ],
      isRegularFile: false,
      symlinkBlocked: true,
    });
  }

  return null;
}

function blocked(input: {
  readonly normalizedPath: string;
  readonly realProjectRoot: string | null;
  readonly realTargetPath: string | null;
  readonly targetRole: MemoryReadDiskGuardTargetRole;
  readonly blockingReasons: readonly string[];
  readonly isRegularFile: boolean;
  readonly symlinkBlocked: boolean;
}): MemoryReadDiskGuardResult {
  return {
    allowed: false,
    normalizedPath: input.normalizedPath,
    realProjectRoot: input.realProjectRoot,
    realTargetPath: input.realTargetPath,
    targetRole: input.targetRole,
    blockingReasons: input.blockingReasons,
    isRegularFile: input.isRegularFile,
    symlinkBlocked: input.symlinkBlocked,
    willReadFile: false,
    willWriteMemory: false,
    willInjectAutomatically: false,
  };
}

async function safeRealPath(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

function isContainedBy(root: string, target: string): boolean {
  const relation = normalizeMemoryReadPath(relative(root, target));
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
