import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeThreadPoolForMaintenance,
  buildAIReviewInput,
  createDeepSeekAIReviewerProvider,
  createMockAIReviewer,
  getAIReviewerProvider,
  listAIReviewerProviders,
  registerAIReviewerProvider,
  runAIReviewerWithProvider,
  validateAIReviewReport,
} from "../ai-reviewer.js";
import type { AIReviewerFetchLike, AIReviewerProvider, AIReviewInput, AIReviewReport } from "../ai-reviewer.js";
import { createStoryProject, toSafeCharacterId } from "../project-store.js";
import type { ArcGoalPool, HookPool, ThreadPool, TimelineEvent } from "../types.js";

describe("StoryEngine-NG AI Reviewer Interface", () => {
  it("builds a bounded review input from structured project state", async () => {
    const projectDir = await createReviewFixture();

    const input = await buildAIReviewInput(projectDir, {
      chapter: 12,
      scope: "window",
      recentChapters: 5,
      tokenBudget: 4096,
    });

    expect(input).toMatchObject({
      projectId: "ai-review-fixture",
      chapter: 12,
      scope: "window",
      tokenBudget: 4096,
    });
    expect(input.recentTimelineEvents).toHaveLength(5);
    expect(input.semanticSummaries).toHaveLength(5);
    expect(input.recentTimelineEvents[0]?.effects?.semanticSummary).toMatchObject({
      mainEvent: expect.stringContaining("第12章"),
    });
    expect(input.hookPool.hooks.length).toBeLessThanOrEqual(10);
    expect(input.threadPool.threads.length).toBeLessThanOrEqual(24);
    expect(input.intentDiagnostics).toMatchObject({
      summary: {
        present: true,
        advisoryOnly: true,
        totalIntents: expect.any(Number),
        cleanupVisibleCount: expect.any(Number),
        cleanupCandidateCounts: expect.any(Object),
      },
      items: expect.arrayContaining([
        expect.objectContaining({
          id: expect.any(String),
          title: expect.any(String),
          status: expect.any(String),
          valueClass: expect.any(String),
          typeCategory: expect.any(String),
          lifecycleSuggestion: expect.any(String),
          cleanupCandidateClass: expect.any(String),
          cleanupReason: expect.any(String),
          staleReason: expect.any(String),
          safetyNotes: expect.any(Array),
          ageInChapters: expect.any(Number),
          hasNextActionHint: expect.any(Boolean),
          evidenceStrength: expect.any(String),
        }),
      ]),
    });
    expect(input.threadPool.selection).toMatchObject({
      totalThreadCount: expect.any(Number),
      selectedThreadCount: input.threadPool.threads.length,
      recentCount: expect.any(Number),
      staleCandidateCount: expect.any(Number),
      mergeCandidateCount: expect.any(Number),
      doneCandidateCount: expect.any(Number),
      mergeCandidateGroupCount: expect.any(Number),
    });
    expect(input.arcGoalPool.goals.length).toBeLessThanOrEqual(8);
    expect(input.threadPool.threads[0]?.evidence[0]?.length).toBeLessThanOrEqual(121);
  });

  it("selects recent, stale/drop, merge, and done thread candidates with bounded metadata", async () => {
    const projectDir = await createThreadSelectionFixture();

    const input = await buildAIReviewInput(projectDir, {
      chapter: 30,
      scope: "window",
    });
    const selectedIds = input.threadPool.threads.map((item) => item.id);

    expect(input.threadPool.threads.length).toBeLessThanOrEqual(24);
    expect(selectedIds).toContain("recent-0");
    expect(selectedIds).toContain("drop-old");
    expect(selectedIds).toEqual(expect.arrayContaining(["merge-old-a", "merge-old-b"]));
    expect(selectedIds).toContain("done-old");
    expect(input.threadPool.selection).toMatchObject({
      totalThreadCount: expect.any(Number),
      selectedThreadCount: input.threadPool.threads.length,
      recentCount: 6,
      staleCandidateCount: expect.any(Number),
      mergeCandidateCount: expect.any(Number),
      doneCandidateCount: expect.any(Number),
      mergeCandidateGroupCount: expect.any(Number),
      selectionReasons: expect.objectContaining({
        "drop-old": expect.arrayContaining(["stale_candidate"]),
        "merge-old-a": expect.arrayContaining(["merge_candidate"]),
        "merge-old-b": expect.arrayContaining(["merge_candidate"]),
        "done-old": expect.arrayContaining(["done_candidate"]),
      }),
    });
  });

  it("exposes stale low-value drop candidates with safe/caution/risky metadata", async () => {
    const projectDir = await createCandidateExposureFixture();

    const input = await buildAIReviewInput(projectDir, {
      chapter: 24,
      scope: "window",
    });
    const byId = new Map(input.threadPool.threads.map((item) => [item.id, item]));

    expect(input.threadPool.selection).toMatchObject({
      staleLowValueCandidateCount: expect.any(Number),
      safeDropCandidateCount: expect.any(Number),
      cautionDropCandidateCount: expect.any(Number),
      riskyDropCandidateCount: expect.any(Number),
      selectedCleanupCandidateCount: expect.any(Number),
      cleanupReviewCandidates: expect.any(Array),
      cleanupCandidateSelectionReasons: expect.any(Object),
      cleanupCandidateSkippedReasons: expect.any(Object),
      selectedDropCandidateIds: expect.arrayContaining(["drop-safe-low-value"]),
    });
    expect(byId.get("drop-safe-low-value")).toMatchObject({
      candidateKind: "true_side_branch_drop_candidate",
      dropSuitability: "safe_candidate",
      hasNextActionHint: false,
      linkedActiveHookCount: 0,
      linkedActiveArcGoalCount: 0,
      hasStrongMainlineKeyword: false,
    });
    expect(byId.get("drop-next-hint")).toMatchObject({
      candidateKind: "cleanup_review_candidate",
      dropSuitability: "caution_candidate",
      safetyNotes: expect.arrayContaining(["expired_next_action_hint_candidate"]),
      nextActionHintDiagnostic: expect.objectContaining({
        threadId: "drop-next-hint",
        nextActionHint: "下次去园圃问清。",
        nextActionHintCreatedChapter: "unknown",
        nextActionHintSource: "unknown",
        nextActionHintLifecycle: "expired_candidate",
        nextActionHintRecentlyMentioned: false,
        nextActionHintStrongHookOverlap: false,
        nextActionHintStrongArcOverlap: false,
        shouldExpireNextActionHintCandidate: true,
        nextActionHintExpiryReason: "old_open_low_evidence_hint_without_recent_objective_or_strong_link",
      }),
    });
    expect(byId.get("drop-expired-hint-side-branch")).toMatchObject({
      candidateKind: "true_side_branch_drop_candidate",
      dropSuitability: "safe_candidate",
      hasNextActionHint: true,
      nextActionHintLifecycle: "expired_candidate",
      nextActionHintDiagnostic: expect.objectContaining({
        threadId: "drop-expired-hint-side-branch",
        nextActionHintLifecycle: "expired_candidate",
        nextActionHintExpiryReason: "old_open_low_evidence_hint_without_recent_objective_or_strong_link",
      }),
    });
    expect(byId.get("drop-active-hook")).toMatchObject({
      candidateKind: "stale_but_protected_candidate",
      dropSuitability: "risky_candidate",
      safetyNotes: expect.arrayContaining(["linked_active_hook"]),
      nextActionHintLifecycle: "active",
      nextActionHintDiagnostic: expect.objectContaining({
        nextActionHintLifecycle: "active",
        nextActionHintStrongHookOverlap: true,
        nextActionHintRetentionReason: "strong_active_hook_overlap",
      }),
      activeHookLinkageDiagnostics: expect.arrayContaining([
        expect.objectContaining({
          threadId: "drop-active-hook",
          hookId: "hook-active-drug",
          linkageStrength: "strong",
          threadType: "intent",
          hookStatus: "active",
          uniqueSpecificKeywordHits: expect.arrayContaining(["园圃脚印"]),
          mainlineKeywordHits: expect.any(Array),
          genericKeywordHits: expect.any(Array),
          isSpecificEntityOverlap: true,
          shouldRemainStrong: true,
          shouldBeStrongProtected: true,
        }),
      ]),
    });
    expect(byId.get("drop-active-arc")).toMatchObject({
      candidateKind: "stale_but_protected_candidate",
      dropSuitability: "risky_candidate",
      safetyNotes: expect.arrayContaining(["linked_active_arc_goal"]),
    });
    expect(byId.get("drop-touched-carry")).toMatchObject({
      candidateKind: "stale_but_protected_candidate",
      dropSuitability: "risky_candidate",
      safetyNotes: expect.arrayContaining(["active_next_action_hint", "carry_forward_or_touched_thread"]),
      nextActionHintLifecycle: "active",
      nextActionHintDiagnostic: expect.objectContaining({
        threadId: "drop-touched-carry",
        nextActionHintLifecycle: "active",
        nextActionHintRecentlyMentioned: true,
        nextActionHintRetentionReason: "carry_forward_thread",
      }),
    });
    expect(byId.get("drop-weak-mainline")).toMatchObject({
      candidateKind: "cleanup_review_candidate",
      dropSuitability: "caution_candidate",
      safetyNotes: expect.arrayContaining(["weak_mainline_keyword"]),
      hasStrongMainlineKeyword: false,
    });
    expect(byId.get("drop-weak-hook-overlap")).toMatchObject({
      candidateKind: "cleanup_review_candidate",
      dropSuitability: "caution_candidate",
      safetyNotes: expect.arrayContaining(["weak_active_hook_overlap"]),
      linkedActiveHookCount: 0,
      activeHookLinkageDiagnostics: expect.arrayContaining([
        expect.objectContaining({
          hookId: "hook-active-weak-overlap",
          linkageStrength: "weak",
          isGenericMainlineOnlyOverlap: expect.any(Boolean),
          possibleDowngradeReason: expect.anything(),
          shouldDowngradeToCleanupCandidate: true,
        }),
      ]),
    });
    expect(byId.get("drop-many-evidence")).toMatchObject({
      candidateKind: "cleanup_review_candidate",
      dropSuitability: "caution_candidate",
      safetyNotes: expect.arrayContaining(["multiple_evidence_items"]),
    });
    expect(byId.get("drop-mainline")).toMatchObject({
      candidateKind: "stale_but_protected_candidate",
      dropSuitability: "risky_candidate",
      safetyNotes: expect.arrayContaining(["strong_mainline_keyword"]),
      strongMainlineKeywordHits: expect.arrayContaining(["账房", "信物"]),
    });
    expect(input.threadPool.selection?.dropCandidateClassificationSummary).toMatchObject({
      riskyReasonCounts: expect.objectContaining({
        strong_mainline_keyword: expect.any(Number),
        linked_active_hook: expect.any(Number),
        linked_active_arc_goal: expect.any(Number),
      }),
      cautionReasonCounts: expect.objectContaining({
        weak_mainline_keyword: expect.any(Number),
        multiple_evidence_items: expect.any(Number),
      }),
      topRiskyCandidates: expect.any(Array),
      topProtectedCandidates: expect.any(Array),
      topCleanupCandidates: expect.any(Array),
      cleanupReviewCandidates: expect.arrayContaining([
        expect.objectContaining({
          threadId: "drop-next-hint",
          nextActionHintLifecycle: "expired_candidate",
          suggestedCleanupActions: expect.arrayContaining(["prioritize_thread"]),
          whyNotDrop: expect.stringContaining("drop"),
          whyNeedsReview: expect.stringContaining("expired"),
          relatedThreadIdsForMerge: expect.any(Array),
          possibleDoneEvidence: expect.any(Array),
          priorityScore: expect.any(Number),
        }),
      ]),
      stickinessDiagnosticsSummary: expect.objectContaining({
        nextActionHintProtectedCount: expect.any(Number),
        activeHookProtectedCount: expect.any(Number),
        strongHookLinkCount: expect.any(Number),
        weakHookLinkCount: expect.any(Number),
        possibleOverProtectedThreadCount: expect.any(Number),
        topNextActionHintTexts: expect.any(Object),
        topSharedHookKeywords: expect.any(Object),
        overProtectionReasonCounts: expect.any(Object),
        totalHookLinks: expect.any(Number),
        specificEntityStrongLinkCount: expect.any(Number),
        mainlineOnlyStrongLinkCount: expect.any(Number),
        genericOnlyStrongLinkCount: expect.any(Number),
        locationOnlyStrongLinkCount: expect.any(Number),
        actorOnlyStrongLinkCount: expect.any(Number),
        possibleDowngradeStrongLinkCount: expect.any(Number),
        refinedStrongHookLinkCount: expect.any(Number),
        refinedCautionHookLinkCount: expect.any(Number),
        refinedWeakHookLinkCount: expect.any(Number),
        refinedNoneHookLinkCount: expect.any(Number),
        downgradedFromStrongCount: expect.any(Number),
        downgradeReasonCounts: expect.any(Object),
        nextActionHintActiveCount: expect.any(Number),
        nextActionHintStaleCount: expect.any(Number),
        nextActionHintExpiredCandidateCount: expect.any(Number),
        nextActionHintUnknownCount: expect.any(Number),
        downgradedNextActionHintProtectionCount: expect.any(Number),
        expiryReasonCounts: expect.any(Object),
        retentionReasonCounts: expect.any(Object),
        topGenericKeywords: expect.any(Object),
        topMainlineKeywords: expect.any(Object),
        hookLinkFanoutByThread: expect.any(Object),
        hookLinkFanoutByHook: expect.any(Object),
        highFanoutHookIds: expect.any(Array),
        highFanoutThreadIds: expect.any(Array),
      }),
      nextActionHintDiagnostics: expect.arrayContaining([
        expect.objectContaining({ threadId: "drop-next-hint", nextActionHintLifecycle: "expired_candidate" }),
        expect.objectContaining({ threadId: "drop-touched-carry", nextActionHintLifecycle: "active" }),
      ]),
      activeHookLinkageDiagnostics: expect.arrayContaining([
        expect.objectContaining({ hookId: "hook-active-drug" }),
      ]),
      safeCandidateMissingReasons: expect.any(Array),
      wouldBeSafeExceptForReasonCounts: expect.any(Object),
      riskReasonCombinationCounts: expect.any(Object),
      trueSideBranchDropCandidateCount: expect.any(Number),
      staleButProtectedCandidateCount: expect.any(Number),
      cleanupReviewCandidateCount: expect.any(Number),
      protectedReasonCounts: expect.any(Object),
      cleanupReasonCounts: expect.any(Object),
      dropCandidateClassifications: expect.arrayContaining([
        expect.objectContaining({
          threadId: "drop-safe-low-value",
          candidateKind: "true_side_branch_drop_candidate",
          dropSuitability: "safe_candidate",
        }),
        expect.objectContaining({
          threadId: "drop-next-hint",
          candidateKind: "cleanup_review_candidate",
          suggestedCleanupActions: expect.arrayContaining(["prioritize_thread"]),
        }),
      ]),
    });
  });

  it("mock reviewer turns selected maintenance candidates into mark, merge, and drop actions", async () => {
    const projectDir = await createThreadSelectionFixture();
    const input = await buildAIReviewInput(projectDir, {
      chapter: 30,
      scope: "window",
    });

    const report = await createMockAIReviewer().review(input);

    expect(report.threadSelectionSummary).toEqual(input.threadPool.selection);
    expect(report.actionabilitySummary).toMatchObject({
      executableActionCount: expect.any(Number),
      markThreadDoneCount: expect.any(Number),
      mergeThreadsCount: expect.any(Number),
      dropThreadCount: expect.any(Number),
      prioritizeCount: expect.any(Number),
    });
    expect(report.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "mark_thread_done", targetIds: ["done-old"] }),
      expect.objectContaining({ action: "merge_threads", targetIds: expect.arrayContaining(["merge-old-a", "merge-old-b"]) }),
      expect.objectContaining({ action: "drop_thread" }),
    ]));
    expect(report.actionabilitySummary?.executableActionCount).toBeGreaterThan(0);
    const diagnostics = report.candidateDiagnostics!;
    expect(diagnostics.threadPoolTotal).toEqual(expect.any(Number));
    expect(diagnostics.selectedThreadCount).toBe(input.threadPool.threads.length);
    expect(diagnostics.selectionStage.selectedThreadIds).toEqual(expect.arrayContaining(["done-old", "merge-old-a", "merge-old-b"]));
    expect(diagnostics.selectionStage.doneCandidateCount).toEqual(expect.any(Number));
    expect(diagnostics.selectionStage.mergeCandidateCount).toEqual(expect.any(Number));
    expect(diagnostics.selectionStage.staleCandidateCount).toEqual(expect.any(Number));
    expect(diagnostics.analysisStage.doneCandidates).toContain("done-old");
    expect(diagnostics.analysisStage.mergeGroups).toEqual(expect.arrayContaining([
      expect.arrayContaining(["merge-old-a", "merge-old-b"]),
    ]));
    expect(diagnostics.analysisStage.dropCandidates.length).toBeGreaterThan(0);
    expect(diagnostics.reviewerStage).toMatchObject({
      suggestionCount: report.suggestions.length,
      executableSuggestionCount: expect.any(Number),
      markThreadDoneCount: expect.any(Number),
      mergeThreadsCount: expect.any(Number),
      dropThreadCount: expect.any(Number),
    });
    expect(diagnostics.reviewPlanStage).toMatchObject({
      actionCount: 0,
      recommendedActionIds: [],
    });
  });

  it("mock reviewer treats intent lifecycle cleanup candidates as advisory-only", async () => {
    const report = await createMockAIReviewer().review(createMinimalInput({
      chapter: 12,
      threads: [
        thread({
          id: "intent-cleanup",
          title: "决定先回去",
          evidence: ["林澈想了想，决定先回去。"],
          lastTouchedChapter: 1,
        }),
      ],
      intentDiagnostics: createIntentDiagnostics([
        {
          id: "intent-cleanup",
          title: "决定先回去",
          valueClass: "low_value_generic",
          typeCategory: "generic_decision",
          lifecycleSuggestion: "drop_candidate",
          cleanupCandidateClass: "cleanup_candidate",
          cleanupReason: "Generic intent should be visible to maintenance review.",
          staleReason: "Low-value generic intent is a cleanup candidate; diagnostics only.",
          ageInChapters: 11,
        },
      ]),
    }));

    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "intent-lifecycle-intent-cleanup",
        type: "stale_thread",
        targetIds: ["intent-cleanup"],
        suggestion: expect.stringContaining("advisory-only"),
      }),
    ]));
    expect(report.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "prioritize_thread", targetIds: ["intent-cleanup"] }),
    ]));
    expect(report.suggestions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "mark_thread_done", targetIds: ["intent-cleanup"] }),
    ]));
    expect(report.candidateDiagnostics?.intentDiagnostics).toMatchObject({
      present: true,
      usedByReviewer: true,
      advisoryOnly: true,
      cleanupVisibleCount: 1,
      visibleItemCount: 1,
      advisorySuggestionCount: 1,
    });
  });

  it("protects high-value intent diagnostics from cleanup suggestions", async () => {
    const report = await createMockAIReviewer().review(createMinimalInput({
      chapter: 12,
      threads: [
        thread({
          id: "intent-signal",
          title: "追踪无线电信号来源",
          evidence: ["对讲机收到断续广播，林澈沿着信号源继续推进。"],
          lastTouchedChapter: 12,
          nextActionHint: "继续追踪无线电信号来源。",
        }),
      ],
      intentDiagnostics: createIntentDiagnostics([
        {
          id: "intent-signal",
          title: "追踪无线电信号来源",
          valueClass: "high_value_narrative",
          typeCategory: "signal_or_clue_goal",
          lifecycleSuggestion: "keep_open_or_touched",
          cleanupCandidateClass: "cleanup_candidate",
          cleanupReason: "test fixture should still be protected because value is high.",
          ageInChapters: 0,
          safetyNotes: ["high_value_narrative_intent"],
        },
      ]),
    }));

    expect(report.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "intent-lifecycle-intent-signal" }),
    ]));
    expect(report.suggestions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ targetIds: ["intent-signal"] }),
    ]));
    expect(report.candidateDiagnostics?.intentDiagnostics).toMatchObject({
      protectedHighValueCount: 1,
      cleanupVisibleCount: 1,
      advisorySuggestionCount: 0,
    });
  });

  it("mock reviewer suggests stale, merge, done, hook, and arc actions without mutating project state", async () => {
    const projectDir = await createReviewFixture();
    const before = await snapshotStructuredState(projectDir);
    const input = await buildAIReviewInput(projectDir, {
      chapter: 12,
      scope: "window",
    });

    const report = await createMockAIReviewer().review(input);

    expect(report.passed).toBe(true);
    expect(report.scope).toBe("window");
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "stale_thread",
      }),
      expect.objectContaining({
        type: "thread_should_merge",
        targetIds: expect.arrayContaining(["thread-merge-b"]),
      }),
      expect.objectContaining({
        type: "thread_should_be_done",
        targetIds: expect.arrayContaining(["thread-done-candidate"]),
      }),
      expect.objectContaining({
        type: "hook_stale",
        targetIds: expect.arrayContaining(["hook-stale"]),
      }),
      expect.objectContaining({
        type: "arc_goal_drift",
        targetIds: expect.arrayContaining(["arc-drift"]),
      }),
    ]));
    expect(report.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "prioritize_thread" }),
      expect.objectContaining({ action: "merge_threads" }),
      expect.objectContaining({ action: "mark_thread_done" }),
      expect.objectContaining({ action: "prioritize_hook" }),
      expect.objectContaining({ action: "prioritize_arc_goal" }),
    ]));
    expect(report.actionabilitySummary).toMatchObject({
      executableActionCount: expect.any(Number),
      markThreadDoneCount: expect.any(Number),
      mergeThreadsCount: expect.any(Number),
      dropThreadCount: expect.any(Number),
      prioritizeCount: expect.any(Number),
    });
    await expect(snapshotStructuredState(projectDir)).resolves.toEqual(before);
  });

  it("analyzes thread pools for actionable done, merge, and drop candidates", () => {
    const analysis = analyzeThreadPoolForMaintenance({
      threads: [
        thread({ id: "done-a", title: "账房暗号来源", evidence: ["林远已经查清账房暗号来源，线索闭合。"], lastTouchedChapter: 20 }),
        thread({ id: "merge-a", title: "林远决定去库房调查账册", evidence: ["林远决定去库房调查账册。"], lastTouchedChapter: 20 }),
        thread({ id: "merge-b", title: "明日去库房查清账册", evidence: ["明日去库房查清账册。"], lastTouchedChapter: 20 }),
        thread({ id: "drop-a", title: "继续观察情况", evidence: ["以后再看。"], lastTouchedChapter: 1 }),
      ],
    }, { chapter: 20 });

    expect(analysis.doneCandidates).toContain("done-a");
    expect(analysis.mergeGroups).toEqual(expect.arrayContaining([
      expect.arrayContaining(["merge-a", "merge-b"]),
    ]));
    expect(analysis.dropCandidates).toContain("drop-a");
    expect(analysis.reasons["drop-a"]).toContain("low-value");
    expect(analysis.rejectedDoneCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "merge-a", blocker: "future_intent" }),
    ]));
    expect(analysis.rejectedMergeGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ blocker: expect.any(String) }),
    ]));
    expect(analysis.rejectedDropCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "merge-a", blocker: expect.any(String) }),
    ]));
  });

  it("merges same-type threads through canonical title and keyword analysis", () => {
    const analysis = analyzeThreadPoolForMaintenance({
      threads: [
        thread({ id: "ledger-a", title: "明日去库房查账册", evidence: ["林远明日去库房查账册。"], lastTouchedChapter: 20 }),
        thread({ id: "ledger-b", title: "去库房查账", evidence: ["林远去库房查账。"], lastTouchedChapter: 20 }),
        thread({ id: "wall-a", type: "lead", title: "调查后墙异常响动", evidence: ["林远调查后墙异常响动。"], lastTouchedChapter: 20 }),
        thread({ id: "wall-b", type: "lead", title: "后墙响动线索", evidence: ["后墙响动线索仍在。"], lastTouchedChapter: 20 }),
        thread({ id: "dark-page-a", type: "lead", title: "查账目暗页", evidence: ["林远查账目暗页。"], lastTouchedChapter: 20 }),
        thread({ id: "dark-page-b", type: "lead", title: "核实账册暗页", evidence: ["林远核实账册暗页。"], lastTouchedChapter: 20 }),
        thread({ id: "token-a", type: "lead", title: "破损信物用途", evidence: ["破损信物用途仍未明。"], lastTouchedChapter: 20 }),
        thread({ id: "token-b", type: "lead", title: "查明信物用途", evidence: ["林远查明信物用途。"], lastTouchedChapter: 20 }),
      ],
    }, { chapter: 20 });

    expect(analysis.mergeGroups).toEqual(expect.arrayContaining([
      expect.arrayContaining(["ledger-a", "ledger-b"]),
      expect.arrayContaining(["wall-a", "wall-b"]),
      expect.arrayContaining(["dark-page-a", "dark-page-b"]),
      expect.arrayContaining(["token-a", "token-b"]),
    ]));
    expect(Object.values(analysis.reasons).some((reason) => reason.includes("sharedCanonicalKeywords=")
      && reason.includes("similarity="))).toBe(true);
  });

  it("keeps merge boundaries for type, status, strong topics, and conflicting locations", () => {
    const analysis = analyzeThreadPoolForMaintenance({
      threads: [
        thread({ id: "lead-a", type: "lead", title: "账房暗号线索", evidence: ["账房暗号线索。"], lastTouchedChapter: 20 }),
        thread({ id: "intent-a", type: "intent", title: "去账房调查暗号", evidence: ["去账房调查暗号。"], lastTouchedChapter: 20 }),
        thread({ id: "done-a", status: "done", title: "库房账册", evidence: ["库房账册。"], lastTouchedChapter: 20 }),
        thread({ id: "open-a", title: "明日去库房查账册", evidence: ["明日去库房查账册。"], lastTouchedChapter: 20 }),
        thread({ id: "token-main", type: "lead", title: "破损信物用途", evidence: ["破损信物用途仍未明。"], lastTouchedChapter: 20 }),
        thread({ id: "ledger-main", type: "lead", title: "账目暗页", evidence: ["账目暗页仍未明。"], lastTouchedChapter: 20 }),
        thread({ id: "back-hill", title: "后院调查信物", evidence: ["林远去后院调查信物。"], lastTouchedChapter: 20 }),
        thread({ id: "account-room", title: "账房调查账册", evidence: ["林远去账房调查账册。"], lastTouchedChapter: 20 }),
      ],
    }, { chapter: 20 });

    expect(analysis.mergeGroups).toEqual([]);
    const blockers = analysis.rejectedMergeGroups.map((candidate) => candidate.blocker);
    expect(blockers).toEqual(expect.arrayContaining(["cross_type", "done_open_mixed", "strong_mainline_conflict"]));

    const locationConflict = analyzeThreadPoolForMaintenance({
      threads: [
        thread({ id: "back-ledger", title: "后院调查账册", evidence: ["林远在后院调查账册。"], lastTouchedChapter: 20 }),
        thread({ id: "room-ledger", title: "账房调查账册", evidence: ["林远在账房调查账册。"], lastTouchedChapter: 20 }),
      ],
    }, { chapter: 20 });
    expect(locationConflict.mergeGroups).toEqual([]);
    expect(locationConflict.rejectedMergeGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ ids: ["back-ledger", "room-ledger"], blocker: "location_conflict" }),
    ]));
  });

  it("merges when normalized titles contain each other or jaccard similarity is high", () => {
    const analysis = analyzeThreadPoolForMaintenance({
      threads: [
        thread({ id: "contain-a", type: "lead", title: "后墙异常响动", evidence: ["后墙异常响动。"], lastTouchedChapter: 20 }),
        thread({ id: "contain-b", type: "lead", title: "后墙", evidence: ["后墙。"], lastTouchedChapter: 20 }),
        thread({ id: "jaccard-a", type: "lead", title: "账册暗号", evidence: ["账册暗号。"], lastTouchedChapter: 20 }),
        thread({ id: "jaccard-b", type: "lead", title: "暗号账册", evidence: ["暗号账册。"], lastTouchedChapter: 20 }),
      ],
    }, { chapter: 20 });

    expect(analysis.mergeGroups).toEqual(expect.arrayContaining([
      expect.arrayContaining(["contain-a", "contain-b"]),
      expect.arrayContaining(["jaccard-a", "jaccard-b"]),
    ]));
  });

  it("suggests mark_thread_done for completed evidence but ignores future intent phrasing", async () => {
    const report = await createMockAIReviewer().review(createMinimalInput({
      chapter: 18,
      threads: [
        {
          id: "thread-completed",
          type: "lead",
          title: "账房暗号来源",
          status: "open",
          firstSeenChapter: 4,
          lastTouchedChapter: 18,
          evidence: ["林远已经查清账房暗号来源，线索闭合。"],
        },
        {
          id: "thread-future",
          type: "lead",
          title: "准备查清库房账册",
          status: "open",
          firstSeenChapter: 5,
          lastTouchedChapter: 18,
          evidence: ["林远明日查清库房账册来源。"],
        },
      ],
    }));

    expect(report.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "mark_thread_done", targetIds: ["thread-completed"] }),
    ]));
    expect(report.suggestions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "mark_thread_done", targetIds: ["thread-future"] }),
    ]));
  });

  it("suggests at most five merge actions and keeps a thread in only one group", async () => {
    const pairs = [
      ["账房", "暗号"],
      ["库房", "账册"],
      ["后院", "信物"],
      ["园圃", "资源"],
      ["外院", "管事"],
      ["大门", "名单"],
      ["后墙", "残页"],
    ] as const;
    const threads = pairs.map(([location, object], index) => ([
      {
        id: `thread-merge-${index}-a`,
        type: "intent" as const,
        title: `林远决定去${location}调查${object}`,
        status: "open" as const,
        firstSeenChapter: 1,
        lastTouchedChapter: 20,
        evidence: [`林远决定去${location}调查${object}。`],
      },
      {
        id: `thread-merge-${index}-b`,
        type: "intent" as const,
        title: `明日去${location}查清${object}`,
        status: "open" as const,
        firstSeenChapter: 2,
        lastTouchedChapter: 20,
        evidence: [`明日去${location}查清${object}。`],
      },
    ])).flat();

    const report = await createMockAIReviewer().review(createMinimalInput({ chapter: 20, threads }));
    const mergeSuggestions = report.suggestions.filter((suggestion) => suggestion.action === "merge_threads");
    const mergedIds = mergeSuggestions.flatMap((suggestion) => suggestion.targetIds ?? []);

    expect(mergeSuggestions).toHaveLength(5);
    expect(mergeSuggestions[0]?.targetIds?.length).toBe(2);
    expect(new Set(mergedIds).size).toBe(mergedIds.length);
  });

  it("does not merge across thread types or done/open boundaries by default", () => {
    const analysis = analyzeThreadPoolForMaintenance({
      threads: [
        thread({ id: "lead-a", type: "lead", title: "账房暗号线索", evidence: ["账房暗号线索。"], lastTouchedChapter: 12 }),
        thread({ id: "intent-a", type: "intent", title: "去账房调查暗号", evidence: ["去账房调查暗号。"], lastTouchedChapter: 12 }),
        thread({ id: "done-a", status: "done", title: "库房账册", evidence: ["库房账册。"], lastTouchedChapter: 12 }),
        thread({ id: "open-a", title: "明日去库房查账册", evidence: ["明日去库房查账册。"], lastTouchedChapter: 12 }),
      ],
    }, { chapter: 12 });

    expect(analysis.mergeGroups).toEqual([]);
  });

  it("suggests dropping low-value old threads but keeps strong narrative threads", async () => {
    const report = await createMockAIReviewer().review(createMinimalInput({
      chapter: 20,
      threads: [
        {
          id: "thread-low-value",
          type: "intent",
          title: "随手问一句",
          status: "open",
          firstSeenChapter: 1,
          lastTouchedChapter: 1,
          evidence: ["随手记了一句。"],
        },
        {
          id: "thread-strong",
          type: "lead",
          title: "账目残页",
          status: "open",
          firstSeenChapter: 1,
          lastTouchedChapter: 1,
          evidence: ["账目残页仍未解释。"],
        },
      ],
    }));

    expect(report.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "drop_thread", targetIds: ["thread-low-value"] }),
    ]));
    expect(report.suggestions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "drop_thread", targetIds: ["thread-strong"] }),
    ]));
  });

  it("limits drop candidates and mark-done candidates", () => {
    const doneThreads = Array.from({ length: 10 }, (_, index) => thread({
      id: `done-${index}`,
      title: `暗号${index}`,
      evidence: [`林远已经查清暗号${index}。`],
      lastTouchedChapter: 20,
    }));
    const dropThreads = Array.from({ length: 7 }, (_, index) => thread({
      id: `drop-${index}`,
      title: `继续观察情况${index}`,
      evidence: ["以后再说。"],
      lastTouchedChapter: 1,
    }));

    const analysis = analyzeThreadPoolForMaintenance({ threads: [...doneThreads, ...dropThreads] }, { chapter: 20 });

    expect(analysis.doneCandidates).toHaveLength(5);
    expect(analysis.dropCandidates).toHaveLength(2);
  });

  it("reports noExecutableActionReason when only advisory maintenance is safe", async () => {
    const report = await createMockAIReviewer().review(createMinimalInput({
      chapter: 20,
      threads: [
        {
          id: "thread-stale-mainline",
          type: "lead",
          title: "账目后续线索",
          status: "open",
          firstSeenChapter: 1,
          lastTouchedChapter: 1,
          evidence: ["账目后续线索仍需推进。"],
          nextActionHint: "继续自然推进账目线索。",
        },
      ],
    }));

    expect(report.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "prioritize_thread", targetIds: ["thread-stale-mainline"] }),
    ]));
    expect(report.actionabilitySummary).toMatchObject({
      executableActionCount: 0,
      markThreadDoneCount: 0,
      mergeThreadsCount: 0,
      dropThreadCount: 0,
      prioritizeCount: 1,
      noExecutableActionReason: expect.stringContaining("Drop candidates were rejected"),
    });
    expect(report.candidateDiagnostics?.reviewerStage.executableSuggestionCount).toBe(0);
    expect(report.candidateDiagnostics?.noActionReason).toContain("Drop candidates were rejected");
    expect(report.candidateDiagnostics?.analysisStage.rejectedDoneCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ blocker: "no_completion_evidence" }),
    ]));
    expect(report.candidateDiagnostics?.analysisStage.rejectedDropCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ blocker: "strong_mainline_term" }),
    ]));
    expect(report.summary).toContain("Drop candidates were rejected");
  });

  it("registers and lists reviewer providers with the built-in mock provider", () => {
    const provider: AIReviewerProvider = {
      id: "unit-provider",
      name: "Unit Provider",
      kind: "mock",
      async review(input) {
        return minimalReviewReport({ scope: input.scope, summary: "unit provider ok" });
      },
    };

    registerAIReviewerProvider(provider);

    expect(getAIReviewerProvider("mock")).toMatchObject({ id: "mock", kind: "mock" });
    expect(getAIReviewerProvider("unit-provider")).toBe(provider);
    expect(listAIReviewerProviders().map((item) => item.id)).toEqual(expect.arrayContaining(["mock", "unit-provider"]));
  });

  it("runs the mock provider and annotates provider metadata", async () => {
    const input = createMinimalInput({ chapter: 8, threads: [] });

    const result = await runAIReviewerWithProvider(input, { providerId: "mock" });

    expect(result.usedFallback).toBe(false);
    expect(result.providerId).toBe("mock");
    expect(result.report.provider).toMatchObject({ id: "mock", usedFallback: false });
    expect(result.report.summary).toContain("Mock review found");
  });

  it("does not call external providers in V1", async () => {
    const result = await runAIReviewerWithProvider(createMinimalInput({ chapter: 8, threads: [] }), {
      providerId: "external",
    });

    expect(result.report.passed).toBe(false);
    expect(result.report.summary).toContain("does not call real external models yet");
  });

  it("falls back to mock when a provider throws and fallback is enabled", async () => {
    registerAIReviewerProvider({
      id: "throwing-provider",
      name: "Throwing Provider",
      kind: "external",
      async review() {
        throw new Error("provider boom");
      },
    });

    const fallback = await runAIReviewerWithProvider(createMinimalInput({ chapter: 8, threads: [] }), {
      providerId: "throwing-provider",
      fallbackToMock: true,
    });
    const failed = await runAIReviewerWithProvider(createMinimalInput({ chapter: 8, threads: [] }), {
      providerId: "throwing-provider",
      fallbackToMock: false,
    });

    expect(fallback.usedFallback).toBe(true);
    expect(fallback.report.provider).toMatchObject({ id: "mock", usedFallback: true });
    expect(fallback.report.summary).toContain("Fallback reviewer was used");
    expect(failed.report.passed).toBe(false);
    expect(failed.report.summary).toContain("provider boom");
  });

  it("falls back to mock for invalid provider schema only when fallback is enabled", async () => {
    registerAIReviewerProvider({
      id: "invalid-schema-provider",
      name: "Invalid Schema Provider",
      kind: "external",
      async review(input) {
        return minimalReviewReport({
          scope: input.scope,
          suggestions: [{ action: "bad_action", reason: "bad" } as never],
        });
      },
    });

    const fallback = await runAIReviewerWithProvider(createMinimalInput({ chapter: 8, threads: [] }), {
      providerId: "invalid-schema-provider",
      fallbackToMock: true,
    });
    const failed = await runAIReviewerWithProvider(createMinimalInput({ chapter: 8, threads: [] }), {
      providerId: "invalid-schema-provider",
      fallbackToMock: false,
    });

    expect(fallback.usedFallback).toBe(true);
    expect(fallback.report.provider).toMatchObject({ id: "mock", usedFallback: true });
    expect(failed.report.passed).toBe(false);
    expect(failed.report.summary).toContain("suggestions[0] is invalid");
  });

  it("validates report schema, fills optional text fields, and rejects unsafe shapes", () => {
    const missingText = validateAIReviewReport({
      passed: true,
      scope: "window",
      issues: [],
      suggestions: [],
    });
    const invalidAction = validateAIReviewReport(minimalReviewReport({
      suggestions: [{ action: "bad_action", reason: "bad" } as never],
    }));
    const invalidSeverity = validateAIReviewReport(minimalReviewReport({
      issues: [{
        id: "bad-severity",
        type: "continuity_risk",
        severity: "fatal",
        evidence: [],
        suggestion: "bad",
      } as never],
    }));
    const invalidConfidence = validateAIReviewReport(minimalReviewReport({
      suggestions: [{ action: "no_action", reason: "bad", confidence: 2 }],
    }));
    const credentialKey = validateAIReviewReport({
      ...minimalReviewReport(),
      [["author", "ization"].join("")]: "value",
    });
    const credentialValue = validateAIReviewReport(minimalReviewReport({
      summary: `contains ${["sk", "-"].join("")}placeholder`,
    }));

    expect(missingText.valid).toBe(true);
    expect(missingText.sanitized?.summary).toBe("AI review completed.");
    expect(missingText.sanitized?.createdAt).toEqual(expect.any(String));
    expect(invalidAction).toMatchObject({ valid: false, errors: expect.arrayContaining(["suggestions[0] is invalid."]) });
    expect(invalidSeverity).toMatchObject({ valid: false, errors: expect.arrayContaining(["issues[0] is invalid."]) });
    expect(invalidConfidence).toMatchObject({ valid: false, errors: expect.arrayContaining(["suggestions[0] is invalid."]) });
    expect(credentialKey.valid).toBe(false);
    expect(credentialValue.valid).toBe(false);
  });

  it("deepseek provider falls back to mock when key is missing and fallback is enabled", async () => {
    registerAIReviewerProvider(createDeepSeekAIReviewerProvider({
      env: {},
      fetch: failFetch("fetch should not run without key"),
    }));

    const fallback = await runAIReviewerWithProvider(createMinimalInput({ chapter: 8, threads: [] }), {
      providerId: "deepseek",
      fallbackToMock: true,
    });
    const failed = await runAIReviewerWithProvider(createMinimalInput({ chapter: 8, threads: [] }), {
      providerId: "deepseek",
      fallbackToMock: false,
    });

    expect(fallback.usedFallback).toBe(true);
    expect(fallback.report.provider).toMatchObject({ id: "mock", usedFallback: true });
    expect(failed.report).toMatchObject({
      passed: false,
      provider: expect.objectContaining({ id: "deepseek", usedFallback: false }),
    });
  });

  it("deepseek provider accepts fake valid JSON and annotates metadata", async () => {
    registerAIReviewerProvider(createDeepSeekAIReviewerProvider({
      apiKey: "unit-key",
      env: {},
      fetch: fakeDeepSeekFetch(JSON.stringify(minimalReviewReport({
        summary: "deepseek ok",
        suggestions: [{ action: "no_action", targetIds: [], reason: "Nothing to do.", confidence: 0.5 }],
      }))),
    }));

    const result = await runAIReviewerWithProvider(createMinimalInput({ chapter: 8, threads: [] }), {
      providerId: "deepseek",
      strictJson: true,
    });

    expect(result.report.passed).toBe(true);
    expect(result.report.summary).toBe("deepseek ok");
    expect(result.report.provider).toMatchObject({ id: "deepseek", usedFallback: false });
  });

  it("deepseek provider falls back for non-JSON, invalid schema, status 401, timeout, and credential-like output", async () => {
    registerAIReviewerProvider(createDeepSeekAIReviewerProvider({
      apiKey: "unit-key",
      env: {},
      fetch: fakeDeepSeekFetch("not json"),
    }));
    const nonJson = await runAIReviewerWithProvider(createMinimalInput({ chapter: 8, threads: [] }), {
      providerId: "deepseek",
      fallbackToMock: true,
    });

    registerAIReviewerProvider(createDeepSeekAIReviewerProvider({
      apiKey: "unit-key",
      env: {},
      fetch: fakeDeepSeekFetch(JSON.stringify(minimalReviewReport({
        suggestions: [{ action: "bad_action", reason: "bad", confidence: 0.5 } as never],
      }))),
    }));
    const invalid = await runAIReviewerWithProvider(createMinimalInput({ chapter: 8, threads: [] }), {
      providerId: "deepseek",
      fallbackToMock: true,
    });

    registerAIReviewerProvider(createDeepSeekAIReviewerProvider({
      apiKey: "unit-key",
      env: {},
      fetch: fakeDeepSeekFetch(JSON.stringify({ error: "nope" }), 401, "Nope"),
    }));
    const status401 = await runAIReviewerWithProvider(createMinimalInput({ chapter: 8, threads: [] }), {
      providerId: "deepseek",
      fallbackToMock: true,
    });

    registerAIReviewerProvider(createDeepSeekAIReviewerProvider({
      apiKey: "unit-key",
      env: {},
      fetch: async () => new Promise(() => undefined),
    }));
    const timeout = await runAIReviewerWithProvider(createMinimalInput({ chapter: 8, threads: [] }), {
      providerId: "deepseek",
      timeoutMs: 1,
      fallbackToMock: true,
    });

    const credentialValue = ["sk", "-"].join("");
    registerAIReviewerProvider(createDeepSeekAIReviewerProvider({
      apiKey: "unit-key",
      env: {},
      fetch: fakeDeepSeekFetch(JSON.stringify({
        ...minimalReviewReport({ summary: `${credentialValue}placeholder` }),
      })),
    }));
    const credentialLike = await runAIReviewerWithProvider(createMinimalInput({ chapter: 8, threads: [] }), {
      providerId: "deepseek",
      fallbackToMock: true,
    });

    expect(nonJson).toMatchObject({
      usedFallback: true,
      report: { provider: expect.objectContaining({ id: "mock", usedFallback: true, errorType: "non_json_response" }) },
    });
    expect(nonJson.rawResponseTruncated).toContain("not json");
    expect(invalid.report.provider).toMatchObject({ id: "mock", usedFallback: true, errorType: "invalid_schema" });
    expect(status401.report.provider).toMatchObject({ id: "mock", usedFallback: true, errorType: "auth_failed" });
    expect(timeout.report.provider).toMatchObject({ id: "mock", usedFallback: true, errorType: "timeout" });
    expect(credentialLike.report.provider).toMatchObject({ id: "mock", usedFallback: true, errorType: "invalid_schema" });
  });

  it("deepseek provider truncates and filters raw response snippets", async () => {
    const credentialValue = ["sk", "-"].join("");
    registerAIReviewerProvider(createDeepSeekAIReviewerProvider({
      apiKey: "unit-key",
      env: {},
      fetch: fakeDeepSeekFetch(`${credentialValue}${"x".repeat(800)}`),
    }));

    const result = await runAIReviewerWithProvider(createMinimalInput({ chapter: 8, threads: [] }), {
      providerId: "deepseek",
      fallbackToMock: false,
    });

    expect(result.report.passed).toBe(false);
    expect(result.rawResponseTruncated?.length).toBeLessThanOrEqual(500);
    expect(result.rawResponseTruncated).not.toContain(credentialValue);
    expect(result.rawResponseTruncated).toContain("[filtered]");
  });

  it("does not reference legacy InkOS packages or model providers", async () => {
    const source = await readFile(join(import.meta.dirname, "..", "ai-reviewer.ts"), "utf-8");

    expect(source).not.toMatch(new RegExp([
      ["packages", "core"].join("/"),
      ["@actalk", "inkos-core"].join("/"),
      ["Pipeline", "Runner"].join(""),
      "OpenAI",
    ].join("|"), "i"));
  });
});

