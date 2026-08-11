import { describe, expect, it } from "vitest";
import { buildAIReviewerPromptContract } from "../ai-reviewer-prompt-contract.js";
import type { AIReviewInput } from "../ai-reviewer.js";

describe("StoryEngine-NG AI Reviewer Prompt Contract", () => {
  it("builds stable prompts with safety boundaries, allowed actions, and structured state", () => {
    const input = createPromptInput();

    const contract = buildAIReviewerPromptContract(input, {
      tokenBudget: 2048,
      includeExamples: false,
      strictJson: true,
    });

    expect(contract.version).toBe("ai-reviewer-prompt-contract-v1");
    expect(contract.systemPrompt).toContain("StoryEngine-NG AI Reviewer");
    expect(contract.systemPrompt).toContain("Do not rewrite chapter prose");
    expect(contract.systemPrompt).toContain("Do not modify story state");
    expect(contract.systemPrompt).toContain("Only return advisory JSON");
    expect(contract.systemPrompt).toContain("Intent lifecycle diagnostics are advisory-only visibility signals");
    expect(contract.systemPrompt).toContain("Only suggest actions");
    expect(contract.systemPrompt).toContain("safe, actionable maintenance suggestions");
    expect(contract.systemPrompt).toContain("Prefer concrete thread maintenance actions");
    expect(contract.systemPrompt).toContain("Never invent targetIds");
    expect(contract.systemPrompt).toContain("explicit human confirmation");
    expect(contract.userPrompt).toContain("Allowed actions: mark_thread_done, merge_threads, drop_thread");
    expect(contract.userPrompt).toContain("Action decision guidance:");
    expect(contract.userPrompt).toContain("mark_thread_done: use for open/touched threads");
    expect(contract.userPrompt).toContain("merge_threads: use for same-type threads");
    expect(contract.userPrompt).toContain("drop_thread: use only for stale");
    expect(contract.userPrompt).toContain("drop_thread is high risk");
    expect(contract.userPrompt).toContain("Prefer mark_thread_done or merge_threads over drop_thread");
    expect(contract.userPrompt).toContain("candidateKind=true_side_branch_drop_candidate");
    expect(contract.userPrompt).toContain("candidateKind=stale_but_protected_candidate");
    expect(contract.userPrompt).toContain("candidateKind=cleanup_review_candidate");
    expect(contract.userPrompt).toContain("treat it as a priority review group");
    expect(contract.userPrompt).toContain("Do not suggest drop_thread for candidateKind=cleanup_review_candidate");
    expect(contract.userPrompt).toContain("mark_thread_done if possibleDoneEvidence is clear");
    expect(contract.userPrompt).toContain("merge_threads if relatedThreadIdsForMerge is valid");
    expect(contract.userPrompt).toContain("prioritize_thread or no_action");
    expect(contract.userPrompt).toContain("candidateKind=non_drop_candidate");
    expect(contract.userPrompt).toContain("intentDiagnostics summarizes Intent Lifecycle Diagnostics V1.1");
    expect(contract.userPrompt).toContain("Use cleanupCandidateClass only to make advisory prioritize_thread/no_action suggestions");
    expect(contract.userPrompt).toContain("Do not suggest drop_thread only because intentDiagnostics.lifecycleSuggestion");
    expect(contract.userPrompt).toContain("intentDiagnostics.valueClass=high_value_narrative");
    expect(contract.userPrompt).toContain("visibility signals for human maintenance review, not direct confirmation");
    expect(contract.userPrompt).toContain("dropSuitability=safe_candidate");
    expect(contract.userPrompt).toContain("dropSuitability=caution_candidate");
    expect(contract.userPrompt).toContain("dropSuitability=risky_candidate");
    expect(contract.userPrompt).toContain("When uncertain, use prioritize_thread instead of drop_thread");
    expect(contract.userPrompt).toContain("Use prioritize_thread, prioritize_hook, or prioritize_arc_goal only when no safe thread action exists");
    expect(contract.userPrompt).toContain("targetIds must exactly match IDs from the structured input");
    expect(contract.userPrompt).toContain("Return only JSON");
    expect(contract.userPrompt).toContain("Do not use markdown");
    expect(contract.userPrompt).toContain("recentTimelineEvents");
    expect(contract.userPrompt).toContain("hooks");
    expect(contract.userPrompt).toContain("threads");
    expect(contract.userPrompt).toContain("intentDiagnostics");
    expect(contract.userPrompt).toContain("cleanupCandidateClass");
    expect(contract.userPrompt).toContain("cleanupReason");
    expect(contract.userPrompt).toContain("cleanupReviewCandidates");
    expect(contract.userPrompt).toContain("arcGoals");
    expect(contract.userPrompt).toContain("continuityQuality");
    expect(contract.userPrompt).toContain("candidateDiagnostics");
    expect(contract.userPrompt).toContain("The full chapter body and full draft content are intentionally omitted");
    expect(contract.userPrompt).not.toContain("正文全文".repeat(40));
    expect(contract.inputSummary).toMatchObject({
      scope: "window",
      chapter: 12,
      timelineEventCount: 5,
      hookCount: 10,
      threadCount: 24,
      intentDiagnosticsPresent: true,
      intentDiagnosticItemCount: 2,
      cleanupVisibleIntentCount: 1,
      arcGoalCount: 8,
      tokenBudget: 2048,
    });
  });

  it("truncates evidence and includes examples only when requested", () => {
    const withoutExamples = buildAIReviewerPromptContract(createPromptInput(), { includeExamples: false });
    const withExamples = buildAIReviewerPromptContract(createPromptInput(), { includeExamples: true });

    expect(withoutExamples.userPrompt).not.toContain("Short examples:");
    expect(withExamples.userPrompt).toContain("Short examples:");
    expect(withExamples.userPrompt).toContain("mark_thread_done");
    expect(withExamples.userPrompt).toContain("merge_threads");
    expect(withExamples.userPrompt).toContain("no_action");
    expect(withExamples.userPrompt).toContain("thread-a");
    expect(withExamples.userPrompt).toContain("thread-b");
    expect(withExamples.userPrompt).toContain("No exact matching targetId exists");
    expect(withExamples.userPrompt).not.toContain("证据".repeat(120));
  });

  it("describes the response schema required from future providers", () => {
    const contract = buildAIReviewerPromptContract(createPromptInput());

    expect(contract.responseSchema).toMatchObject({
      type: "object",
      required: ["passed", "scope", "issues", "suggestions", "summary"],
      properties: {
        issues: expect.any(Object),
        suggestions: expect.any(Object),
        summary: { type: "string" },
      },
    });
    expect(JSON.stringify(contract.responseSchema)).toContain("mark_thread_done");
    expect(JSON.stringify(contract.responseSchema)).toContain("merge_threads");
  });

  it("filters credential-like fields, values, and local user paths", () => {
    const credentialValue = ["sk", "-"].join("");
    const input = createPromptInput({
      diagnostics: {
        [["api", "key"].join("")]: "bad",
        nested: {
          path: "/Users/example/private/project",
          note: `${credentialValue}placeholder should be hidden`,
        },
      },
    });

    const contract = buildAIReviewerPromptContract(input);

    expect(contract.userPrompt).not.toContain("bad");
    expect(contract.userPrompt).not.toContain(credentialValue);
    expect(contract.userPrompt).toContain("/Users/[user]");
  });
});

