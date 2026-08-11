import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AIReviewReport } from "../ai-reviewer.js";
import { createStoryProject, toSafeCharacterId } from "../project-store.js";
import { applyReviewPlan, buildReviewPlan, inspectStoryEngineTransactionResidue } from "../review-plan.js";
import type { ArcGoalPool, HookPool, ThreadPool } from "../types.js";

describe("ReviewPlan / Thread Action Preview", () => {
  it("turns review suggestions into safe previews without mutating structured state", async () => {
    const projectDir = await createReviewPlanFixture();
    const before = await snapshotStructuredState(projectDir);
    const report = createReviewReport();

    const plan = await buildReviewPlan({
      projectDir,
      report,
      sourceReportPath: join(projectDir, "reports", "ai-review-window-0008.json"),
      chapter: 8,
    });

    expect(plan).toMatchObject({
      scope: "window",
      chapter: 8,
      sourceReportPath: join(projectDir, "reports", "ai-review-window-0008.json"),
    });
    expect(plan.actions).toHaveLength(9);
    for (const action of plan.actions) {
      expect(action.safety).toMatchObject({
        requiresConfirmation: true,
        mutatesState: false,
        canAutoApply: false,
        riskLevel: expect.any(String),
        reasons: expect.any(Array),
      });
      expect(action.confirmability).toMatchObject({
        recommended: expect.any(Boolean),
        score: expect.any(Number),
        reason: expect.any(String),
      });
      expect(action.confirmationMode).toMatch(/recommended_confirm|manual_review|do_not_confirm/u);
    }

    expect(action(plan, "mark_thread_done")).toMatchObject({
      preview: {
        title: "Mark thread as done: 后墙异常响动",
        before: expect.objectContaining({ id: "thread-done", status: "open" }),
        after: expect.objectContaining({ id: "thread-done", status: "done" }),
      },
    });
    expect(action(plan, "merge_threads")).toMatchObject({
      preview: {
        before: expect.arrayContaining([
          expect.objectContaining({ id: "thread-merge-a" }),
          expect.objectContaining({ id: "thread-merge-b" }),
        ]),
        after: expect.objectContaining({
          keptId: "thread-merge-a",
          mergedTitle: "去库房查账",
          mergedStatus: "touched",
          mergedEvidenceCount: 2,
          removedIds: ["thread-merge-b"],
          title: "去库房查账",
          status: "touched",
          lastTouchedChapter: 8,
          relatedCharacters: ["林远"],
          relatedLocations: ["库房", "账房"],
        }),
        mergeAnalysis: expect.objectContaining({
          sharedKeywords: expect.arrayContaining(["库房", "查账"]),
          sharedLocations: expect.arrayContaining(["库房"]),
          specificSharedKeywords: expect.arrayContaining(["库房", "查账"]),
          specificityScore: expect.any(Number),
          beforeTitles: ["去库房查账", "明日去库房查账册"],
          afterTitle: "去库房查账",
          titleQuality: expect.objectContaining({
            afterTitle: "去库房查账",
            isGeneric: false,
            source: "intent_pattern",
          }),
          removedThreadIds: ["thread-merge-b"],
          evidencePreview: expect.any(Array),
        }),
        overrideSuggestions: {
          afterTitleCandidates: expect.arrayContaining(["去库房查账"]),
        },
        notes: expect.arrayContaining(["Preview only. Confirm required before merging threads."]),
      },
    });
    expect(action(plan, "drop_thread")).toMatchObject({
      preview: {
        title: "Drop thread: 废弃线索",
        after: null,
        dropAnalysis: expect.objectContaining({
          evidenceCount: 1,
          hasNextActionHint: false,
          hasStrongMainlineTerm: false,
          relatedActiveHook: false,
          relatedActiveArcGoal: false,
          protectionWarnings: expect.any(Array),
        }),
        notes: expect.arrayContaining([
          "Drop only removes the thread entry. It does not edit chapters, timeline, hooks, or arc goals.",
          expect.stringContaining("Reason:"),
        ]),
      },
    });
    expect(action(plan, "prioritize_thread")).toMatchObject({
      preview: {
        title: "Prioritize thread: 林远准备夜探账房",
        after: expect.objectContaining({ priorityPreview: true }),
      },
    });
    expect(action(plan, "prioritize_hook")).toMatchObject({
      preview: {
        title: "Prioritize hook: 账本",
        after: expect.objectContaining({ priorityPreview: true }),
      },
    });
    expect(action(plan, "prioritize_arc_goal")).toMatchObject({
      preview: {
        title: "Prioritize arc goal: 查清侧门资源账目",
        after: expect.objectContaining({ priorityPreview: true }),
      },
    });
    expect(action(plan, "no_action")).toMatchObject({
      preview: {
        title: "No action",
      },
    });
    expect(action(plan, "create_repair_plan")).toMatchObject({
      preview: {
        title: "Create repair plan",
        notes: expect.arrayContaining([expect.stringContaining("does not create repair files")]),
      },
    });
    expect(plan.actions.find((item) => item.targetIds.includes("missing-thread"))?.preview.notes?.[0]).toContain("Target id not found");
    await expect(snapshotStructuredState(projectDir)).resolves.toEqual(before);
  });

  it("classifies action safety and confirmability for human selection", async () => {
    const projectDir = await createReviewPlanFixture();
    const plan = await buildReviewPlan({
      projectDir,
      report: createSafetyReviewReport(),
      chapter: 24,
    });

    expect(byTarget(plan, "thread-done")).toMatchObject({
      action: "mark_thread_done",
      safety: { riskLevel: "safe" },
      confirmability: { recommended: true },
    });
    expect(byTarget(plan, "thread-future")).toMatchObject({
      action: "mark_thread_done",
      safety: { riskLevel: "risky", blockers: expect.arrayContaining(["future_intent"]) },
      confirmability: { recommended: false },
      confirmationMode: "do_not_confirm",
    });
    expect(byTarget(plan, "thread-weak-done")).toMatchObject({
      action: "mark_thread_done",
      safety: { riskLevel: "caution" },
      confirmability: { recommended: true },
      confirmationMode: "recommended_confirm",
    });
    expect(byTarget(plan, "thread-safe-merge-a")).toMatchObject({
      action: "merge_threads",
      safety: { riskLevel: "safe" },
      confirmability: { recommended: true, reason: expect.stringContaining("specific object 账册 and specific location 库房") },
      confirmationMode: "recommended_confirm",
      preview: {
        after: expect.objectContaining({ mergedTitle: "去库房查账" }),
        mergeAnalysis: expect.objectContaining({
          conflictWarnings: [],
          specificSharedKeywords: expect.arrayContaining(["库房", "账册"]),
          broadSharedKeywords: [],
          specificityScore: expect.any(Number),
          granularityWarnings: [],
          titleQuality: expect.objectContaining({
            afterTitle: "去库房查账",
            isGeneric: false,
            source: "intent_pattern",
          }),
        }),
      },
    });
    expect(byTarget(plan, "thread-action-merge-a")).toMatchObject({
      action: "merge_threads",
      safety: { riskLevel: "safe" },
      confirmability: { recommended: true, reason: expect.stringContaining("specific object 信物 and specific action 取回") },
      confirmationMode: "recommended_confirm",
    });
    expect(byTarget(plan, "thread-wall-code-a")).toMatchObject({
      action: "merge_threads",
      confirmability: { recommended: true },
      confirmationMode: "recommended_confirm",
      preview: {
        after: expect.objectContaining({ mergedTitle: "后墙异常响动" }),
        mergeAnalysis: expect.objectContaining({
          specificSharedKeywords: expect.arrayContaining(["后墙", "暗号"]),
          specificityScore: expect.any(Number),
          titleQuality: expect.objectContaining({
            afterTitle: "后墙异常响动",
            isGeneric: false,
            source: "lead_pattern",
          }),
        }),
      },
    });
    expect(byTarget(plan, "thread-generic-title-a")).toMatchObject({
      action: "merge_threads",
      confirmability: { recommended: true },
      preview: {
        after: expect.objectContaining({ mergedTitle: "账房信物线索" }),
        mergeAnalysis: expect.objectContaining({
          specificSharedKeywords: expect.arrayContaining(["账房", "信物"]),
        }),
      },
    });
    expect(byTarget(plan, "thread-generic-title-a")?.preview.after).not.toMatchObject({
      mergedTitle: expect.stringMatching(/继续调查|查清情况|处理线索/u),
    });
    expect(byTarget(plan, "thread-caution-merge-a")).toMatchObject({
      action: "merge_threads",
      safety: { riskLevel: "caution" },
      confirmability: { recommended: true, reason: expect.stringContaining("specific keyword 账房") },
      confirmationMode: "recommended_confirm",
      preview: { mergeAnalysis: expect.objectContaining({ conflictWarnings: [] }) },
    });
    expect(byTarget(plan, "thread-caution-merge-a")?.safety.warnings).toEqual(expect.arrayContaining(["title_not_identical"]));
    expect(byTarget(plan, "thread-daily-merge-a")).toMatchObject({
      action: "merge_threads",
      confirmability: { recommended: true },
      confirmationMode: "recommended_confirm",
      preview: {
        after: expect.objectContaining({ mergedTitle: "交还工具并离开现场" }),
        mergeAnalysis: expect.objectContaining({
          titleQuality: expect.objectContaining({
            afterTitle: "交还工具并离开现场",
            isGeneric: false,
            source: "intent_pattern",
          }),
        }),
        overrideSuggestions: {
          afterTitleCandidates: expect.arrayContaining(["交还工具并离开现场"]),
        },
      },
    });
    expect(byTarget(plan, "thread-generic-after-a")).toMatchObject({
      action: "merge_threads",
      safety: { riskLevel: "caution", warnings: expect.arrayContaining(["generic_after_title"]) },
      confirmability: { recommended: false },
      confirmationMode: "manual_review",
      preview: {
        after: expect.objectContaining({ mergedTitle: expect.stringMatching(/继续调查|查清情况/u) }),
        mergeAnalysis: expect.objectContaining({
          titleQuality: expect.objectContaining({
            afterTitle: expect.stringMatching(/继续调查|查清情况/u),
            isGeneric: true,
          }),
          granularityWarnings: expect.arrayContaining(["generic_after_title"]),
        }),
      },
    });
    expect(byTarget(plan, "thread-weak-merge-a")).toMatchObject({
      action: "merge_threads",
      safety: { riskLevel: "caution", warnings: expect.arrayContaining(["broad_only_merge"]) },
      confirmability: { recommended: false, reason: expect.stringContaining("only share broad keywords") },
      confirmationMode: "manual_review",
      preview: {
        mergeAnalysis: expect.objectContaining({
          broadSharedKeywords: expect.arrayContaining(["情况", "继续"]),
          specificSharedKeywords: [],
          granularityWarnings: expect.arrayContaining(["broad_only_merge"]),
        }),
      },
    });
    expect(byTarget(plan, "thread-cross-type-lead")).toMatchObject({
      action: "merge_threads",
      safety: { riskLevel: "risky", blockers: expect.arrayContaining(["cross_type_merge"]) },
      confirmability: { recommended: false },
      confirmationMode: "do_not_confirm",
      preview: { mergeAnalysis: expect.objectContaining({ conflictWarnings: expect.arrayContaining(["cross_type_merge"]) }) },
    });
    expect(byTarget(plan, "thread-done-mixed")).toMatchObject({
      action: "merge_threads",
      safety: { riskLevel: "risky", blockers: expect.arrayContaining(["done_open_mixed"]) },
      confirmability: { recommended: false },
    });
    expect(byTarget(plan, "thread-token-mainline")).toMatchObject({
      action: "merge_threads",
      safety: { riskLevel: "risky", blockers: expect.arrayContaining(["strong_mainline_conflict"]) },
      confirmability: { recommended: false },
      confirmationMode: "do_not_confirm",
    });
    expect(plan.actions.find((item) => item.targetIds.includes("missing-merge-thread"))).toMatchObject({
      action: "merge_threads",
      safety: { riskLevel: "risky", blockers: expect.arrayContaining(["target_missing"]) },
      confirmability: { recommended: false },
      confirmationMode: "do_not_confirm",
    });
    expect(byTarget(plan, "thread-drop-safe")).toMatchObject({
      action: "drop_thread",
      safety: { riskLevel: "safe" },
      confirmability: {
        recommended: true,
        reason: expect.stringContaining("no active hook/arc relation"),
      },
      confirmationMode: "recommended_confirm",
      preview: { dropAnalysis: expect.objectContaining({ protectionWarnings: [] }) },
    });
    expect(byTarget(plan, "thread-drop-caution")).toMatchObject({
      action: "drop_thread",
      safety: { riskLevel: "caution" },
      confirmability: { recommended: false },
      confirmationMode: "manual_review",
    });
    expect(byTarget(plan, "thread-drop-mainline")).toMatchObject({
      action: "drop_thread",
      safety: { riskLevel: "risky", blockers: expect.arrayContaining(["strong_mainline_word"]) },
      confirmability: { recommended: false },
      confirmationMode: "do_not_confirm",
    });
    expect(byTarget(plan, "thread-drop-hook-linked")).toMatchObject({
      action: "drop_thread",
      safety: { riskLevel: "risky", blockers: expect.arrayContaining(["linked_active_hook"]) },
      confirmability: { recommended: false },
    });
    expect(byTarget(plan, "thread-drop-arc-linked")).toMatchObject({
      action: "drop_thread",
      safety: { riskLevel: "risky", blockers: expect.arrayContaining(["linked_active_arc_goal"]) },
      confirmability: { recommended: false },
    });
    expect(byTarget(plan, "thread-priority")).toMatchObject({
      action: "prioritize_thread",
      confirmability: { recommended: false },
      confirmationMode: "do_not_confirm",
    });
    expect(plan.actions.slice(0, 5).map((item) => `${item.safety.riskLevel}:${item.action}:${item.confirmability.recommended}:${item.confirmationMode}`)).toEqual([
      "safe:mark_thread_done:true:recommended_confirm",
      "caution:mark_thread_done:true:recommended_confirm",
      "safe:merge_threads:true:recommended_confirm",
      "safe:merge_threads:true:recommended_confirm",
      "safe:merge_threads:true:recommended_confirm",
    ]);
    expect(plan.actions.find((item) => item.action === "drop_thread" && item.safety.riskLevel === "safe")).toMatchObject({
      confirmationMode: "recommended_confirm",
    });
  });

  it("filters already-done thread targets from recommended ReviewPlan actions while preserving idempotent apply", async () => {
    const projectDir = await createReviewPlanFixture();
    const plan = await buildReviewPlan({
      projectDir,
      report: {
        passed: true,
        scope: "window",
        issues: [],
        suggestions: [
          { action: "mark_thread_done", targetIds: ["thread-done-mixed"], reason: "Already done target should be filtered.", confidence: 0.92 },
          { action: "mark_thread_done", targetIds: ["thread-done"], reason: "Open target still has clear completion evidence.", confidence: 0.92 },
        ],
        summary: "Already done guard fixture.",
        createdAt: "2026-05-14T00:00:00.000Z",
      },
      chapter: 8,
    });

    expect(plan.filteredAlreadyDoneActions).toEqual([
      expect.objectContaining({
        id: "review-action-0001",
        action: "mark_thread_done",
        doneTargetIds: ["thread-done-mixed"],
        reason: expect.stringContaining("excluded from recommendedActionIds"),
      }),
    ]);
    expect(byTarget(plan, "thread-done-mixed")).toMatchObject({
      confirmability: { recommended: false },
      confirmationMode: "do_not_confirm",
      safety: {
        riskLevel: "risky",
        blockers: expect.arrayContaining(["already_done_target"]),
      },
    });
    expect(byTarget(plan, "thread-done")).toMatchObject({
      confirmability: { recommended: true },
      confirmationMode: "recommended_confirm",
    });

    const before = await snapshotStructuredState(projectDir);
    const first = await applyReviewPlan({
      projectDir,
      plan,
      actionIds: ["review-action-0002"],
      confirm: true,
    });
    expect(first.appliedActions).toEqual([
      expect.objectContaining({ id: "review-action-0002", targetIds: ["thread-done"] }),
    ]);
    const afterFirst = await snapshotStructuredState(projectDir);
    expect(afterFirst["story/hooks.json"]).toBe(before["story/hooks.json"]);
    expect(afterFirst["story/arc-goals.json"]).toBe(before["story/arc-goals.json"]);
    expect(afterFirst["timeline/events.json"]).toBe(before["timeline/events.json"]);

    const repeated = await applyReviewPlan({
      projectDir,
      plan,
      actionIds: ["review-action-0002"],
      confirm: true,
    });
    expect(repeated.passed).toBe(true);
    await expect(snapshotStructuredState(projectDir)).resolves.toEqual(afterFirst);
  });

  it("downgrades provider-sourced drop suggestions unless system drop safety passes", async () => {
    const projectDir = await createReviewPlanFixture();
    const plan = await buildReviewPlan({
      projectDir,
      report: createProviderDropReviewReport(),
      chapter: 24,
    });

    expect(byTarget(plan, "thread-drop-safe")).toMatchObject({
      action: "drop_thread",
      safety: {
        riskLevel: "safe",
        warnings: [],
      },
      confirmability: { recommended: true },
      confirmationMode: "recommended_confirm",
      preview: {
        dropAnalysis: expect.objectContaining({
          providerSource: "deepseek",
          systemSafetyPassed: true,
          systemSafetyReasons: expect.arrayContaining([expect.stringContaining("System drop safety passed")]),
          systemSafetyBlockers: [],
          protectionWarnings: [],
        }),
      },
    });
    expect(byTarget(plan, "thread-drop-hint")).toMatchObject({
      action: "drop_thread",
      safety: {
        riskLevel: "risky",
        blockers: expect.arrayContaining(["has_next_action_hint"]),
        warnings: expect.arrayContaining(["deepseek_drop_requires_system_confirmation"]),
      },
      confirmability: { recommended: false },
      confirmationMode: "do_not_confirm",
      preview: {
        dropAnalysis: expect.objectContaining({
          providerSource: "deepseek",
          systemSafetyPassed: false,
          systemSafetyBlockers: expect.arrayContaining(["has_next_action_hint"]),
        }),
      },
    });
    expect(byTarget(plan, "thread-drop-mainline")).toMatchObject({
      safety: { riskLevel: "risky", blockers: expect.arrayContaining(["strong_mainline_word"]) },
      confirmability: { recommended: false },
      confirmationMode: "do_not_confirm",
      preview: {
        dropAnalysis: expect.objectContaining({
          providerSource: "deepseek",
          systemSafetyPassed: false,
          systemSafetyBlockers: expect.arrayContaining(["strong_mainline_word"]),
          protectionWarnings: expect.arrayContaining(["strong_mainline_term"]),
        }),
      },
    });
    expect(byTarget(plan, "thread-drop-hook-linked")).toMatchObject({
      safety: { riskLevel: "risky", blockers: expect.arrayContaining(["linked_active_hook"]) },
      confirmability: { recommended: false },
      confirmationMode: "do_not_confirm",
      preview: {
        dropAnalysis: expect.objectContaining({
          providerSource: "deepseek",
          systemSafetyPassed: false,
          systemSafetyBlockers: expect.arrayContaining(["linked_active_hook"]),
          protectionWarnings: expect.arrayContaining(["strong_mainline_term", "related_active_hook"]),
        }),
      },
    });
    expect(byTarget(plan, "thread-drop-arc-linked")).toMatchObject({
      safety: { riskLevel: "risky", blockers: expect.arrayContaining(["linked_active_arc_goal"]) },
      confirmability: { recommended: false },
      confirmationMode: "do_not_confirm",
      preview: {
        dropAnalysis: expect.objectContaining({
          providerSource: "deepseek",
          systemSafetyPassed: false,
          systemSafetyBlockers: expect.arrayContaining(["linked_active_arc_goal"]),
          protectionWarnings: expect.arrayContaining(["strong_mainline_term", "related_active_arc_goal"]),
        }),
      },
    });
    expect(byTarget(plan, "thread-drop-recent")).toMatchObject({
      safety: {
        riskLevel: "caution",
        warnings: expect.arrayContaining(["deepseek_drop_requires_system_confirmation", "recently_touched"]),
      },
      confirmability: { recommended: false },
      confirmationMode: "manual_review",
    });
    expect(byTarget(plan, "thread-drop-many-evidence")).toMatchObject({
      safety: {
        riskLevel: "caution",
        warnings: expect.arrayContaining(["deepseek_drop_requires_system_confirmation", "too_much_evidence"]),
      },
      confirmability: { recommended: false },
      confirmationMode: "manual_review",
    });
    expect(byTarget(plan, "thread-drop-touched")).toMatchObject({
      safety: {
        riskLevel: "caution",
        warnings: expect.arrayContaining(["deepseek_drop_requires_system_confirmation", "carry_forward_thread"]),
      },
      confirmability: { recommended: false },
      confirmationMode: "manual_review",
    });

    const recommendedActionIds = plan.actions
      .filter((item) => item.confirmability.recommended)
      .filter((item) => item.confirmationMode === "recommended_confirm")
      .filter((item) => item.action === "drop_thread")
      .map((item) => item.id);
    expect(recommendedActionIds).toEqual([byTarget(plan, "thread-drop-safe")?.id]);

    const mockPlan = await buildReviewPlan({
      projectDir,
      report: {
        ...createProviderDropReviewReport(),
        provider: { id: "mock", usedFallback: false },
      },
      chapter: 24,
    });
    expect(byTarget(mockPlan, "thread-drop-safe")).toMatchObject({
      action: "drop_thread",
      confirmability: { recommended: true },
      confirmationMode: "recommended_confirm",
      preview: { dropAnalysis: expect.not.objectContaining({ providerSource: "deepseek" }) },
    });
    expect(mockPlan.actions
      .filter((action) => action.action === "drop_thread")
      .every((action) => action.preview.dropAnalysis?.providerSource !== "deepseek")).toBe(true);
  });

  it("requires confirmation and supports dry-run without modifying threads", async () => {
    const projectDir = await createReviewPlanFixture();
    const plan = await buildReviewPlan({ projectDir, report: createReviewReport(), chapter: 8 });
    const before = await snapshotStructuredState(projectDir);

    const blocked = await applyReviewPlan({ projectDir, plan, confirm: false });
    expect(blocked.passed).toBe(false);
    expect(blocked.appliedActions).toHaveLength(0);
    expect(blocked.skippedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "confirmation_required" }),
      expect.objectContaining({ reason: "unsupported_action" }),
    ]));
    await expect(snapshotStructuredState(projectDir)).resolves.toEqual(before);

    const dryRun = await applyReviewPlan({ projectDir, plan, confirm: false, dryRun: true });
    expect(dryRun.passed).toBe(true);
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.appliedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "mark_thread_done" }),
      expect.objectContaining({ action: "merge_threads" }),
      expect.objectContaining({ action: "drop_thread" }),
    ]));
    await expect(snapshotStructuredState(projectDir)).resolves.toEqual(before);
  });

  it("applies only selected supported thread actions through story/threads.json", async () => {
    const projectDir = await createReviewPlanFixture();
    const plan = await buildReviewPlan({ projectDir, report: createReviewReport(), chapter: 8 });
    const before = await snapshotStructuredState(projectDir);
    const result = await applyReviewPlan({
      projectDir,
      plan,
      actionIds: ["review-action-0001", "review-action-0002", "review-action-0003", "review-action-0005"],
      confirm: true,
    });

    expect(result.passed).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.appliedActions).toEqual([
      expect.objectContaining({ action: "mark_thread_done", targetIds: ["thread-done"] }),
      expect.objectContaining({ action: "merge_threads", targetIds: ["thread-merge-a", "thread-merge-b"] }),
      expect.objectContaining({ action: "drop_thread", targetIds: ["thread-drop"] }),
    ]);
    expect(result.skippedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "review-action-0004", reason: "not_selected" }),
      expect.objectContaining({ id: "review-action-0005", reason: "unsupported_action" }),
    ]));
    const after = await snapshotStructuredState(projectDir);
    expect(after["story/hooks.json"]).toBe(before["story/hooks.json"]);
    expect(after["story/arc-goals.json"]).toBe(before["story/arc-goals.json"]);
    expect(after["timeline/events.json"]).toBe(before["timeline/events.json"]);
    expect(after["world/state.json"]).toBe(before["world/state.json"]);
    expect(after["time/calendar.json"]).toBe(before["time/calendar.json"]);
    const characterStatePath = `characters/${toSafeCharacterId("林远")}/state.json`;
    expect(after[characterStatePath]).toBe(before[characterStatePath]);

    const threads = JSON.parse(after["story/threads.json"]) as ThreadPool;
    expect(threads.threads).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "thread-done", status: "done" }),
      expect.objectContaining({ id: "thread-merge-a", title: "去库房查账", status: "touched" }),
      expect.objectContaining({ id: "thread-priority", status: "open" }),
    ]));
    expect(threads.threads).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "thread-merge-b" }),
      expect.objectContaining({ id: "thread-drop" }),
    ]));
    await expect(access(join(projectDir, ".story-engine-tx"))).rejects.toThrow();
  });

  it("distinguishes an empty transaction directory from real staged residue", async () => {
    const projectDir = await createReviewPlanFixture();
    await mkdir(join(projectDir, ".story-engine-tx"), { recursive: true });

    await expect(inspectStoryEngineTransactionResidue(projectDir)).resolves.toEqual({
      txDirectoryExists: true,
      txStagedFilesCount: 0,
      hasTransactionResidue: false,
    });

    await mkdir(join(projectDir, ".story-engine-tx", "commit-chapter-0001"), { recursive: true });
    await writeFile(join(projectDir, ".story-engine-tx", "commit-chapter-0001", "manifest.json"), "{}\n", "utf-8");

    const residue = await inspectStoryEngineTransactionResidue(projectDir);
    expect(residue.txDirectoryExists).toBe(true);
    expect(residue.txStagedFilesCount).toBeGreaterThan(0);
    expect(residue.hasTransactionResidue).toBe(true);
  });

  it("does not reference legacy InkOS packages or old pipeline runners", async () => {
    const source = await readFile(join(import.meta.dirname, "..", "review-plan.ts"), "utf-8");

    expect(source).not.toMatch(new RegExp([
      ["packages", "core"].join("/"),
      ["@actalk", "inkos-core"].join("/"),
      ["Pipeline", "Runner"].join(""),
    ].join("|"), "i"));
  });
});

