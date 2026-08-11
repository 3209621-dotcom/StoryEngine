import type { ChapterWorkspaceSnapshot, SaveChapterWorkspaceRequest } from "../api/types.js";

export interface CapturedAutosavePayload<TMessages = unknown> {
  readonly key: string;
  readonly request: SaveChapterWorkspaceRequest;
  readonly sessionId: string;
  readonly messages: TMessages;
  /** workspace 阶段已成功时，失败重试只补 session 阶段，不能用旧 expectedRevision 再 PUT。 */
  workspaceSavedRevision?: number;
}

export async function persistCapturedAutosavePayload<TMessages>(
  payload: CapturedAutosavePayload<TMessages>,
  deps: {
    readonly saveWorkspace: (request: SaveChapterWorkspaceRequest) => Promise<ChapterWorkspaceSnapshot>;
    readonly saveSession: (projectPath: string, sessionId: string, messages: TMessages) => Promise<unknown>;
    readonly onWorkspaceSaved?: (snapshot: ChapterWorkspaceSnapshot) => void;
  },
): Promise<{ readonly revision: number }> {
  if (payload.workspaceSavedRevision === undefined) {
    // CAS 必须先通过；否则绝不能让同一旧客户端的 session messages 越过冲突写到磁盘。
    const snapshot = await deps.saveWorkspace(payload.request);
    payload.workspaceSavedRevision = snapshot.revision ?? payload.request.expectedRevision ?? 0;
    deps.onWorkspaceSaved?.(snapshot);
  }

  if (payload.sessionId) {
    await deps.saveSession(payload.request.projectPath, payload.sessionId, payload.messages);
  }
  return { revision: payload.workspaceSavedRevision };
}
