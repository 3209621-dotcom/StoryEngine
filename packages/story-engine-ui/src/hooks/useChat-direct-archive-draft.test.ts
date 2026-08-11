import { describe, expect, it } from "vitest";
import type { FoundationGapSuggestion } from "../api/types.js";
import { shouldDirectArchiveFromChat } from "./useChat.js";

// 问题 B：directArchive 模式下，若模型只产出 draftSuggestion（generatedSuggestions=[]）
// 且 actionType 在 DIRECT_ARCHIVE 白名单内，直写判定必须认 draftSuggestion；
// 非 directArchive（交互面板）则不放宽——draftSuggestion-only 仍走「草案待确认」。

describe("shouldDirectArchiveFromChat: draftSuggestion handling across modes", () => {
  const draftOnly = draftCharacterDetailSuggestion();
  const allWithDraftOnly = [draftOnly] as const;
  const generatedEmpty: readonly FoundationGapSuggestion[] = [];

  it("directArchive=true accepts a draftSuggestion-only set (whitelisted action) → direct write", () => {
    expect(shouldDirectArchiveFromChat({
      directArchive: true,
      sourceText: "林晚突破金丹期了",
      allSuggestions: allWithDraftOnly,
      generatedSuggestions: generatedEmpty,
    })).toBe(true);
  });

  it("directArchive=false does NOT widen: draftSuggestion-only stays draft-to-confirm → no direct write", () => {
    expect(shouldDirectArchiveFromChat({
      directArchive: false,
      sourceText: "林晚突破金丹期了",
      allSuggestions: allWithDraftOnly,
      generatedSuggestions: generatedEmpty,
    })).toBe(false);
  });

  it("directArchive=true still respects the clear/reset guard", () => {
    expect(shouldDirectArchiveFromChat({
      directArchive: true,
      sourceText: "清空所有资料",
      allSuggestions: allWithDraftOnly,
      generatedSuggestions: generatedEmpty,
    })).toBe(false);
  });

  it("directArchive=true rejects an action outside the DIRECT_ARCHIVE whitelist", () => {
    const relationship = [relationshipSuggestion()] as const;
    expect(shouldDirectArchiveFromChat({
      directArchive: true,
      sourceText: "记一下他们的关系",
      allSuggestions: relationship,
      generatedSuggestions: [],
    })).toBe(false);
  });

  it("directArchive=true with an empty set → no direct write", () => {
    expect(shouldDirectArchiveFromChat({
      directArchive: true,
      sourceText: "随便聊聊",
      allSuggestions: [],
      generatedSuggestions: [],
    })).toBe(false);
  });

  it("non-directArchive still direct-writes a real generatedSuggestion (existing behavior preserved)", () => {
    const generated = [generatedCharacterDetailSuggestion()] as const;
    expect(shouldDirectArchiveFromChat({
      directArchive: false,
      sourceText: "林晚突破金丹期了",
      allSuggestions: generated,
      generatedSuggestions: generated,
    })).toBe(true);
  });
});

function draftCharacterDetailSuggestion(): FoundationGapSuggestion {
  return {
    id: "draft-lin-wan-realm",
    gapId: "ai-gap-characters",
    category: "characters",
    actionType: "update_character_detail",
    targetFile: "characters/lin-wan/state.json",
    targetPath: "extraFields",
    before: { id: "lin-wan", name: "林晚" },
    after: { extraFields: { 境界: "金丹期" } },
    rationale: "记录境界变化",
    risk: "info",
    requiresUserConfirm: true,
  };
}

function generatedCharacterDetailSuggestion(): FoundationGapSuggestion {
  return {
    ...draftCharacterDetailSuggestion(),
    id: "gen-lin-wan-realm",
  };
}

function relationshipSuggestion(): FoundationGapSuggestion {
  return {
    id: "sug-relationship",
    gapId: "gap-relationship",
    category: "characters",
    actionType: "create_relationship",
    targetFile: "story/character-bible.json",
    targetPath: "relationships",
    before: undefined,
    after: { from: "lin-wan", to: "guo-xu", type: "盟友" },
    rationale: "记录关系",
    risk: "info",
    requiresUserConfirm: true,
  };
}