async function createReviewFixture(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "story-engine-ai-review-"));
  const { projectDir } = await createStoryProject({
    rootDir,
    title: "AI Review Fixture",
    genre: "xianxia",
    premise: "林远追查外院账目。",
    mainCharacterName: "林远",
  });
  const events: TimelineEvent[] = Array.from({ length: 12 }, (_, index) => {
    const chapter = index + 1;
    return {
      id: `ch${String(chapter).padStart(4, "0")}-001`,
      chapter,
      summary: `第${chapter}章林远推进账房线索。`,
      participants: ["character"],
      effects: {
        semanticSummary: {
          chapter,
          protagonist: "林远",
          mainEvent: `第${chapter}章林远在账房确认账目线索并留下后续疑点。${"证据".repeat(80)}`,
          nextLead: "后墙异常响动仍未查清。",
          mentionedCharacterNames: ["林远"],
          locations: ["账房"],
        },
      },
    };
  });
  const hooks: HookPool = {
    hooks: [
      {
        id: "hook-stale",
        title: "账目",
        description: "账房账目长期没有推进。",
        status: "active",
        relatedCharacters: ["林远"],
        firstSeenChapter: 1,
        lastTouchedChapter: 2,
        evidence: ["林远发现账目。"],
      },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `hook-${index}`,
        title: `测试伏笔${index}`,
        description: "用于数量限制。",
        status: "seeded" as const,
        relatedCharacters: ["林远"],
      })),
    ],
  };
  const threads: ThreadPool = {
    threads: [
      {
        id: "thread-stale-intent",
        type: "intent",
        title: "林远准备去库房查账",
        status: "open",
        firstSeenChapter: 1,
        lastTouchedChapter: 1,
        evidence: ["林远准备去库房查账。"],
      },
      {
        id: "thread-merge-a",
        type: "intent",
        title: "林远决定去库房调查账册",
        status: "open",
        firstSeenChapter: 2,
        lastTouchedChapter: 11,
        evidence: ["林远决定去库房调查账册。"],
      },
      {
        id: "thread-merge-b",
        type: "intent",
        title: "明日去库房查账册",
        status: "open",
        firstSeenChapter: 3,
        lastTouchedChapter: 10,
        evidence: ["明日去库房查账册。"],
      },
      {
        id: "thread-done-candidate",
        type: "lead",
        title: "后墙异常响动",
        status: "open",
        firstSeenChapter: 4,
        lastTouchedChapter: 12,
        evidence: ["林远已经查清后墙异常响动的来源，暗号已解。"],
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `thread-extra-${index}`,
        type: index % 2 === 0 ? "lead" as const : "intent" as const,
        title: `额外线程${index}`,
        status: "open" as const,
        firstSeenChapter: 1,
        lastTouchedChapter: 5 + (index % 6),
        evidence: [`额外线程证据${index}${"很长".repeat(80)}`],
      })),
    ],
  };
  const arcGoals: ArcGoalPool = {
    goals: [
      {
        id: "arc-drift",
        title: "查清资源账目",
        status: "active",
        scope: "main_arc",
        firstSeenChapter: 1,
        lastTouchedChapter: 2,
        evidence: ["林远开始追查外院账目。"],
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `arc-${index}`,
        title: `测试小卷目标${index}`,
        status: "active" as const,
        scope: "mini_arc" as const,
        firstSeenChapter: 1,
        lastTouchedChapter: 8 + (index % 4),
        evidence: [`目标证据${index}`],
      })),
    ],
  };

  await mkdir(join(projectDir, "story"), { recursive: true });
  await Promise.all([
    writeJson(join(projectDir, "timeline", "events.json"), events),
    writeJson(join(projectDir, "story", "hooks.json"), hooks),
    writeJson(join(projectDir, "story", "threads.json"), threads),
    writeJson(join(projectDir, "story", "arc-goals.json"), arcGoals),
  ]);
  return projectDir;
}