function action(plan: Awaited<ReturnType<typeof buildReviewPlan>>, kind: string) {
  return plan.actions.find((item) => item.action === kind && !item.targetIds.includes("missing-thread"));
}

function byTarget(plan: Awaited<ReturnType<typeof buildReviewPlan>>, targetId: string) {
  return plan.actions.find((item) => item.targetIds.includes(targetId));
}

function createReviewReport(): AIReviewReport {
  return {
    passed: true,
    scope: "window",
    issues: [],
    suggestions: [
      {
        action: "mark_thread_done",
        targetIds: ["thread-done"],
        reason: "Evidence says the lead has been checked.",
        confidence: 0.82,
      },
      {
        action: "merge_threads",
        targetIds: ["thread-merge-a", "thread-merge-b"],
        reason: "Both threads point to the same账册 action.",
        confidence: 0.76,
      },
      {
        action: "drop_thread",
        targetIds: ["thread-drop"],
        reason: "The thread is no longer useful.",
        confidence: 0.55,
      },
      {
        action: "prioritize_thread",
        targetIds: ["thread-priority"],
        reason: "It should stay visible in the next context.",
      },
      {
        action: "prioritize_hook",
        targetIds: ["hook-black-ledger"],
        reason: "The hook anchors the current mini arc.",
      },
      {
        action: "prioritize_arc_goal",
        targetIds: ["arc-resource-ledger"],
        reason: "The current chapter should keep moving toward this goal.",
      },
      {
        action: "create_repair_plan",
        targetIds: ["thread-priority"],
        reason: "Later versions can produce a repair plan.",
      },
      {
        action: "no_action",
        reason: "Everything else can remain unchanged.",
      },
      {
        action: "mark_thread_done",
        targetIds: ["missing-thread"],
        reason: "Missing target should not crash.",
      },
    ],
    summary: "Mock review report.",
    createdAt: "2026-05-14T00:00:00.000Z",
  };
}