function createPromptInput(overrides: Partial<AIReviewInput> = {}): AIReviewInput {
  return {
    projectId: "prompt-fixture",
    chapter: 12,
    scope: "window",
    recentTimelineEvents: Array.from({ length: 7 }, (_, index) => ({
      id: `event-${index}`,
      chapter: index + 1,
      summary: `林远在账房推进账目线索 ${index}`,
      participants: ["林远"],
    })),
    semanticSummaries: Array.from({ length: 7 }, (_, index) => ({
      chapter: index + 1,
      mainEvent: `林远发现后墙暗号 ${index}`,
      chapterSummary: `结构化摘要 ${index}`,
      body: "正文全文".repeat(60),
    })),
    hookPool: {
      hooks: Array.from({ length: 12 }, (_, index) => ({
        id: `hook-${index}`,
        title: `暗号伏笔 ${index}`,
        description: `账房暗号证据 ${"证据".repeat(120)}`,
        status: "active" as const,
        relatedCharacters: ["林远"],
      })),
    },
    threadPool: {
      threads: Array.from({ length: 30 }, (_, index) => ({
        id: `thread-${index}`,
        type: "intent" as const,
        title: `去库房调查账册 ${index}`,
        status: "open" as const,
        firstSeenChapter: 1,
        lastTouchedChapter: index + 1,
        evidence: [
          `林远准备去库房调查账册 ${"证据".repeat(120)}`,
          "第二条 evidence",
          "第三条 evidence",
          "第四条 evidence 应被裁剪",
        ],
      })),
      selection: {
        totalThreadCount: 30,
        selectedThreadCount: 24,
        recentCount: 6,
        staleCandidateCount: 5,
        mergeCandidateCount: 6,
        doneCandidateCount: 5,
        cleanupReviewCandidates: [
          {
            threadId: "thread-cleanup",
            title: "过期旁枝",
            status: "open",
            threadType: "intent",
            createdChapter: 1,
            lastTouchedChapter: 2,
            ageInChapters: 10,
            evidenceCount: 1,
            nextActionHintLifecycle: "expired_candidate",
            cleanupReasons: ["expired_next_action_hint_candidate"],
            suggestedCleanupActions: ["prioritize_thread"],
            whyNotDrop: "not a safe drop",
            whyNeedsReview: "expired hint needs review",
            relatedThreadIdsForMerge: [],
            possibleDoneEvidence: [],
            priorityScore: 30,
          },
        ],
        selectedCleanupCandidateCount: 1,
        cleanupCandidateSelectionReasons: { "thread-cleanup": ["stale_candidate"] },
        cleanupCandidateSkippedReasons: {},
        mergeCandidateGroupCount: 2,
        selectionReasons: {},
        mergeGroups: [],
      },
    },
    intentDiagnostics: {
      summary: {
        present: true,
        advisoryOnly: true,
        totalIntents: 2,
        openIntentCount: 2,
        touchedIntentCount: 0,
        doneIntentCount: 0,
        cleanupVisibleCount: 1,
        protectedHighValueCount: 1,
        valueClassCounts: {
          low_value_generic: 1,
          medium_value_action: 0,
          high_value_narrative: 1,
        },
        typeCategoryCounts: {
          generic_decision: 1,
          generic_motion: 0,
          resource_goal: 0,
          location_goal: 0,
          signal_or_clue_goal: 1,
          character_interaction: 0,
          risk_or_survival_goal: 0,
          stale_or_obsolete: 0,
        },
        lifecycleSuggestionCounts: {
          keep_open_or_touched: 1,
          mark_done_candidate: 0,
          drop_candidate: 1,
          auto_expire_candidate: 0,
          low_priority_keep: 0,
          do_not_pool_or_low_priority: 0,
        },
        cleanupCandidateCounts: {
          none: 1,
          cleanup_candidate: 1,
          manual_review_drop_candidate: 0,
          stale_low_value_candidate: 0,
          stale_generic_candidate: 0,
          manual_review_mark_done_candidate: 0,
        },
        summaryText: "Intent lifecycle diagnostics fixture.",
      },
      items: [
        {
          id: "thread-cleanup",
          title: "决定先回去",
          status: "open",
          valueClass: "low_value_generic",
          typeCategory: "generic_decision",
          lifecycleSuggestion: "drop_candidate",
          cleanupCandidateClass: "cleanup_candidate",
          cleanupReason: "Generic intent should be visible to maintenance review.",
          staleReason: "Low-value generic intent is a cleanup candidate; diagnostics only.",
          safetyNotes: ["requires_human_or_maintenance_confirmation"],
          ageInChapters: 10,
          hasNextActionHint: false,
          evidenceStrength: "weak",
        },
        {
          id: "thread-signal",
          title: "确认无线电信号来源",
          status: "open",
          valueClass: "high_value_narrative",
          typeCategory: "signal_or_clue_goal",
          lifecycleSuggestion: "keep_open_or_touched",
          cleanupCandidateClass: "none",
          cleanupReason: "none",
          staleReason: "none",
          safetyNotes: ["high_value_narrative_intent"],
          ageInChapters: 1,
          hasNextActionHint: true,
          evidenceStrength: "strong",
        },
      ],
    },
    arcGoalPool: {
      goals: Array.from({ length: 10 }, (_, index) => ({
        id: `arc-${index}`,
        title: `查清资源账目 ${index}`,
        status: "active" as const,
        scope: "mini_arc" as const,
        firstSeenChapter: 1,
        lastTouchedChapter: index + 1,
        evidence: [`目标证据 ${index}`],
      })),
    },
    continuityQuality: { score: 0.91, issues: [] },
    diagnostics: {
      candidateDiagnostics: {
        reviewerStage: { executableSuggestionCount: 2 },
      },
    },
    tokenBudget: 4096,
    ...overrides,
  };
}
