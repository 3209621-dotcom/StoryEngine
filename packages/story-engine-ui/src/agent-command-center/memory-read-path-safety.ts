import { isAbsolute, relative, resolve } from "node:path";

export type MemoryReadPathTargetRole =
  | "allowed_memory_source"
  | "blocked_path_traversal"
  | "blocked_outside_project"
  | "blocked_hidden_path"
  | "blocked_transaction_record"
  | "blocked_state_json"
  | "blocked_formal_commit_artifact"
  | "blocked_unknown_target";

export interface MemoryReadPathSafetyInput {
  readonly projectRoot: string;
  readonly targetPath: string;
}

export interface MemoryReadPathSafetyResult {
  readonly allowed: boolean;
  readonly reason: string;
  readonly blockingReasons: readonly string[];
  readonly normalizedPath: string;
  readonly targetRole: MemoryReadPathTargetRole;
  readonly willReadFile: false;
  readonly willWriteMemory: false;
  readonly willInjectAutomatically: false;
}

const ALLOWED_MEMORY_EXTENSIONS = new Set([".json", ".md", ".txt"]);
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/u;
const WINDOWS_NETWORK_PATH_PATTERN = /^\\\\/u;

export function preflightMemoryReadPath(input: MemoryReadPathSafetyInput): MemoryReadPathSafetyResult {
  const normalizedInputPath = normalizeMemoryReadPath(input.targetPath);
  const root = normalizeMemoryReadPath(input.projectRoot);
  const traversal = hasPathTraversal(normalizedInputPath);
  const absoluteTarget = isMemoryReadAbsolutePath(input.targetPath);
  const projectRelativePath = absoluteTarget && !traversal
    ? toProjectRelativePath(root, input.targetPath)
    : normalizedInputPath;
  const normalizedPath = normalizeMemoryReadPath(projectRelativePath);
  const outsideProject = absoluteTarget && !isInsideProject(root, input.targetPath);
  const role = classifyMemoryReadTarget({
    normalizedPath,
    traversal,
    outsideProject,
  });
  const blockingReasons = blockingReasonsFor(role);

  return {
    allowed: role === "allowed_memory_source",
    reason: role === "allowed_memory_source" ? "allowed memory source preflight only." : blockingReasons[0] ?? "blocked.",
    blockingReasons,
    normalizedPath,
    targetRole: role,
    willReadFile: false,
    willWriteMemory: false,
    willInjectAutomatically: false,
  };
}

export function normalizeMemoryReadPath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/\/+/gu, "/").replace(/^\.\/+/u, "").replace(/\/$/u, "");
}

function classifyMemoryReadTarget(input: {
  readonly normalizedPath: string;
  readonly traversal: boolean;
  readonly outsideProject: boolean;
}): MemoryReadPathTargetRole {
  if (!input.normalizedPath) return "blocked_unknown_target";
  if (input.traversal) return "blocked_path_traversal";
  if (input.outsideProject) return "blocked_outside_project";

  const segments = input.normalizedPath.split("/").filter(Boolean);
  if (segments[0] === ".story-engine-tx") return "blocked_transaction_record";
  if (segments[0] === "story" && segments[1] === "state") return "blocked_state_json";
  if (isFormalCommitArtifact(segments)) return "blocked_formal_commit_artifact";
  if (segments.some((segment) => segment.startsWith("."))) return "blocked_hidden_path";
  if (segments[0] !== "memory") return "blocked_unknown_target";
  if (!ALLOWED_MEMORY_EXTENSIONS.has(extensionFor(input.normalizedPath))) return "blocked_unknown_target";

  return "allowed_memory_source";
}

function blockingReasonsFor(role: MemoryReadPathTargetRole): string[] {
  switch (role) {
    case "allowed_memory_source":
      return [];
    case "blocked_path_traversal":
      return ["path traversal blocked for memory read preflight."];
    case "blocked_outside_project":
      return ["outside project root path blocked for memory read preflight."];
    case "blocked_hidden_path":
      return ["hidden path segments blocked for memory read preflight."];
    case "blocked_transaction_record":
      return ["transaction records are blocked for memory read preflight."];
    case "blocked_state_json":
      return ["state JSON paths are blocked for memory read preflight."];
    case "blocked_formal_commit_artifact":
      return ["Formal Commit artifacts are blocked for memory read preflight."];
    case "blocked_unknown_target":
      return ["unknown non-memory target blocked for memory read preflight."];
  }
}

function hasPathTraversal(path: string): boolean {
  return path.split("/").some((segment) => segment === "..");
}

function isMemoryReadAbsolutePath(path: string): boolean {
  const trimmed = path.trim();
  return isAbsolute(trimmed) || WINDOWS_ABSOLUTE_PATH_PATTERN.test(trimmed) || WINDOWS_NETWORK_PATH_PATTERN.test(trimmed);
}

function isInsideProject(projectRoot: string, targetPath: string): boolean {
  const comparableRoot = comparablePath(resolve(projectRoot));
  const comparableTarget = comparablePath(resolve(targetPath));
  const relation = normalizeMemoryReadPath(relative(comparableRoot, comparableTarget));

  return relation === "" || (!relation.startsWith("..") && !isMemoryReadAbsolutePath(relation));
}

function toProjectRelativePath(projectRoot: string, targetPath: string): string {
  if (!isInsideProject(projectRoot, targetPath)) return normalizeMemoryReadPath(targetPath);
  return normalizeMemoryReadPath(relative(resolve(projectRoot), resolve(targetPath)));
}

function isFormalCommitArtifact(segments: readonly string[]): boolean {
  return (
    segments.includes("snapshot-manifest.json") ||
    segments.includes("formal-commit") ||
    segments.includes("formal-commits") ||
    segments.includes("formal-commit-artifacts")
  );
}

function extensionFor(path: string): string {
  const fileName = path.split("/").at(-1) ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex) : "";
}

function comparablePath(path: string): string {
  return WINDOWS_ABSOLUTE_PATH_PATTERN.test(path) ? path.toLowerCase() : path;
}
