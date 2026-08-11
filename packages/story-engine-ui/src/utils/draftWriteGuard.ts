/**
 * 生成中草稿写盘护栏（dogfood F1）。
 *
 * 根因：流式出稿时 `workspace.draft.content` 是 partial，350ms 防抖 autosave 与
 * pagehide/beforeunload keepalive（App.tsx performAutosaveFromStore）都会带
 * `writeDraftFile:true` 把截断正文覆写到 `drafts/fast/*.md`，造成数据丢失。
 *
 * 规则：生成/流式/修订应用进行中 → 禁止写草稿文件；聊天消息仍可照存。
 * 正常手打编辑（非生成期）的 autosave/keepalive 行为一丝不变（审查 #3/#4/#5）。
 */

const DRAFT_MUTATING_ACTIONS = new Set([
  "generate-draft",
  "revision-apply",
  "deai-fix-all",
  "apply-candidate",
]);

export function isDraftFileWriteSuppressed(args: {
  readonly flowStatus?: string | null;
  readonly draftActionLoading?: string | null;
}): boolean {
  if (args.flowStatus === "draft_generating") return true;
  const loading = args.draftActionLoading;
  if (!loading) return false;
  if (DRAFT_MUTATING_ACTIONS.has(loading)) return true;
  return loading.startsWith("selection-rewrite-");
}
