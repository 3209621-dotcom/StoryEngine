import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  RevisionHighlight,
  REVISION_HIGHLIGHT_KEY,
  setRevisionHighlight,
  clearRevisionHighlight,
} from "./revisionHighlight.js";

// 只测插件状态（set/clear/docChanged 映射）这条纯事务逻辑——不渲染装饰（jsdom 下 ProseMirror 渲染不稳，照 WritingPaper.test 的约定）。

function makeEditor(content: string): Editor {
  return new Editor({ extensions: [StarterKit, RevisionHighlight], content });
}

afterEach(() => {
  // 每个用例自建自销，避免泄漏。
});

describe("revisionHighlight 插件", () => {
  it("初始无高亮范围", () => {
    const editor = makeEditor("<p>abcdef</p>");
    expect(REVISION_HIGHLIGHT_KEY.getState(editor.state)?.ranges).toEqual([]);
    editor.destroy();
  });

  it("setRevisionHighlight 写入单个范围、clearRevisionHighlight 清空", () => {
    const editor = makeEditor("<p>abcdef</p>");
    setRevisionHighlight(editor, { from: 1, to: 4 });
    expect(REVISION_HIGHLIGHT_KEY.getState(editor.state)?.ranges).toEqual([{ from: 1, to: 4 }]);
    clearRevisionHighlight(editor);
    expect(REVISION_HIGHLIGHT_KEY.getState(editor.state)?.ranges).toEqual([]);
    editor.destroy();
  });

  it("setRevisionHighlight 支持多个范围（一键全修一次标多处）", () => {
    const editor = makeEditor("<p>abcdef</p>");
    setRevisionHighlight(editor, [{ from: 1, to: 3 }, { from: 4, to: 6 }]);
    expect(REVISION_HIGHLIGHT_KEY.getState(editor.state)?.ranges).toEqual([{ from: 1, to: 3 }, { from: 4, to: 6 }]);
    editor.destroy();
  });

  it("setRevisionHighlight(null) 等同清空", () => {
    const editor = makeEditor("<p>abcdef</p>");
    setRevisionHighlight(editor, { from: 1, to: 4 });
    setRevisionHighlight(editor, null);
    expect(REVISION_HIGHLIGHT_KEY.getState(editor.state)?.ranges).toEqual([]);
    editor.destroy();
  });

  it("文档变化时所有高亮位置随之映射（在前面插入文字，各范围整体后移）", () => {
    const editor = makeEditor("<p>abcdef</p>");
    setRevisionHighlight(editor, [{ from: 3, to: 6 }, { from: 6, to: 7 }]);
    // 在文档最前面（pos 1）插入两个字，前移 2。
    editor.view.dispatch(editor.state.tr.insertText("XY", 1));
    const ranges = REVISION_HIGHLIGHT_KEY.getState(editor.state)?.ranges;
    expect(ranges).toEqual([{ from: 5, to: 8 }, { from: 8, to: 9 }]);
    editor.destroy();
  });
});
