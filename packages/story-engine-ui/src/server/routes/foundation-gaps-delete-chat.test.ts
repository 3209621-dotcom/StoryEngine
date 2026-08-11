import { describe, expect, it } from "vitest";
import { buildFoundationGapChatSystemPrompt } from "../lib/prompt-builder.js";
import { __foundationGapsRouteTest } from "./foundation-gaps.js";

const { inferFoundationGapChatIntent, buildDeterministicDeleteReply, normalizeFoundationGapChatResult, isUsefulFoundationModelSuggestion } = __foundationGapsRouteTest;

const writeOptions = {
  protagonistId: "char-guoxu",
  protagonistName: "林远",
  knownCharacters: [
    { id: "char-guoxu", name: "林远" },
    { id: "char-linxiaowei", name: "苏晓薇" },
    { id: "char-zhaolei", name: "赵磊" },
  ],
} as const;

describe("foundation delete chat support", () => {
  it("infers delete intent ahead of create_character", () => {
    expect(inferFoundationGapChatIntent("删除那个角色", undefined)).toBe("delete_foundation_entry");
    expect(inferFoundationGapChatIntent("删除角色苏晓薇", undefined)).toBe("delete_foundation_entry");
    expect(inferFoundationGapChatIntent("移除黑色权限卡这个资产", undefined)).toBe("delete_foundation_entry");
    expect(inferFoundationGapChatIntent("删除这一章", undefined)).not.toBe("delete_foundation_entry");
    expect(inferFoundationGapChatIntent("新角色：导师", undefined)).toBe("create_character");
  });

  it("generates a delete suggestion when exactly one known character matches", () => {
    const result = buildDeterministicDeleteReply("删除角色苏晓薇", writeOptions);
    expect(result.generatedSuggestions).toHaveLength(1);
    const suggestion = result.generatedSuggestions[0];
    expect(suggestion?.actionType).toBe("delete_foundation_entry");
    expect(suggestion?.category).toBe("characters");
    expect(suggestion?.targetId).toBe("char-linxiaowei");
    expect(suggestion?.after).toBeNull();
    expect(suggestion?.targetFile).toBe("story/character-bible.json");
  });

  it("asks back instead of guessing when the target is ambiguous or missing", () => {
    const ambiguous = buildDeterministicDeleteReply("把苏晓薇和赵磊都删掉", writeOptions);
    expect(ambiguous.generatedSuggestions).toHaveLength(0);
    expect(ambiguous.reply).toContain("苏晓薇");
    expect(ambiguous.reply).toContain("赵磊");

    const noMatch = buildDeterministicDeleteReply("把多余的那个删掉", writeOptions);
    expect(noMatch.generatedSuggestions).toHaveLength(0);
    expect(noMatch.reply).toContain("林远");
  });

  it("refuses to draft a protagonist delete in the fallback", () => {
    const result = buildDeterministicDeleteReply("删除林远", writeOptions);
    expect(result.generatedSuggestions).toHaveLength(0);
    expect(result.reply).toContain("主角");
  });

  it("teaches the model about delete_foundation_entry in the system prompt", () => {
    const prompt = buildFoundationGapChatSystemPrompt();
    expect(prompt).toContain("delete_foundation_entry");
    expect(prompt).toContain("targetId");
    expect(prompt).toContain("after 必须是 null");
  });
});

describe("batch suggestion normalization and quality filter", () => {
  const fakeReport = {
    byCategory: { world: [], characters: [], writingRules: [] },
  } as unknown as Parameters<typeof normalizeFoundationGapChatResult>[2];

  const worldRuleSuggestion = (index: number, rule: string) => ({
    category: "world",
    actionType: "update_world_rule",
    after: [rule],
    rationale: `规则${index}`,
    requiresUserConfirm: true,
  });

  it("keeps up to 12 generated suggestions instead of 6", () => {
    const value = {
      reply: "我整理了 13 条。",
      generatedSuggestions: Array.from({ length: 13 }, (_, index) => worldRuleSuggestion(index, `世界规则第${index}条内容`)),
    };
    const result = normalizeFoundationGapChatResult(value, [], fakeReport, "写入吧");
    expect(result.generatedSuggestions).toHaveLength(12);
  });

  it("accepts short rule texts and rejects empty or placeholder content", () => {
    const shortRule = {
      id: "ai-1",
      gapId: "g",
      category: "writingRules",
      actionType: "update_writing_rule",
      targetFile: "story/writing-rules.json",
      targetPath: "$",
      before: undefined,
      after: { doNotDo: ["节奏快"] },
      rationale: "r",
      risk: "info",
      requiresUserConfirm: true,
    };
    expect(isUsefulFoundationModelSuggestion(shortRule as never)).toBe(true);

    const placeholder = { ...shortRule, after: { doNotDo: ["待定"] } };
    expect(isUsefulFoundationModelSuggestion(placeholder as never)).toBe(false);

    const empty = { ...shortRule, after: { doNotDo: ["  "] } };
    expect(isUsefulFoundationModelSuggestion(empty as never)).toBe(false);
  });
});