function createSafetyReviewReport(): AIReviewReport {
  return {
    passed: true,
    scope: "window",
    issues: [],
    suggestions: [
      { action: "mark_thread_done", targetIds: ["thread-done"], reason: "Clear completion.", confidence: 0.9 },
      { action: "mark_thread_done", targetIds: ["thread-future"], reason: "Future phrasing must not be recommended.", confidence: 0.9 },
      { action: "mark_thread_done", targetIds: ["thread-weak-done"], reason: "Caution done should be recommended with confidence.", confidence: 0.7 },
      { action: "merge_threads", targetIds: ["thread-safe-merge-a", "thread-safe-merge-b"], reason: "Same type, location, and object.", confidence: 0.9 },
      { action: "merge_threads", targetIds: ["thread-action-merge-a", "thread-action-merge-b"], reason: "Same type, object, and action.", confidence: 0.88 },
      { action: "merge_threads", targetIds: ["thread-wall-code-a", "thread-wall-code-b"], reason: "Same wall-code lead.", confidence: 0.86 },
      { action: "merge_threads", targetIds: ["thread-generic-title-a", "thread-generic-title-b"], reason: "Generic titles should merge into a specific title.", confidence: 0.86 },
      { action: "merge_threads", targetIds: ["thread-caution-merge-a", "thread-caution-merge-b"], reason: "Partial object/action overlap without critical blocker.", confidence: 0.72 },
      { action: "merge_threads", targetIds: ["thread-daily-merge-a", "thread-daily-merge-b"], reason: "Daily intent merge should use a concrete daily-action title.", confidence: 0.74 },
      { action: "merge_threads", targetIds: ["thread-generic-after-a", "thread-generic-after-b"], reason: "Generic afterTitle should not be recommended.", confidence: 0.74 },
      { action: "merge_threads", targetIds: ["thread-weak-merge-a", "thread-weak-merge-b"], reason: "Weak merge should not be recommended.", confidence: 0.72 },
      { action: "merge_threads", targetIds: ["thread-cross-type-lead", "thread-cross-type-intent"], reason: "Cross type merge must be risky.", confidence: 0.9 },
      { action: "merge_threads", targetIds: ["thread-done-mixed", "thread-open-mixed"], reason: "Done/open merge must be risky.", confidence: 0.9 },
      { action: "merge_threads", targetIds: ["thread-token-mainline", "thread-ledger-mainline"], reason: "Strong mainline conflict must be risky.", confidence: 0.9 },
      { action: "merge_threads", targetIds: ["thread-safe-merge-a", "missing-merge-thread"], reason: "Missing merge target must be risky.", confidence: 0.9 },
      { action: "drop_thread", targetIds: ["thread-drop-safe"], reason: "Old low value thread.", confidence: 0.9 },
      { action: "drop_thread", targetIds: ["thread-drop-caution"], reason: "Caution drop should not be recommended.", confidence: 0.9 },
      { action: "drop_thread", targetIds: ["thread-drop-mainline"], reason: "Strong mainline thread.", confidence: 0.9 },
      { action: "drop_thread", targetIds: ["thread-drop-hook-linked"], reason: "Active hook relation should protect drop.", confidence: 0.9 },
      { action: "drop_thread", targetIds: ["thread-drop-arc-linked"], reason: "Active arc relation should protect drop.", confidence: 0.9 },
      { action: "prioritize_thread", targetIds: ["thread-priority"], reason: "Info action should not enter apply recommendations.", confidence: 0.9 },
    ],
    summary: "Safety classification fixture.",
    createdAt: "2026-05-14T00:00:00.000Z",
  };
}

