import { describe, expect, it } from "vitest";
import { splitSentences, activeSentenceRange, typewriterScrollTop } from "./sentenceFocus.js";

describe("splitSentences", () => {
  it("按中文句末标点切句，标点归入前句", () => {
    const t = "他来了。她走了！为什么？";
    expect(splitSentences(t)).toEqual([
      { start: 0, end: 4 },   // 他来了。
      { start: 4, end: 8 },   // 她走了！
      { start: 8, end: 12 },  // 为什么？
    ]);
  });

  it("句末引号/括号跟随前句", () => {
    const t = "“走吧。”他说。";
    // “走吧。” = 0..5, 他说。= 5..8
    expect(splitSentences(t)).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 8 },
    ]);
  });

  it("换行也作分隔，且不丢字符", () => {
    const t = "第一行\n第二句。";
    expect(splitSentences(t)).toEqual([
      { start: 0, end: 4 },   // 第一行\n
      { start: 4, end: 8 },   // 第二句。
    ]);
  });

  it("无句末标点的尾巴也算一句", () => {
    expect(splitSentences("没有标点的残句")).toEqual([{ start: 0, end: 7 }]);
  });

  it("空串返回空数组", () => {
    expect(splitSentences("")).toEqual([]);
  });
});

describe("activeSentenceRange", () => {
  const t = "他来了。她走了！为什么？";
  it("caret 落在某句内→返回该句", () => {
    expect(activeSentenceRange(t, 1)).toEqual({ start: 0, end: 4 });
    expect(activeSentenceRange(t, 5)).toEqual({ start: 4, end: 8 });
  });
  it("caret 在句末边界→归该句（前闭后开，边界算前一句末）", () => {
    expect(activeSentenceRange(t, 4)).toEqual({ start: 0, end: 4 });
  });
  it("caret 在文末→最后一句", () => {
    expect(activeSentenceRange(t, 12)).toEqual({ start: 8, end: 12 });
  });
  it("空串→null", () => {
    expect(activeSentenceRange("", 0)).toBeNull();
  });
});

describe("typewriterScrollTop", () => {
  it("把 caret 顶到视口 45%（默认）", () => {
    expect(typewriterScrollTop({ caretTop: 1000, viewportHeight: 600 })).toBe(730); // 1000-600*0.45=730
  });
  it("顶部不越界为负", () => {
    expect(typewriterScrollTop({ caretTop: 100, viewportHeight: 600 })).toBe(0);
  });
  it("自定义 ratio", () => {
    expect(typewriterScrollTop({ caretTop: 1000, viewportHeight: 600, ratio: 0.5 })).toBe(700);
  });
});
