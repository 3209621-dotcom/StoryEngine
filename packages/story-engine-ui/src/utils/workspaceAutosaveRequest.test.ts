import { describe, expect, it } from "vitest";

import { buildWorkspaceAutosaveRequest } from "./workspaceAutosaveRequest.js";

const baseInput = {
  projectPath: "/books/demo",
  chapter: 3,
  selectedAdviceCardKeys: ["advice-1"],
  flowStatus: "draft_ready" as const,
  title: "第三章",
};

describe("buildWorkspaceAutosaveRequest", () => {
  it("omits every draft write field when the editor contains placeholder text", () => {
    const request = buildWorkspaceAutosaveRequest({
      ...baseInput,
      content: "还没有载入本章草稿正文……先完成章节规划。",
    });

    expect(request).toEqual({
      projectPath: "/books/demo",
      chapter: 3,
      selectedAdviceCardKeys: ["advice-1"],
      flowStatus: "draft_ready",
    });
    expect(request).not.toHaveProperty("draftContent");
    expect(request).not.toHaveProperty("draftTitle");
    expect(request).not.toHaveProperty("writeDraftFile");
  });

  it("keeps real draft content and enables the draft-file write", () => {
    const request = buildWorkspaceAutosaveRequest({
      ...baseInput,
      content: "雨水从屋檐垂落，林澈推开了仓库的门。",
    });

    expect(request).toMatchObject({
      draftContent: "雨水从屋檐垂落，林澈推开了仓库的门。",
      draftTitle: "第三章",
      writeDraftFile: true,
    });
  });

  it.each([
    { suppressed: true, committed: false, reason: "suppressed" },
    { suppressed: false, committed: true, reason: "committed" },
  ])("omits draft fields when a real draft is $reason", ({ suppressed, committed }) => {
    const request = buildWorkspaceAutosaveRequest({
      ...baseInput,
      content: "这是一段真实正文。",
      suppressed,
      committed,
    });

    expect(request).not.toHaveProperty("draftContent");
    expect(request).not.toHaveProperty("draftTitle");
    expect(request).not.toHaveProperty("writeDraftFile");
  });
});