function createProviderDropReviewReport(): AIReviewReport {
  return {
    passed: true,
    scope: "window",
    issues: [],
    suggestions: [
      { action: "drop_thread", targetIds: ["thread-drop-safe"], reason: "Provider says this old low-value thread can be dropped.", confidence: 0.9 },
      { action: "drop_thread", targetIds: ["thread-drop-hint"], reason: "Provider should be blocked by nextActionHint.", confidence: 0.9 },
      { action: "drop_thread", targetIds: ["thread-drop-mainline"], reason: "Provider should be blocked by strong mainline terms.", confidence: 0.9 },
      { action: "drop_thread", targetIds: ["thread-drop-hook-linked"], reason: "Provider should be blocked by active hook relation.", confidence: 0.9 },
      { action: "drop_thread", targetIds: ["thread-drop-arc-linked"], reason: "Provider should be blocked by active arc goal relation.", confidence: 0.9 },
      { action: "drop_thread", targetIds: ["thread-drop-recent"], reason: "Provider should be downgraded because it was recently touched.", confidence: 0.9 },
      { action: "drop_thread", targetIds: ["thread-drop-many-evidence"], reason: "Provider should be downgraded because evidence is not minimal.", confidence: 0.9 },
      { action: "drop_thread", targetIds: ["thread-drop-touched"], reason: "Provider should be downgraded because it is a carry-forward thread.", confidence: 0.9 },
    ],
    provider: { id: "deepseek", usedFallback: false },
    summary: "Provider drop safety fixture.",
    createdAt: "2026-05-14T00:00:00.000Z",
  };
}

