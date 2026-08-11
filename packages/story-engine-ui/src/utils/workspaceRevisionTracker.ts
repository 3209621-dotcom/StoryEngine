import type { SaveChapterWorkspaceRequest } from "../api/types.js";

const revisions = new Map<string, number>();

function key(projectPath: string, chapter: number): string {
  return `${projectPath}\u0000${chapter}`;
}

export function recordWorkspaceRevision(projectPath: string, chapter: number, revision: number): void {
  if (!Number.isInteger(revision) || revision < 0) return;
  revisions.set(key(projectPath, chapter), revision);
}

export function prepareVersionedWorkspaceSave(
  request: SaveChapterWorkspaceRequest,
): SaveChapterWorkspaceRequest {
  const expectedRevision = revisions.get(key(request.projectPath, request.chapter))
    ?? request.expectedRevision
    ?? 0;
  return { ...request, expectedRevision };
}

export function resetWorkspaceRevisionTrackerForTests(): void {
  revisions.clear();
}
