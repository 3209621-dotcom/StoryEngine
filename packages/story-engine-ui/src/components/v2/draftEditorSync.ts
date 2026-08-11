/**
 * 草稿编辑器（Tiptap）与外部草稿内容（AI 流式 / 归档 / 撤销）之间的同步纯逻辑。
 * 抽成纯函数便于单测——Tiptap/ProseMirror 在 jsdom 下整渲染不稳，真实输入交真机验。
 */

/** 把草稿纯文本（段落以空行分隔、段内单 \n 为软换行）转成 Tiptap 用的段落 HTML。 */
export function draftTextToHtml(text: string): string {
  const normalized = text.replace(/\r\n/gu, "\n");
  const paragraphs = normalized.split(/\n{2,}/u);
  if (paragraphs.length === 0) return "<p></p>";
  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/gu, "<br>")}</p>`)
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

/**
 * 外部草稿内容到来时，决定要不要覆盖编辑器当前内容（保留正在编辑的用户、又能接住 AI 流式/撤销）：
 * - chapterChanged（换了章）：无条件硬加载新章内容 → set。换章不是「外部稿到来」而是「换了一篇」，
 *   绝不能被「保留本地脏编辑」的逻辑挡住，否则切到下一章还显示上一章正文、要点两下（治此 bug）。
 * - incoming 与上次同步基准相同：无新内容 → skip。
 * - 编辑器当前文本已等于 incoming：已对齐（如自动保存回环）→ realign（只挪基准、不重设内容）。
 * - 用户未偏离上次同步基准：接受外部 → set。
 * - 用户已偏离（本地脏编辑）且外部不同：保留用户编辑 → skip。
 */
export function decideExternalDraftSync(input: {
  readonly incoming: string;
  readonly editorText: string;
  readonly lastExternal: string;
  readonly chapterChanged?: boolean;
}): { readonly action: "set" | "realign" | "skip" } {
  if (input.chapterChanged) return { action: "set" };
  if (input.incoming === input.lastExternal) return { action: "skip" };
  if (input.incoming === input.editorText) return { action: "realign" };
  if (input.editorText === input.lastExternal) return { action: "set" };
  return { action: "skip" };
}