async function createThreadSelectionFixture(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "story-engine-thread-selection-"));
  const { projectDir } = await createStoryProject({
    rootDir,
    title: "Thread Selection Fixture",
    genre: "xianxia",
    premise: "林远追查外院账目。",
    mainCharacterName: "林远",
  });
  const threads: ThreadPool = {
    threads: [
      ...Array.from({ length: 12 }, (_, index) => thread({
        id: `recent-${index}`,
        title: `近期线程${index}`,
        evidence: [`近期线程证据${index}`],
        lastTouchedChapter: 30 - index,
      })),
      thread({
        id: "drop-old",
        title: "继续观察情况",
        evidence: ["以后再说。"],
        lastTouchedChapter: 1,
      }),
      thread({
        id: "merge-old-a",
        title: "林远决定去库房调查账册",
        evidence: ["林远决定去库房调查账册。"],
        lastTouchedChapter: 3,
      }),
      thread({
        id: "merge-old-b",
        title: "明日去库房查清账册",
        evidence: ["明日去库房查清账册。"],
        lastTouchedChapter: 4,
      }),
      thread({
        id: "done-old",
        type: "lead",
        title: "账房暗号来源",
        evidence: ["林远已经查清账房暗号来源，暗号已解。"],
        lastTouchedChapter: 2,
      }),
      ...Array.from({ length: 20 }, (_, index) => thread({
        id: `filler-${index}`,
        title: `填充线程${index}`,
        evidence: [`填充线程证据${index}`],
        lastTouchedChapter: 10 + (index % 4),
      })),
    ],
  };
  await writeJson(join(projectDir, "story", "threads.json"), threads);
  return projectDir;
}

