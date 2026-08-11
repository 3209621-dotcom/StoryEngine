import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { activeSentenceRange, splitSentences } from "./sentenceFocus.js";

/**
 * 句级聚焦装饰层（仿 findHighlight.ts 的 Decoration.inline + plugin 范式）：
 * 给「当前句之外」的所有句子区间挂 `se-v2-dim-sentence` class，含 caret 的句不挂（保持亮）。
 * 是否真的淡化由 CSS `.se-v2-draft-editor.is-focus-mode` 开关——本插件只管"哪些字符该淡"，
 * 模式开关交 React（打字时开、拖选区时关），保持插件纯粹、随 state 自动重算（沿用 findHighlight 惯例）。
 *
 * 纯切句逻辑复用 sentenceFocus.ts（已单测）；位置映射与真实渲染交真机（jsdom 下 ProseMirror 不稳）。
 */

export const SENTENCE_FOCUS_KEY = new PluginKey("sentenceFocus");

const DIM_CLASS = "se-v2-dim-sentence";

/** 按 state 算"该淡化的句子"装饰集：当前句之外的所有句子（含其它段落整段）。 */
function buildDimDecorations(state: EditorState): DecorationSet {
  const { doc, selection } = state;
  const caret = selection.head;
  const decorations: Decoration[] = [];

  doc.descendants((node: ProseMirrorNode, pos: number) => {
    // 只处理含内联文本的文本块（段落）；其余容器节点继续向下遍历。
    if (!node.isTextblock) return true;
    const text = node.textContent;
    if (text.length === 0) return false;

    // 文本块内首个字符的 doc 位置 = pos + 1（块开标签占 1）。
    const base = pos + 1;
    const blockEnd = base + node.content.size;
    // caret 是否落在本块文本范围内（含两端边界）。
    const caretInBlock = caret >= base && caret <= blockEnd;
    const caretOffset = caretInBlock ? caret - base : -1;
    const active = caretInBlock ? activeSentenceRange(text, caretOffset) : null;

    for (const range of splitSentences(text)) {
      const isActive = active !== null && range.start === active.start && range.end === active.end;
      if (isActive) continue;
      const from = base + range.start;
      const to = base + range.end;
      if (to > from) decorations.push(Decoration.inline(from, to, { class: DIM_CLASS }));
    }
    return false; // 文本块内不再深入，避免对内联节点重复处理。
  });

  return DecorationSet.create(doc, decorations);
}

export const SentenceFocus = Extension.create({
  name: "sentenceFocus",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: SENTENCE_FOCUS_KEY,
        props: {
          // 装饰从 state（doc + selection）直接派生：ProseMirror 在每次 doc/选区变化后都会重跑，
          // 故打字、移动光标都会自动重算，无需自管 meta/映射（不同于 findHighlight 的外部驱动高亮）。
          decorations(state) {
            return buildDimDecorations(state);
          },
        },
      }),
    ];
  },
});
