export type HybridWorkspaceLayer =
  | "json_state_engine"
  | "memory_system"
  | "markdown_workspace"
  | "workspace_agent"
  | "unknown";

export type HybridWorkspaceRole =
  | "json_state"
  | "memory_record"
  | "markdown_chapter"
  | "markdown_draft"
  | "markdown_note"
  | "markdown_review"
  | "markdown_quality_report"
  | "markdown_outline"
  | "markdown_character_doc"
  | "markdown_world_doc"
  | "markdown_skill"
  | "markdown_constitution"
  | "transaction_record"
  | "formal_commit_artifact"
  | "unknown";

const TOP_LEVEL_STATE_JSON = new Set([
  "story/hooks.json",
  "story/threads.json",
  "story/arc-goals.json",
  "story/assets.json",
  "story/location-bible.json",
  "story/character-bible.json",
  "story/character-matrix.json",
  "timeline/events.json",
  "world/state.json",
  "time/calendar.json",
]);

function normalizeWorkspacePath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").replace(/^\/+/, "");
}

function hasSegmentPath(path: string, pattern: RegExp): boolean {
  return pattern.test(normalizeWorkspacePath(path));
}

function isMarkdown(path: string): boolean {
  return normalizeWorkspacePath(path).toLowerCase().endsWith(".md");
}

function isJson(path: string): boolean {
  return normalizeWorkspacePath(path).toLowerCase().endsWith(".json");
}

export function classifyWorkspaceLayer(path: string): HybridWorkspaceLayer {
  const role = classifyWorkspaceRole(path);

  if (role === "memory_record") return "memory_system";
  if (isMarkdownRole(role)) return "markdown_workspace";
  if (role === "json_state" || role === "transaction_record" || role === "formal_commit_artifact") {
    return "json_state_engine";
  }

  return "unknown";
}

export function classifyWorkspaceRole(path: string): HybridWorkspaceRole {
  const normalizedPath = normalizeWorkspacePath(path);

  if (hasSegmentPath(normalizedPath, /(^|\/)\.story-engine-tx(\/|$)/)) return "transaction_record";
  if (isFormalCommitArtifactPath(normalizedPath)) return "formal_commit_artifact";
  if (isJsonStatePath(normalizedPath)) return "json_state";
  if (hasSegmentPath(normalizedPath, /(^|\/)memory\/.+\.(json|md)$/i)) return "memory_record";

  if (!isMarkdown(normalizedPath)) return "unknown";

  if (hasSegmentPath(normalizedPath, /(^|\/)chapters\/.+\.md$/i)) return "markdown_chapter";
  if (hasSegmentPath(normalizedPath, /(^|\/)drafts\/.+\.md$/i)) return "markdown_draft";
  if (hasSegmentPath(normalizedPath, /(^|\/)reviews\/.+\.md$/i)) return "markdown_review";
  if (hasSegmentPath(normalizedPath, /(^|\/)quality-reports\/.+\.md$/i)) return "markdown_quality_report";
  if (hasSegmentPath(normalizedPath, /(^|\/)outlines\/.+\.md$/i)) return "markdown_outline";
  if (hasSegmentPath(normalizedPath, /(^|\/)characters\/.+\.md$/i)) return "markdown_character_doc";
  if (hasSegmentPath(normalizedPath, /(^|\/)world\/.+\.md$/i)) return "markdown_world_doc";
  if (hasSegmentPath(normalizedPath, /(^|\/)skills\/.+\.md$/i)) return "markdown_skill";
  if (hasSegmentPath(normalizedPath, /(^|\/)constitution(\.md|\/.+\.md)$/i)) return "markdown_constitution";
  if (hasSegmentPath(normalizedPath, /(^|\/)notes\/.+\.md$/i)) return "markdown_note";

  return "unknown";
}

export function canAgentRead(path: string): boolean {
  return classifyWorkspaceRole(path) !== "unknown";
}

export function canAgentProposeEdit(path: string): boolean {
  const role = classifyWorkspaceRole(path);

  return (
    role === "markdown_chapter" ||
    role === "markdown_draft" ||
    role === "markdown_note" ||
    role === "markdown_review" ||
    role === "markdown_quality_report" ||
    role === "markdown_outline" ||
    role === "markdown_character_doc" ||
    role === "markdown_world_doc" ||
    role === "markdown_skill"
  );
}

export function requiresPatchConfirmation(path: string): boolean {
  const role = classifyWorkspaceRole(path);

  return canAgentProposeEdit(path) || role === "markdown_constitution";
}

export function isProtectedStatePath(path: string): boolean {
  const role = classifyWorkspaceRole(path);

  return role === "json_state" || role === "transaction_record" || role === "formal_commit_artifact";
}

export function isMarkdownWorkspacePath(path: string): boolean {
  return classifyWorkspaceLayer(path) === "markdown_workspace";
}

function isMarkdownRole(role: HybridWorkspaceRole): boolean {
  return role.startsWith("markdown_");
}

function isJsonStatePath(path: string): boolean {
  const normalizedPath = normalizeWorkspacePath(path);

  if (!isJson(normalizedPath)) return false;
  if (isKnownStateJson(normalizedPath)) return true;
  if (hasSegmentPath(normalizedPath, /(^|\/)story\/state\/.+\.json$/i)) return true;
  if (hasSegmentPath(normalizedPath, /(^|\/)characters\/[^/]+\/state\.json$/i)) return true;
  if (hasSegmentPath(normalizedPath, /(^|\/)diagnostics\/.+\.json$/i)) return true;

  return false;
}

function isKnownStateJson(path: string): boolean {
  for (const statePath of TOP_LEVEL_STATE_JSON) {
    if (path === statePath || path.endsWith(`/${statePath}`)) return true;
  }

  return false;
}

function isFormalCommitArtifactPath(path: string): boolean {
  const normalizedPath = normalizeWorkspacePath(path);

  if (!isJson(normalizedPath)) return false;
  return hasSegmentPath(normalizedPath, /(^|\/)(snapshot-manifest|formal-commit-manifest|finalized-manifest)\.json$/i);
}
