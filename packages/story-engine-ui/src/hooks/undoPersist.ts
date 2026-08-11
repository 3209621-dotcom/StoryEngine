/**
 * 「撤销到此」把截断后的干净对话显式写回当前章后端文件的请求构造（H5 根治）。
 *
 * 病根：createSnapshot 用 `git add -A` 把对话持久化文件 chapter-workspaces/*.json 也卷进快照，
 * restore 把对话连同草稿一起还原成回合起点脏态（含刚撤销的孤儿消息）。仅靠「reload 时优先 session +
 * autosave 自愈」不可靠：dev StrictMode 让 openProject 跑两次（一次性 flag 被首次消费、二次回退读磁盘），
 * 自愈 autosave 也是 350ms 异步、时机不定。必须把干净截断显式写回磁盘，使磁盘成为干净真值。
 *
 * 本函数：读回 restore 后的快照（draftContent/flowStatus 已是回退草稿），只把 messages 换成截断后的，
 * 并**不重写 .md**（writeDraftFile 省略——草稿文件已被 git restore 还原，不能用缓存覆盖它）。
 */
import type { ChapterWorkspaceSnapshot, SaveChapterWorkspaceRequest } from "../api/types.js";
import type { ChapterMessage } from "../types.js";

export function buildUndoPersistRequest(
  projectPath: string,
  chapter: number,
  truncatedMessages: readonly ChapterMessage[],
  restored: ChapterWorkspaceSnapshot,
): SaveChapterWorkspaceRequest {
  return {
    projectPath,
    chapter,
    messages: truncatedMessages,
    selectedAdviceCardKeys: restored.selectedAdviceCardKeys ?? [],
    ...(restored.revision !== undefined ? { expectedRevision: restored.revision } : {}),
    ...(restored.flowStatus !== undefined ? { flowStatus: restored.flowStatus } : {}),
    // 保留 restore 后的回退草稿（绝不用内存里的回合后旧稿覆盖）。
    ...(restored.draftContent !== undefined ? { draftContent: restored.draftContent } : {}),
    ...(restored.draftTitle !== undefined ? { draftTitle: restored.draftTitle } : {}),
    // 刻意不带 writeDraftFile：.md 已被 git restore 还原，不重写，避免缓存覆盖回退草稿。
  };
}