async function createCandidateExposureFixture(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "story-engine-candidate-exposure-"));
  const { projectDir } = await createStoryProject({
    rootDir,
    title: "Candidate Exposure Fixture",
    genre: "xianxia",
    premise: "林远追查外院账目。",
    mainCharacterName: "林远",
  });
  const threads: ThreadPool = {
    threads: [
      thread({
        id: "drop-safe-low-value",
        title: "处理杂事",
        evidence: ["暂时按兵不动。"],
        lastTouchedChapter: 2,
      }),
      thread({
        id: "drop-next-hint",
        title: "查问园圃闲话",
        evidence: ["园圃有人提过闲话。"],
        lastTouchedChapter: 3,
        nextActionHint: "下次去园圃问清。",
      }),
      thread({
        id: "drop-recent-hint",
        title: "询问院门旧事",
        evidence: ["院门旁有人提到旧事。"],
        lastTouchedChapter: 12,
        nextActionHint: "近期继续问院门旧事。",
      }),
      thread({
        id: "drop-expired-hint-side-branch",
        title: "偏门闲事",
        evidence: ["偏门闲事无人再提。"],
        lastTouchedChapter: 2,
        nextActionHint: "以后顺手问一句。",
      }),
      thread({
        id: "drop-active-hook",
        title: "园圃脚印线索",
        evidence: ["园圃边缘留有脚印。"],
        lastTouchedChapter: 4,
        nextActionHint: "继续核对园圃脚印。",
        relatedLocations: ["园圃"],
      }),
      thread({
        id: "drop-active-arc",
        title: "枯井传闻",
        evidence: ["枯井旁有传闻。"],
        lastTouchedChapter: 5,
        relatedLocations: ["枯井"],
      }),
      thread({
        id: "drop-touched-carry",
        status: "touched",
        title: "杂役院口角",
        evidence: ["杂役院口角还没完全平息。"],
        lastTouchedChapter: 6,
        nextActionHint: "继续观察杂役院口角。",
      }),
      thread({
        id: "drop-many-evidence",
        title: "食堂传闻",
        evidence: ["食堂有人谈起传闻。", "第二个弟子也提到类似说法。"],
        lastTouchedChapter: 3,
      }),
      thread({
        id: "drop-weak-mainline",
        title: "外院闲谈",
        evidence: ["外院旁枝闲谈无人再提。"],
        lastTouchedChapter: 2,
      }),
      thread({
        id: "drop-weak-hook-overlap",
        title: "组织闲谈",
        evidence: ["组织里有一条无关闲谈。"],
        lastTouchedChapter: 2,
      }),
      thread({
        id: "drop-mainline",
        title: "账房信物线索",
        evidence: ["信物可能和账房管事有关。"],
        lastTouchedChapter: 2,
      }),
      ...Array.from({ length: 8 }, (_, index) => thread({
        id: `recent-exposure-${index}`,
        title: `近期普通线程${index}`,
        evidence: [`近期普通线程证据${index}`],
        lastTouchedChapter: 24 - index,
      })),
    ],
  };
  const hooks: HookPool = {
    hooks: [
      {
        id: "hook-active-drug",
        title: "园圃脚印伏笔",
        status: "active",
        firstSeenChapter: 1,
        lastTouchedChapter: 20,
        description: "园圃脚印仍需推进。",
        evidence: ["园圃出现脚印。"],
        relatedCharacters: [],
        relatedLocations: ["园圃"],
      },
      {
        id: "hook-active-weak-overlap",
        title: "组织闲话",
        status: "active",
        firstSeenChapter: 1,
        lastTouchedChapter: 20,
        description: "组织层面的背景闲话。",
        evidence: ["组织闲话仍作为背景存在。"],
        relatedCharacters: [],
        relatedLocations: [],
      },
    ],
  };
  const arcGoals: ArcGoalPool = {
    goals: [
      {
        id: "arc-active-well",
        title: "枯井传闻调查",
        status: "active",
        scope: "mini_arc",
        firstSeenChapter: 1,
        lastTouchedChapter: 18,
        evidence: ["枯井传闻仍在推进。"],
        relatedThreads: ["drop-active-arc"],
        relatedCharacters: [],
        relatedLocations: ["枯井"],
      },
    ],
  };
  await Promise.all([
    writeJson(join(projectDir, "story", "threads.json"), threads),
    writeJson(join(projectDir, "story", "hooks.json"), hooks),
    writeJson(join(projectDir, "story", "arc-goals.json"), arcGoals),
  ]);
  return projectDir;
}