async function createReviewPlanFixture(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "story-engine-review-plan-"));
  const { projectDir } = await createStoryProject({
    rootDir,
    title: "Review Plan Fixture",
    genre: "xianxia",
    premise: "林远追查侧门资源账目。",
    mainCharacterName: "林远",
  });
  await mkdir(join(projectDir, "reports"), { recursive: true });
  const threads: ThreadPool = {
    threads: [
      {
        id: "thread-done",
        type: "lead",
        title: "后墙异常响动",
        status: "open",
        firstSeenChapter: 3,
        lastTouchedChapter: 8,
        evidence: ["林远已经查清后墙异常响动。"],
        relatedCharacters: ["林远"],
        relatedLocations: ["账房"],
      },
      {
        id: "thread-merge-a",
        type: "intent",
        title: "去库房查账",
        status: "open",
        firstSeenChapter: 4,
        lastTouchedChapter: 7,
        evidence: ["林远决定去库房查账。"],
        relatedCharacters: ["林远"],
        relatedLocations: ["库房"],
      },
      {
        id: "thread-merge-b",
        type: "intent",
        title: "明日去库房查账册",
        status: "touched",
        firstSeenChapter: 5,
        lastTouchedChapter: 8,
        evidence: ["明日去库房查账册。"],
        relatedCharacters: ["林远"],
        relatedLocations: ["账房"],
      },
      {
        id: "thread-drop",
        type: "lead",
        title: "废弃线索",
        status: "stale",
        firstSeenChapter: 1,
        lastTouchedChapter: 1,
        evidence: ["旧线索不再出现。"],
      },
      {
        id: "thread-priority",
        type: "intent",
        title: "林远准备夜探账房",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["林远准备夜探账房。"],
      },
      {
        id: "thread-future",
        type: "intent",
        title: "准备查清库房账册",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["林远明日准备查清库房账册来源。"],
      },
      {
        id: "thread-weak-done",
        type: "lead",
        title: "账册线索对上了",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["账册线索和账房暗号对上了。"],
      },
      {
        id: "thread-safe-merge-a",
        type: "intent",
        title: "库房账册",
        status: "open",
        firstSeenChapter: 4,
        lastTouchedChapter: 8,
        evidence: ["林远去库房查账册。"],
        relatedCharacters: ["林远"],
        relatedLocations: ["库房"],
      },
      {
        id: "thread-caution-merge-a",
        type: "intent",
        title: "账房侧门守候",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["林远在账房侧门守候。"],
      },
      {
        id: "thread-caution-merge-b",
        type: "intent",
        title: "账房侧门等待",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["林远在账房侧门等待。"],
      },
      {
        id: "thread-action-merge-a",
        type: "intent",
        title: "取回破损信物",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["林远准备取回破损信物。"],
      },
      {
        id: "thread-action-merge-b",
        type: "intent",
        title: "取回信物",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["林远要取回信物。"],
      },
      {
        id: "thread-wall-code-a",
        type: "lead",
        title: "调查后墙异常响动",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["林远在后墙发现暗号。"],
      },
      {
        id: "thread-wall-code-b",
        type: "lead",
        title: "后墙暗号线索",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["后墙暗号仍未解释。"],
      },
      {
        id: "thread-generic-title-a",
        type: "intent",
        title: "继续调查",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["林远继续调查账房信物。"],
      },
      {
        id: "thread-generic-title-b",
        type: "intent",
        title: "查清情况",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["林远查清账房信物情况。"],
      },
      {
        id: "thread-weak-merge-a",
        type: "intent",
        title: "林远继续调查情况",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["林远继续调查情况。"],
      },
      {
        id: "thread-weak-merge-b",
        type: "intent",
        title: "林远继续确认情况",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["林远继续确认情况。"],
      },
      {
        id: "thread-daily-merge-a",
        type: "intent",
        title: "放回工具",
        status: "open",
        firstSeenChapter: 1,
        lastTouchedChapter: 8,
        evidence: ["林远把工具放回棚子，找借口离开现场。"],
      },
      {
        id: "thread-daily-merge-b",
        type: "intent",
        title: "找借口离开杂务现场",
        status: "open",
        firstSeenChapter: 1,
        lastTouchedChapter: 8,
        evidence: ["林远交还工具和工具后离开现场。"],
      },
      {
        id: "thread-generic-after-a",
        type: "intent",
        title: "继续调查",
        status: "open",
        firstSeenChapter: 1,
        lastTouchedChapter: 8,
        evidence: ["林远继续调查情况。"],
      },
      {
        id: "thread-generic-after-b",
        type: "intent",
        title: "查清情况",
        status: "open",
        firstSeenChapter: 1,
        lastTouchedChapter: 8,
        evidence: ["林远处理线索。"],
      },
      {
        id: "thread-token-mainline",
        type: "lead",
        title: "破损信物用途",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["破损信物用途仍未解释。"],
      },
      {
        id: "thread-ledger-mainline",
        type: "lead",
        title: "账本暗页",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["账本暗页仍未解释。"],
      },
      {
        id: "thread-safe-merge-b",
        type: "intent",
        title: "明日去库房调查账册",
        status: "touched",
        firstSeenChapter: 5,
        lastTouchedChapter: 8,
        evidence: ["林远明日去库房调查账册。"],
        relatedCharacters: ["林远"],
        relatedLocations: ["库房"],
      },
      {
        id: "thread-cross-type-lead",
        type: "lead",
        title: "账房暗号线索",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["账房暗号线索仍未解释。"],
      },
      {
        id: "thread-cross-type-intent",
        type: "intent",
        title: "去账房调查暗号",
        status: "open",
        firstSeenChapter: 6,
        lastTouchedChapter: 8,
        evidence: ["林远去账房调查暗号。"],
      },
      {
        id: "thread-done-mixed",
        type: "intent",
        title: "去后院取回信物",
        status: "done",
        firstSeenChapter: 2,
        lastTouchedChapter: 8,
        evidence: ["林远已取回后院信物。"],
      },
      {
        id: "thread-open-mixed",
        type: "intent",
        title: "明日去后院取回信物",
        status: "open",
        firstSeenChapter: 3,
        lastTouchedChapter: 8,
        evidence: ["林远明日去后院取回信物。"],
      },
      {
        id: "thread-drop-safe",
        type: "lead",
        title: "随手问一句",
        status: "open",
        firstSeenChapter: 1,
        lastTouchedChapter: 1,
        evidence: ["随手记了一句。"],
      },
      {
        id: "thread-drop-caution",
        type: "lead",
        title: "临时闲话",
        status: "open",
        firstSeenChapter: 10,
        lastTouchedChapter: 12,
        evidence: ["临时闲话之一。", "临时闲话之二。"],
      },
      {
        id: "thread-drop-mainline",
        type: "lead",
        title: "账本残页",
        status: "open",
        firstSeenChapter: 1,
        lastTouchedChapter: 1,
        evidence: ["账本残页仍未解释。"],
      },
      {
        id: "thread-drop-hook-linked",
        type: "lead",
        title: "旧伏笔",
        status: "open",
        firstSeenChapter: 1,
        lastTouchedChapter: 1,
        evidence: ["账本仍在旁边牵连这个旧伏笔。"],
      },
      {
        id: "thread-drop-arc-linked",
        type: "lead",
        title: "旧目标线",
        status: "open",
        firstSeenChapter: 1,
        lastTouchedChapter: 1,
        evidence: ["查清侧门资源账目仍然牵连这个旧目标线。"],
      },
      {
        id: "thread-drop-hint",
        type: "lead",
        title: "边角记录",
        status: "open",
        firstSeenChapter: 1,
        lastTouchedChapter: 1,
        evidence: ["边角记录。"],
        nextActionHint: "稍后再确认。",
      },
      {
        id: "thread-drop-recent",
        type: "lead",
        title: "刚出现旁枝",
        status: "open",
        firstSeenChapter: 23,
        lastTouchedChapter: 23,
        evidence: ["刚出现的旁枝。"],
      },
      {
        id: "thread-drop-many-evidence",
        type: "lead",
        title: "旧闲谈",
        status: "open",
        firstSeenChapter: 1,
        lastTouchedChapter: 1,
        evidence: ["旧闲谈之一。", "旧闲谈之二。"],
      },
      {
        id: "thread-drop-touched",
        type: "lead",
        title: "仍在携带旁枝",
        status: "touched",
        firstSeenChapter: 1,
        lastTouchedChapter: 1,
        evidence: ["仍在携带的旁枝。"],
      },
    ],
  };
  const hooks: HookPool = {
    hooks: [
      {
        id: "hook-black-ledger",
        title: "账本",
        description: "账房账本牵出账目。",
        status: "active",
        relatedCharacters: ["林远"],
        firstSeenChapter: 1,
        lastTouchedChapter: 8,
        evidence: ["林远反复追查账本。"],
      },
    ],
  };
  const arcGoals: ArcGoalPool = {
    goals: [
      {
        id: "arc-resource-ledger",
        title: "查清侧门资源账目",
        status: "active",
        scope: "main_arc",
        firstSeenChapter: 1,
        lastTouchedChapter: 8,
        evidence: ["林远继续逼近侧门资源账目。"],
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
