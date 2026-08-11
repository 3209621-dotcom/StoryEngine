import { describe, expect, it } from "vitest";
import { isDraftFileWriteSuppressed } from "./draftWriteGuard.js";

describe("isDraftFileWriteSuppressed（dogfood F1）", () => {
  it("正常编辑态：不抑制（审查 #4/#5 行为保持）", () => {
    expect(isDraftFileWriteSuppressed({ flowStatus: "draft_ready", draftActionLoading: null })).toBe(false);
    expect(isDraftFileWriteSuppressed({ flowStatus: "idle", draftActionLoading: null })).toBe(false);
    expect(isDraftFileWriteSuppressed({ flowStatus: "waiting_commit_confirmation", draftActionLoading: null })).toBe(false);
  });

  it("流式出稿（flowStatus=draft_generating，含 agent 路）→ 抑制", () => {
    expect(isDraftFileWriteSuppressed({ flowStatus: "draft_generating", draftActionLoading: null })).toBe(true);
  });

  it("按钮路 generate-draft / 修订应用 / 去AI味 / 候选应用 → 抑制", () => {
    expect(isDraftFileWriteSuppressed({ flowStatus: "draft_ready", draftActionLoading: "generate-draft" })).toBe(true);
    expect(isDraftFileWriteSuppressed({ flowStatus: "draft_ready", draftActionLoading: "revision-apply" })).toBe(true);
    expect(isDraftFileWriteSuppressed({ flowStatus: "draft_ready", draftActionLoading: "deai-fix-all" })).toBe(true);
    expect(isDraftFileWriteSuppressed({ flowStatus: "draft_ready", draftActionLoading: "apply-candidate" })).toBe(true);
  });

  it("选区改写进行中 → 抑制", () => {
    expect(isDraftFileWriteSuppressed({
      flowStatus: "draft_ready",
      draftActionLoading: "selection-rewrite-abc",
    })).toBe(true);
  });

  it("只读动作（审稿/质检/预览）不抑制草稿写盘", () => {
    expect(isDraftFileWriteSuppressed({ flowStatus: "draft_ready", draftActionLoading: "ai-review" })).toBe(false);
    expect(isDraftFileWriteSuppressed({ flowStatus: "draft_ready", draftActionLoading: "quality-check" })).toBe(false);
    expect(isDraftFileWriteSuppressed({ flowStatus: "draft_ready", draftActionLoading: "commit-preview" })).toBe(false);
  });
});
