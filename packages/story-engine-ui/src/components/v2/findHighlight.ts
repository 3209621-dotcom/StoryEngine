import { Extension } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { DocMatch } from "./findReplace.js";

/**
 * 查找高亮（块④的 B 修复）：用 ProseMirror 装饰层给所有匹配 + 当前匹配上高亮 class。
 * 装饰层靠 CSS 渲染、**不依赖编辑器是否有焦点**——这样查找框保持焦点、用户还能看到正文里命中的位置
 *（之前只 setTextSelection 在焦点不在编辑器时不可见，正是 B 不通过的原因）。
 */

interface FindHighlightState {
  readonly all: readonly DocMatch[];
  readonly current: DocMatch | null;
}

export const FIND_HIGHLIGHT_KEY = new PluginKey<FindHighlightState>("findHighlight");

export const FindHighlight = Extension.create({
  name: "findHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindHighlightState>({
        key: FIND_HIGHLIGHT_KEY,
        state: {
          init: () => ({ all: [], current: null }),
          apply(tr, value) {
            const meta = tr.getMeta(FIND_HIGHLIGHT_KEY) as FindHighlightState | undefined;
            if (meta) return meta;
            // 文档变化时把高亮位置一起映射，避免编辑后高亮错位。
            if (tr.docChanged && (value.all.length > 0 || value.current)) {
              return {
                all: value.all.map((range) => ({ from: tr.mapping.map(range.from), to: tr.mapping.map(range.to) })),
                current: value.current
                  ? { from: tr.mapping.map(value.current.from), to: tr.mapping.map(value.current.to) }
                  : null,
              };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            const highlight = FIND_HIGHLIGHT_KEY.getState(state);
            if (!highlight) return DecorationSet.empty;
            const decorations: Decoration[] = [];
            for (const range of highlight.all) {
              if (range.to > range.from) decorations.push(Decoration.inline(range.from, range.to, { class: "se-v2-find-match" }));
            }
            if (highlight.current && highlight.current.to > highlight.current.from) {
              decorations.push(Decoration.inline(highlight.current.from, highlight.current.to, { class: "se-v2-find-match-current" }));
            }
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

/** 设置高亮（所有匹配 + 可选当前匹配）。 */
export function setFindHighlight(editor: Editor, all: readonly DocMatch[], current: DocMatch | null): void {
  editor.view.dispatch(editor.state.tr.setMeta(FIND_HIGHLIGHT_KEY, { all, current }));
}

/** 清空高亮（关闭面板时）。 */
export function clearFindHighlight(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(FIND_HIGHLIGHT_KEY, { all: [], current: null }));
}