function thread(input: {
  readonly id: string;
  readonly type?: "lead" | "intent";
  readonly title: string;
  readonly status?: "open" | "touched" | "done" | "stale";
  readonly evidence: readonly string[];
  readonly lastTouchedChapter: number;
  readonly nextActionHint?: string;
  readonly relatedCharacters?: readonly string[];
  readonly relatedLocations?: readonly string[];
}): ThreadPool["threads"][number] {
  return {
    id: input.id,
    type: input.type ?? "intent",
    title: input.title,
    status: input.status ?? "open",
    firstSeenChapter: 1,
    lastTouchedChapter: input.lastTouchedChapter,
    evidence: input.evidence,
    ...(input.nextActionHint !== undefined ? { nextActionHint: input.nextActionHint } : {}),
    ...(input.relatedCharacters !== undefined ? { relatedCharacters: input.relatedCharacters } : {}),
    ...(input.relatedLocations !== undefined ? { relatedLocations: input.relatedLocations } : {}),
  };
}

function createMinimalInput(input: {
  readonly chapter: number;
  readonly threads: ThreadPool["threads"];
  readonly intentDiagnostics?: NonNullable<AIReviewInput["intentDiagnostics"]>;
}): AIReviewInput {
  return {
    projectId: "minimal-review",
    chapter: input.chapter,
    scope: "window",
    recentTimelineEvents: [],
    semanticSummaries: [],
    hookPool: { hooks: [] },
    threadPool: { threads: input.threads },
    ...(input.intentDiagnostics ? { intentDiagnostics: input.intentDiagnostics } : {}),
    arcGoalPool: { goals: [] },
  };
}

