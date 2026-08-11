import { describe, expect, it } from "vitest";
import { decideExternalDraftSync, draftTextToHtml } from "./draftEditorSync.js";

describe("draftTextToHtml", () => {
  it("splits blank-line-separated paragraphs into <p> blocks", () => {
    expect(draftTextToHtml("# 第一章\n\n第一段。\n\n第二段。")).toBe(
      "<p># 第一章</p><p>第一段。</p><p>第二段。</p>",
    );
  });

  it("keeps a single newline inside a paragraph as a soft break", () => {
    expect(draftTextToHtml("上一句\n下一句")).toBe("<p>上一句<br>下一句</p>");
  });

  it("escapes html-significant characters so prose can't inject markup", () => {
    expect(draftTextToHtml("a < b & c > d")).toBe("<p>a &lt; b &amp; c &gt; d</p>");
  });

  it("normalizes CRLF and yields an empty paragraph for empty content", () => {
    expect(draftTextToHtml("甲\r\n\r\n乙")).toBe("<p>甲</p><p>乙</p>");
    expect(draftTextToHtml("")).toBe("<p></p>");
  });
});

describe("decideExternalDraftSync", () => {
  it("accepts external content when the user has not diverged from the last sync (AI stream / undo)", () => {
    // 对应旧 test「syncs external draft content when there is no local edit」
    expect(
      decideExternalDraftSync({ incoming: "新稿", editorText: "旧稿", lastExternal: "旧稿" }),
    ).toEqual({ action: "set" });
  });

  it("preserves a local dirty edit when external content arrives", () => {
    // 对应旧 test「does not overwrite local dirty edits when an external draft arrives」
    expect(
      decideExternalDraftSync({ incoming: "AI 刚生成", editorText: "用户正在改", lastExternal: "旧稿" }),
    ).toEqual({ action: "skip" });
  });

  it("realigns the baseline (no reset) when the editor already equals incoming (autosave round-trip)", () => {
    expect(
      decideExternalDraftSync({ incoming: "用户的字", editorText: "用户的字", lastExternal: "旧稿" }),
    ).toEqual({ action: "realign" });
  });

  it("skips when there is no new external content", () => {
    expect(
      decideExternalDraftSync({ incoming: "同", editorText: "同", lastExternal: "同" }),
    ).toEqual({ action: "skip" });
  });

  it("换章（chapterChanged）强制加载新章，即使编辑器有本地脏编辑也覆盖（治切章点两下）", () => {
    expect(
      decideExternalDraftSync({ incoming: "第2章内容", editorText: "第1章·用户改了一半", lastExternal: "第1章", chapterChanged: true }),
    ).toEqual({ action: "set" });
  });

  it("非换章时（chapterChanged=false）仍保留本地脏编辑（章内 AI 流式/编辑的老行为不变）", () => {
    expect(
      decideExternalDraftSync({ incoming: "AI 刚生成", editorText: "用户正在改", lastExternal: "旧稿", chapterChanged: false }),
    ).toEqual({ action: "skip" });
  });
});
