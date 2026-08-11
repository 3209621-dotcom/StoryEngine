import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildMemoryReadViewModel } from "./memory-read-viewmodel.js";

const packageRoot = process.cwd();

async function source(relativePath: string): Promise<string> {
  return readFile(resolve(packageRoot, relativePath), "utf-8");
}

describe("Memory Read ViewModel fixture helper", () => {
  it("builds a read-only ViewModel from fixture memory inputs", () => {
    const viewModel = buildMemoryReadViewModel({
      lastUpdated: "2026-05-25T12:00:00.000Z",
      userPreferences: [
        {
          id: "pref-voice",
          text: "用户偏好节奏紧凑、少解释。",
          confidence: 0.95,
          relevanceScore: 0.9,
        },
      ],
      projectRules: [
        {
          id: "rule-no-god-view",
          text: "不要使用上帝视角解释谜底。",
          confidence: 0.9,
          relevanceScore: 0.86,
        },
      ],
      characterFacts: [
        {
          id: "char-xiaomo",
          text: "小墨怕水，但会强撑镇定。",
          confidence: 0.88,
          relevanceScore: 0.8,
        },
      ],
      worldFacts: [
        {
          id: "world-token",
          text: "后院信物只能由守林人辨认。",
          confidence: 0.84,
          relevanceScore: 0.76,
        },
      ],
      writingStylePreferences: [
        {
          id: "style-dialogue",
          text: "对白要短，动作承接要明确。",
          confidence: 0.91,
          relevanceScore: 0.82,
        },
      ],
      unresolvedContinuityNotes: [
        {
          id: "continuity-ledger",
          text: "账本线索暂时不能揭开。",
          confidence: 0.87,
          relevanceScore: 0.95,
        },
      ],
      recentAcceptedMemoryProposals: [
        {
          id: "accepted-1",
          text: "用户接受了后院信物方向。",
          confidence: 0.93,
          relevanceScore: 0.78,
        },
      ],
      rejectedSkippedMemoryProposals: [
        {
          id: "rejected-1",
          text: "跳过把账本提前公开的提案。",
          confidence: 0.89,
          relevanceScore: 0.8,
        },
      ],
    });

    expect(viewModel.readOnly).toBe(true);
    expect(viewModel.canWrite).toBe(false);
    expect(viewModel.canInjectAutomatically).toBe(false);
    expect(viewModel.summary).toContain("8 条只读记忆");
    expect(viewModel.lastUpdated).toBe("2026-05-25T12:00:00.000Z");
    expect(viewModel.relevantMemories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "pref-voice", type: "user_preference", sourceId: "pref-voice" }),
        expect.objectContaining({ id: "rule-no-god-view", type: "project_rule" }),
        expect.objectContaining({ id: "char-xiaomo", type: "character_fact" }),
        expect.objectContaining({ id: "world-token", type: "world_fact" }),
        expect.objectContaining({ id: "style-dialogue", type: "writing_style_preference" }),
        expect.objectContaining({ id: "continuity-ledger", type: "unresolved_continuity_note" }),
        expect.objectContaining({ id: "accepted-1", type: "recent_accepted_memory_proposal" }),
        expect.objectContaining({ id: "rejected-1", type: "rejected_skipped_memory_proposal" }),
      ]),
    );
    expect(viewModel.sourceIds).toEqual([
      "continuity-ledger",
      "pref-voice",
      "accepted-1",
      "style-dialogue",
      "rule-no-god-view",
      "rejected-1",
      "char-xiaomo",
      "world-token",
    ]);
    expect(viewModel.confidence).toBeGreaterThan(0.8);
    expect(viewModel.relevanceScore).toBeGreaterThan(0.8);
  });

  it("keeps rejected and skipped proposals read-only", () => {
    const viewModel = buildMemoryReadViewModel({
      rejectedSkippedMemoryProposals: [
        {
          id: "skipped-style",
          text: "用户跳过了强化旁白的记忆提案。",
          confidence: 0.7,
          relevanceScore: 0.75,
        },
      ],
    });

    expect(viewModel.readOnly).toBe(true);
    expect(viewModel.canWrite).toBe(false);
    expect(viewModel.canInjectAutomatically).toBe(false);
    expect(viewModel.relevantMemories).toEqual([
      expect.objectContaining({
        id: "skipped-style",
        type: "rejected_skipped_memory_proposal",
        readOnly: true,
        canWrite: false,
        canInjectAutomatically: false,
      }),
    ]);
  });

  it("returns a safe empty ViewModel from an empty fixture", () => {
    const viewModel = buildMemoryReadViewModel({});

    expect(viewModel).toEqual({
      summary: "暂无可用只读记忆上下文。",
      relevantMemories: [],
      warnings: [],
      sourceIds: [],
      confidence: 0,
      relevanceScore: 0,
      lastUpdated: null,
      readOnly: true,
      canWrite: false,
      canInjectAutomatically: false,
    });
  });

  it("represents memory read failure as a warning without blocking Markdown apply", () => {
    const viewModel = buildMemoryReadViewModel({
      readFailed: true,
      failureMessage: "本地 memory fixture 不可用",
      userPreferences: [
        {
          id: "pref-existing",
          text: "保留已有可用 fixture 项。",
          confidence: 0.8,
          relevanceScore: 0.7,
        },
      ],
    });

    expect(viewModel.warnings).toContain("Memory read failed: 本地 memory fixture 不可用");
    expect(viewModel.warnings).toContain("Memory read failure cannot block Markdown apply.");
    expect(viewModel.readOnly).toBe(true);
    expect(viewModel.canWrite).toBe(false);
    expect(viewModel.canInjectAutomatically).toBe(false);
    expect(viewModel.relevantMemories).toHaveLength(1);
  });

  it("keeps the helper free of I/O, API, server route, apply, and formal commit calls", async () => {
    const helperSource = await source("src/agent-command-center/memory-read-viewmodel.ts");

    expect(helperSource).not.toContain("writeFile");
    expect(helperSource).not.toContain("fs.write");
    expect(helperSource).not.toContain("fetch(");
    expect(helperSource).not.toContain("applyWorkspacePatch");
    expect(helperSource).not.toContain("commitFastDraft");
    expect(helperSource).not.toContain("applyCommit");
    expect(helperSource).not.toContain("CommitEngine");
    expect(helperSource).not.toContain("server/routes");
    expect(helperSource).not.toContain("state JSON write");
    expect(helperSource).not.toContain("memory write");
  });
});