function createIntentDiagnostics(items: readonly (Partial<NonNullable<AIReviewInput["intentDiagnostics"]>["items"][number]> & {
  readonly id: string;
  readonly title: string;
  readonly valueClass: NonNullable<AIReviewInput["intentDiagnostics"]>["items"][number]["valueClass"];
  readonly typeCategory: NonNullable<AIReviewInput["intentDiagnostics"]>["items"][number]["typeCategory"];
  readonly lifecycleSuggestion: NonNullable<AIReviewInput["intentDiagnostics"]>["items"][number]["lifecycleSuggestion"];
  readonly cleanupCandidateClass: NonNullable<AIReviewInput["intentDiagnostics"]>["items"][number]["cleanupCandidateClass"];
  readonly cleanupReason: string;
})[]): NonNullable<AIReviewInput["intentDiagnostics"]> {
  const completedItems = items.map((item) => ({
    status: "open" as const,
    staleReason: "none",
    safetyNotes: [],
    ageInChapters: 0,
    hasNextActionHint: false,
    evidenceStrength: "weak" as const,
    ...item,
  }));
  const cleanupCandidateCounts = {
    none: 0,
    cleanup_candidate: 0,
    manual_review_drop_candidate: 0,
    stale_low_value_candidate: 0,
    stale_generic_candidate: 0,
    manual_review_mark_done_candidate: 0,
  };
  const valueClassCounts = {
    low_value_generic: 0,
    medium_value_action: 0,
    high_value_narrative: 0,
  };
  const typeCategoryCounts = {
    generic_decision: 0,
    generic_motion: 0,
    resource_goal: 0,
    location_goal: 0,
    signal_or_clue_goal: 0,
    character_interaction: 0,
    risk_or_survival_goal: 0,
    stale_or_obsolete: 0,
  };
  const lifecycleSuggestionCounts = {
    keep_open_or_touched: 0,
    mark_done_candidate: 0,
    drop_candidate: 0,
    auto_expire_candidate: 0,
    low_priority_keep: 0,
    do_not_pool_or_low_priority: 0,
  };
  for (const item of completedItems) {
    cleanupCandidateCounts[item.cleanupCandidateClass] += 1;
    valueClassCounts[item.valueClass] += 1;
    typeCategoryCounts[item.typeCategory] += 1;
    lifecycleSuggestionCounts[item.lifecycleSuggestion] += 1;
  }
  return {
    summary: {
      present: true,
      advisoryOnly: true,
      totalIntents: completedItems.length,
      openIntentCount: completedItems.filter((item) => item.status === "open").length,
      touchedIntentCount: completedItems.filter((item) => item.status === "touched").length,
      doneIntentCount: completedItems.filter((item) => item.status === "done").length,
      cleanupVisibleCount: completedItems.filter((item) => item.cleanupCandidateClass !== "none").length,
      protectedHighValueCount: completedItems.filter((item) => item.valueClass === "high_value_narrative").length,
      valueClassCounts,
      typeCategoryCounts,
      lifecycleSuggestionCounts,
      cleanupCandidateCounts,
      summaryText: "fixture intent diagnostics",
    },
    items: completedItems,
  };
}

function minimalReviewReport(overrides: Partial<AIReviewReport> = {}): AIReviewReport {
  return {
    passed: true,
    scope: "window",
    issues: [],
    suggestions: [],
    summary: "ok",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fakeDeepSeekFetch(content: string, status = 200, statusText = "OK"): AIReviewerFetchLike {
  return async (_url, _init) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async text() {
      return JSON.stringify({
        choices: [
          {
            message: {
              content,
            },
          },
        ],
      });
    },
  });
}

function failFetch(message: string): AIReviewerFetchLike {
  return async () => {
    throw new Error(message);
  };
}

async function snapshotStructuredState(projectDir: string): Promise<Record<string, string>> {
  const files = [
    "timeline/events.json",
    "story/hooks.json",
    "story/threads.json",
    "story/arc-goals.json",
    "world/state.json",
    "time/calendar.json",
    `characters/${toSafeCharacterId("林远")}/state.json`,
  ];
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readFile(join(projectDir, file), "utf-8")] as const)));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
