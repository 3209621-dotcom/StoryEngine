import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { FIND_HIGHLIGHT_KEY } from "./findHighlight.js";

/**
 * 编辑器查找替换（阶段三块④）。当前匹配用编辑器**选区**展示（原生高亮）+ 导航 + 替换，
 * 不引 ProseMirror 装饰层插件——更稳、可测。匹配只在单个文本节点内找（跨段/跨软换行的极少见，V1 可不找）。
 */

export interface StringMatch {
  readonly start: number;
  readonly end: number;
}

/** 在一段纯文本里找出 query 的所有出现（按出现顺序、不重叠）。query 为空返回 []。 */
export function findMatchesInString(text: string, query: string, caseSensitive: boolean): readonly StringMatch[] {
  if (!query) return [];
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: StringMatch[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    matches.push({ start: index, end: index + needle.length });
    index = haystack.indexOf(needle, index + needle.length);
  }
  return matches;
}

export interface DocMatch {
  readonly from: number;
  readonly to: number;
}

/** 遍历文档每个文本节点找 query，返回 ProseMirror 位置（from/to）。按文档顺序。 */
export function collectDocMatches(doc: PMNode, query: string, caseSensitive: boolean): readonly DocMatch[] {
  if (!query) return [];
  const matches: DocMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || typeof node.text !== "string") return;
    for (const match of findMatchesInString(node.text, query, caseSensitive)) {
      matches.push({ from: pos + match.start, to: pos + match.end });
    }
  });
  return matches;
}

export interface FindResult {
  /** 1-based 当前匹配序号；0 表示无匹配。 */
  readonly current: number;
  readonly total: number;
}

/** 从当前选区出发找下一个/上一个匹配并选中它（原生高亮）+ 滚动到视野。无匹配返回 {current:0,total:0}。 */
export function findInEditor(
  editor: Editor,
  query: string,
  caseSensitive: boolean,
  direction: "next" | "prev",
): FindResult {
  const matches = collectDocMatches(editor.state.doc, query, caseSensitive);
  if (matches.length === 0) {
    editor.view.dispatch(editor.state.tr.setMeta(FIND_HIGHLIGHT_KEY, { all: [], current: null }));
    return { current: 0, total: 0 };
  }
  const selection = editor.state.selection;
  let index: number;
  if (direction === "next") {
    const found = matches.findIndex((match) => match.from >= selection.to);
    index = found === -1 ? 0 : found; // 没有更靠后的 → 回到第一个（环绕）
  } else {
    let found = -1;
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      if (matches[i]!.to <= selection.from) { found = i; break; }
    }
    index = found === -1 ? matches.length - 1 : found; // 没有更靠前的 → 跳到最后一个（环绕）
  }
  const target = matches[index]!;
  // 一个事务里同时：设选区（供替换用）、设高亮装饰（供可见高亮，不抢焦点）、滚动到视野。
  const tr = editor.state.tr;
  tr.setSelection(TextSelection.create(tr.doc, target.from, target.to));
  tr.setMeta(FIND_HIGHLIGHT_KEY, { all: matches, current: target });
  tr.scrollIntoView();
  editor.view.dispatch(tr);
  return { current: index + 1, total: matches.length };
}

/** 仅统计匹配数（用于 query 输入时实时显示「N 处」），不移动选区。 */
export function countMatchesInEditor(editor: Editor, query: string, caseSensitive: boolean): number {
  return collectDocMatches(editor.state.doc, query, caseSensitive).length;
}

/**
 * 替换「当前选区正好是 query 的那个匹配」；若当前选区不是匹配，则先跳到下一个匹配（不替换）。
 * 返回替换后剩余匹配数。
 */
export function replaceCurrentInEditor(
  editor: Editor,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): { readonly replaced: boolean; readonly remaining: number } {
  if (!query) return { replaced: false, remaining: 0 };
  const selection = editor.state.selection;
  const selectedText = editor.state.doc.textBetween(selection.from, selection.to, "\n");
  const isMatch = caseSensitive ? selectedText === query : selectedText.toLowerCase() === query.toLowerCase();
  if (isMatch && selection.from !== selection.to) {
    editor.chain().focus().insertContentAt({ from: selection.from, to: selection.to }, replacement).run();
    const remaining = countMatchesInEditor(editor, query, caseSensitive);
    findInEditor(editor, query, caseSensitive, "next");
    return { replaced: true, remaining };
  }
  // 当前选区不是匹配：先选中下一个，让用户确认要替换的位置（这一步不替换）。
  const result = findInEditor(editor, query, caseSensitive, "next");
  return { replaced: false, remaining: result.total };
}

/** 全部替换：从后往前替换所有匹配（保位置不失效），一次完成。返回替换条数。 */
export function replaceAllInEditor(
  editor: Editor,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): number {
  const matches = collectDocMatches(editor.state.doc, query, caseSensitive);
  if (matches.length === 0) return 0;
  let chain = editor.chain().focus();
  // 从后往前：替换靠后的不影响靠前匹配的位置。
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i]!;
    chain = chain.insertContentAt({ from: match.from, to: match.to }, replacement);
  }
  chain.run();
  return matches.length;
}
