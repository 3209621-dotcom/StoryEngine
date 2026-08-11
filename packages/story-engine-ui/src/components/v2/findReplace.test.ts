import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  collectDocMatches,
  countMatchesInEditor,
  findInEditor,
  findMatchesInString,
  replaceAllInEditor,
  replaceCurrentInEditor,
} from "./findReplace.js";
import { FIND_HIGHLIGHT_KEY, FindHighlight } from "./findHighlight.js";

describe("findMatchesInString", () => {
  it("finds all non-overlapping occurrences in order", () => {
    expect(findMatchesInString("林晚林晚林", "林晚", false)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("is case-insensitive by default and case-sensitive when asked", () => {
    expect(findMatchesInString("AbAB", "ab", false)).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
    expect(findMatchesInString("AbAB", "ab", true)).toEqual([]);
    expect(findMatchesInString("abAB", "ab", true)).toEqual([{ start: 0, end: 2 }]);
  });

  it("returns nothing for an empty query", () => {
    expect(findMatchesInString("任何文本", "", false)).toEqual([]);
  });
});

describe("findReplace over a live editor", () => {
  let editor: Editor | undefined;
  afterEach(() => { editor?.destroy(); editor = undefined; });

  function makeEditor(text: string): Editor {
    return new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit.configure({ heading: false, bulletList: false, orderedList: false, blockquote: false, codeBlock: false, horizontalRule: false, bold: false, italic: false, strike: false, code: false }), FindHighlight],
      content: text,
    });
  }

  it("findInEditor sets highlight-decoration state for all matches + the current one (block 4 B fix)", () => {
    editor = makeEditor("<p>风风风</p>");
    findInEditor(editor, "风", false, "next");
    const highlight = FIND_HIGHLIGHT_KEY.getState(editor.state);
    expect(highlight?.all.length).toBe(3); // 所有匹配都高亮
    expect(highlight?.current).not.toBeNull(); // 当前匹配单独高亮（焦点不在编辑器也可见）
    // 无匹配时清空高亮
    findInEditor(editor, "雪", false, "next");
    expect(FIND_HIGHLIGHT_KEY.getState(editor.state)?.all.length).toBe(0);
  });

  it("collects doc matches as ProseMirror positions and counts them", () => {
    editor = makeEditor("<p>风穿过山口，风又起。</p>");
    expect(collectDocMatches(editor.state.doc, "风", false).length).toBe(2);
    expect(countMatchesInEditor(editor, "风", false)).toBe(2);
    expect(countMatchesInEditor(editor, "雪", false)).toBe(0);
  });

  it("findInEditor selects the next match and wraps around", () => {
    editor = makeEditor("<p>甲乙甲乙甲</p>");
    const first = findInEditor(editor, "甲", false, "next");
    expect(first).toEqual({ current: 1, total: 3 });
    const second = findInEditor(editor, "甲", false, "next");
    expect(second.current).toBe(2);
    findInEditor(editor, "甲", false, "next"); // 3
    const wrapped = findInEditor(editor, "甲", false, "next"); // 环绕回 1
    expect(wrapped.current).toBe(1);
  });

  it("replaceAll replaces every occurrence in one pass", () => {
    editor = makeEditor("<p>狼来了，狼走了，狼又来。</p>");
    const replaced = replaceAllInEditor(editor, "狼", "虎", false);
    expect(replaced).toBe(3);
    expect(editor.getText()).toContain("虎来了");
    expect(editor.getText()).not.toContain("狼");
  });

  it("replaceCurrent replaces only the selected match and reports remaining", () => {
    editor = makeEditor("<p>门门门</p>");
    findInEditor(editor, "门", false, "next"); // 选中第 1 个「门」
    const result = replaceCurrentInEditor(editor, "门", "窗", false);
    expect(result.replaced).toBe(true);
    expect(editor.getText()).toContain("窗");
    expect(countMatchesInEditor(editor, "门", false)).toBe(result.remaining);
    expect(result.remaining).toBe(2);
  });
});
