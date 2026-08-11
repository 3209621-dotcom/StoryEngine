import { Extension } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { DocMatch } from "./findReplace.js";

/**
 * 改写高亮：应用一次选区改写 /「改掉这句」后，把刚改动的片段用暗金装饰层标出来，
 * 让用户像 IDE 看未保存改动一样，一眼看到「刚才改了哪一段」。
 *
 * 独立于查找高亮（各用各的 PluginKey / CSS 类），互不覆盖：查找还能照常用。
 * 装饰层靠 CSS 渲染、不依赖编辑器焦点；文档变化时一起映射位置，避免后续编辑错位。
 * 由 WritingPaper 在「用户手动编辑 / 切章 / 新一次改写开始」时清掉（见 setRevisionHighlight(null)）。
 */

interface RevisionHighlightState {
  // 多片段：一键全修一次改多句，要把每一处都标出来；单句改写传一个元素即可。
  readonly ranges: readonly DocMatch[];
}

export const REVISION_HIGHLIGHT_KEY = new PluginKey<RevisionHighlightState>("revisionHighlight");

export const RevisionHighlight = Extension.create({
  name: "revisionHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<RevisionHighlightState>({
        key: REVISION_HIGHLIGHT_KEY,
        state: {
          init: () => ({ ranges: [] }),
          apply(tr, value) {
            const meta = tr.getMeta(REVISION_HIGHLIGHT_KEY) as RevisionHighlightState | undefined;
            if (meta) return meta;
            // 文档变化时把所有高亮位置一起映射，避免编辑后高亮错位。
            if (tr.docChanged && value.ranges.length > 0) {
              return { ranges: value.ranges.map((r) => ({ from: tr.mapping.map(r.from), to: tr.mapping.map(r.to) })) };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            const hl = REVISION_HIGHLIGHT_KEY.getState(state);
            if (!hl || hl.ranges.length === 0) return DecorationSet.empty;
            const decos = hl.ranges
              .filter((r) => r.to > r.from)
              .map((r) => Decoration.inline(r.from, r.to, { class: "se-v2-revision-highlight" }));
            return decos.length === 0 ? DecorationSet.empty : DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

/** 设置改写高亮（单个片段、多片段、或传 null/空清空）。 */
export function setRevisionHighlight(editor: Editor, range: DocMatch | readonly DocMatch[] | null): void {
  const ranges = range === null ? [] : Array.isArray(range) ? range : [range as DocMatch];
  editor.view.dispatch(editor.state.tr.setMeta(REVISION_HIGHLIGHT_KEY, { ranges }));
}

/** 清空改写高亮（用户编辑 / 切章 / 新改写开始时）。 */
export function clearRevisionHighlight(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(REVISION_HIGHLIGHT_KEY, { ranges: [] }));
}
