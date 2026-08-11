import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FoundationGapApplyPlan,
  FoundationGapReport,
  FoundationGapSuggestion,
  StateOverview,
} from "../api/types.js";
import { mockSidebarData, mockWorkspaceData } from "../mockData.js";
import { useWorkspaceStore } from "../stores/workspaceStore.js";
import { applyFoundationGapDecisions, fetchFoundationGapReport, previewFoundationGapApply } from "../api/client.js";
import { useFoundationGaps } from "./useFoundationGaps.js";

vi.mock("../api/client.js", () => ({
  applyFoundationGapDecisions: vi.fn(),
  chatFoundationGapAssistant: vi.fn(),
  confirmFoundationGapCharacterStateWrite: vi.fn(),
  fetchFoundationGapReport: vi.fn(),
  fetchFoundationGapSuggestions: vi.fn(),
  previewFoundationGapApply: vi.fn(),
  rollbackFoundationGapApply: vi.fn(),
}));

vi.mock("../api/stateOverviewAdapter.js", () => ({
  sidebarFromStateOverview: vi.fn(() => mockSidebarData),
  workspaceFromStateOverview: vi.fn(() => mockWorkspaceData),
}));

const deleteSuggestion: FoundationGapSuggestion = {
  id: "ai-delete-linxiaowei",
  gapId: "ai-gap-delete-character",
  category: "characters",
  actionType: "delete_foundation_entry",
  targetFile: "story/character-bible.json",
  targetPath: "$",
  targetId: "char-linxiaowei",
  before: { name: "苏晓薇" },
  after: null,
  rationale: "用户明确要求删除该角色资料。",
  risk: "warning",
  requiresUserConfirm: true,
  sourceUserMessage: "删除角色苏晓薇",
  extractedEntityName: "苏晓薇",
};

const blockedDeletePlan: FoundationGapApplyPlan = {
  acceptedSuggestions: [deleteSuggestion],
  rejectedSuggestionIds: [],
  deferredSuggestionIds: [],
  skippedConflicts: [{
    id: "delete-needs-confirmation",
    category: "characters",
    title: "删除需要确认",
    description: "delete_needs_explicit_confirm:第3章",
    targetFile: "story/character-bible.json",
    targetPath: "$",
    existingValue: { name: "苏晓薇" },
    suggestedValue: null,
    resolutionOptions: ["keep_existing", "replace", "merge", "defer"],
  }],
  fileChanges: [],
};

const emptyReport: FoundationGapReport = {
  passed: true,
  readinessLevel: "ready",
  missingItems: [],
  riskyItems: [],
  conflictItems: [],
  suggestions: [],
  byCategory: {
    arcGoals: [],
    assets: [],
    characterRelationships: [],
    characters: [],
    hooks: [],
    knowledgeBoundary: [],
    locations: [],
    story: [],
    threads: [],
    timeline: [],
    world: [],
    writingRules: [],
  },
};

describe("useFoundationGaps chat apply", () => {
  beforeEach(() => {
    vi.mocked(applyFoundationGapDecisions).mockReset();
    vi.mocked(fetchFoundationGapReport).mockReset();
    vi.mocked(previewFoundationGapApply).mockReset();
    useWorkspaceStore.getState().resetFoundationGaps();
  });

  it("confirms a card suggestion by writing directly, without a preview round-trip", async () => {
    const suggestion: FoundationGapSuggestion = {
      id: "ai-create-character",
      gapId: "ai-gap-create-character",
      category: "characters",
      actionType: "create_character",
      targetFile: "story/character-bible.json",
      targetPath: "characters",
      targetId: "char-shen-lan",
      before: undefined,
      after: { bibleEntry: { id: "char-shen-lan", name: "沈岚", role: "重要角色" } },
      rationale: "用户接受草案。",
      risk: "info",
      requiresUserConfirm: true,
    };
    const plan: FoundationGapApplyPlan = {
      acceptedSuggestions: [suggestion],
      rejectedSuggestionIds: [],
      deferredSuggestionIds: [],
      skippedConflicts: [],
      fileChanges: [{ targetFile: "story/character-bible.json", summary: "新增角色", suggestionIds: [suggestion.id] }],
    };
    useWorkspaceStore.getState().setFoundationGapSuggestions([suggestion]);
    useWorkspaceStore.getState().setFoundationGapDecisions({ [suggestion.id]: "accept" });
    vi.mocked(applyFoundationGapDecisions).mockResolvedValue({
      plan,
      writes: [{ domain: "character", action: "create_character", targetFile: "story/character-bible.json", targetName: "沈岚", summary: "新增角色" }],
      skippedWrites: [],
      overview: {} as StateOverview,
      undo: { undoId: "foundation-1-x", changedFiles: ["story/character-bible.json"] },
    });
    vi.mocked(fetchFoundationGapReport).mockResolvedValue(emptyReport);

    const { result } = renderHook(() => useFoundationGaps("/tmp/story-engine-direct-write"));

    await act(async () => {
      await result.current.handleConfirmFoundationGapSuggestion(suggestion);
    });

    // 直接写：不再经过 previewFoundationGapApply 预览往返。
    expect(previewFoundationGapApply).not.toHaveBeenCalled();
    expect(applyFoundationGapDecisions).toHaveBeenCalledTimes(1);
  });

  it("keeps a chat delete suggestion when first apply returns needs-confirmation without writes", async () => {
    useWorkspaceStore.getState().setFoundationGapSuggestions([deleteSuggestion]);
    useWorkspaceStore.getState().setFoundationGapDecisions({ [deleteSuggestion.id]: "accept" });
    vi.mocked(applyFoundationGapDecisions).mockResolvedValue({
      plan: blockedDeletePlan,
      writes: [],
      skippedWrites: [],
      overview: {} as StateOverview,
    });
    vi.mocked(fetchFoundationGapReport).mockResolvedValue(emptyReport);

    const { result } = renderHook(() => useFoundationGaps("/tmp/story-engine-delete-confirm"));

    await act(async () => {
      await result.current.handleApplyFoundationGapSuggestionsFromChat([deleteSuggestion.id]);
    });

    expect(useWorkspaceStore.getState().foundationGapSuggestions).toContainEqual(deleteSuggestion);
    expect(useWorkspaceStore.getState().foundationGapDecisions[deleteSuggestion.id]).toBe("accept");
  });
});
