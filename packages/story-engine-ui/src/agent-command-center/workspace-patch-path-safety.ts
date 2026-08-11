export interface WorkspacePatchTargetPathSafetyInput {
  readonly projectRoot: string;
  readonly targetPath: string;
}

export interface WorkspacePatchTargetPathSafetyResult {
  readonly ok: boolean;
  readonly normalizedPath: string;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/u;
const WINDOWS_NETWORK_PATH_PATTERN = /^\\\\/u;

export function normalizeWorkspacePatchTargetPath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/\/+/gu, "/").replace(/^\.\/+/u, "").replace(/\/$/u, "");
}

export function hasPathTraversal(path: string): boolean {
  return normalizeWorkspacePatchTargetPath(path).split("/").some((segment) => segment === "..");
}

export function isAbsolutePath(path: string): boolean {
  const trimmedPath = path.trim();
  return (
    trimmedPath.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(trimmedPath) ||
    WINDOWS_NETWORK_PATH_PATTERN.test(trimmedPath)
  );
}

export function hasHiddenPathSegment(path: string): boolean {
  return normalizeWorkspacePatchTargetPath(path)
    .split("/")
    .filter(Boolean)
    .some((segment) => segment.startsWith("."));
}

export function isWithinProjectRoot(projectRoot: string, targetPath: string): boolean {
  if (!isAbsolutePath(targetPath)) return true;

  const normalizedRoot = normalizeAbsolutePath(projectRoot);
  const normalizedTarget = normalizeAbsolutePath(targetPath);

  if (isWindowsPath(normalizedRoot) !== isWindowsPath(normalizedTarget)) return false;

  const comparableRoot = comparablePath(normalizedRoot);
  const comparableTarget = comparablePath(normalizedTarget);

  return comparableTarget === comparableRoot || comparableTarget.startsWith(`${comparableRoot}/`);
}

export function validateWorkspacePatchTargetPath(
  input: WorkspacePatchTargetPathSafetyInput,
): WorkspacePatchTargetPathSafetyResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const trimmedTargetPath = input.targetPath.trim();
  const absoluteTarget = isAbsolutePath(trimmedTargetPath);

  if (!trimmedTargetPath) reasons.push("target path is required.");
  if (hasPathTraversal(trimmedTargetPath)) reasons.push("path traversal is not allowed for workspace patch targets.");

  if (absoluteTarget && !isWithinProjectRoot(input.projectRoot, trimmedTargetPath)) {
    reasons.push("absolute target path is outside project root.");
  }

  const normalizedPath = absoluteTarget && reasons.length === 0
    ? relativizeProjectPath(input.projectRoot, trimmedTargetPath)
    : normalizeWorkspacePatchTargetPath(trimmedTargetPath);

  if (hasHiddenPathSegment(normalizedPath)) {
    reasons.push("hidden file or hidden directory segments are not allowed for workspace patch targets.");
  }

  if (absoluteTarget && reasons.length === 0) {
    warnings.push("absolute target path was normalized to a project-relative path.");
  }

  return {
    ok: reasons.length === 0,
    normalizedPath,
    reasons: uniqueStrings(reasons),
    warnings,
  };
}

function relativizeProjectPath(projectRoot: string, targetPath: string): string {
  const normalizedRoot = normalizeAbsolutePath(projectRoot);
  const normalizedTarget = normalizeAbsolutePath(targetPath);
  const comparableRoot = comparablePath(normalizedRoot);
  const comparableTarget = comparablePath(normalizedTarget);

  if (comparableTarget === comparableRoot) return "";
  if (!comparableTarget.startsWith(`${comparableRoot}/`)) return normalizeWorkspacePatchTargetPath(targetPath);

  return normalizedTarget.slice(normalizedRoot.length).replace(/^\/+/u, "");
}

function normalizeAbsolutePath(path: string): string {
  return normalizeWorkspacePatchTargetPath(path).replace(/\/$/u, "");
}

function comparablePath(path: string): string {
  return isWindowsPath(path) ? path.toLowerCase() : path;
}

function isWindowsPath(path: string): boolean {
  return WINDOWS_ABSOLUTE_PATH_PATTERN.test(path);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
