import { describe, expect, it } from "vitest";

import {
  buildFormalCommitPreviewResult,
  findForbiddenFormalCommitPreviewFields,
} from "./formal-commit-preview.js";

describe("buildFormalCommitPreviewResult", () => {
  it("returns read-only dry-run no-write flags for a minimal preview", () => {
    const result = buildFormalCommitPreviewResult({
      projectPath: "/Users/example/story",
      chapterTarget: 1,
      workspaceDraftId: "draft-hash",
      commitPlan: { timelineEvents: [] },
      requestId: "req-1",
      transactionBackupAvailable: true,
      snapshotManifestAvailable: true,
      serverValidationAvailable: true,
      confirmRouteAvailable: false,
    });

    expect(result).toMatchObject({
      status: "unavailable",
      dryRun: true,
      readOnly: true,
      didWriteState: false,
      didWriteMarkdown: false,
      didWriteMemory: false,
      didFormalCommit: false,
      canConfirm: false,
      confirmUnavailable: true,
      previewToken: null,
      requestId: "req-1",
      blockingReasons: ["formal_commit_confirm_unavailable"],
      wouldChangeFiles: ["chapters/0001.md"],
    });
    expect(result.chapterOnlyConfirmReadiness).toMatchObject({
      status: "blocked",
      confirmRequestContextAvailable: false,
      serverFlagRequiredForWrite: true,
      fullFormalCommitReady: false,
      doesNotUpdateState: true,
      readinessStatus: null,
      blockingReasons: ["missing_confirm_request_context"],
    });
    expect(result.safety).toMatchObject({
      noCommitEngine: true,
      noCommitFastDraft: true,
      noApplyCommit: true,
      noWorkspacePatchApply: true,
    });
  });

  it("separates full formal commit blockers from chapter-only confirm readiness", () => {
    const result = buildFormalCommitPreviewResult({
      projectPath: "/Users/example/story",
      chapterTarget: 1,
      workspaceDraftId: "draft-hash",
      commitPlan: { timelineEvents: [] },
      confirmRequestContext: {
        projectPath: "/Users/example/story",
        chapterTarget: 1,
        previewHash: "draft-hash",
        baseHash: "committed-chapter-hash",
        workspaceDraftId: "draft-hash",
        readinessStatus: "ready_for_formal_review",
      },
      snapshotManifestAvailable: false,
      transactionBackupAvailable: false,
      serverValidationAvailable: false,
      confirmRouteAvailable: false,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockingReasons).toEqual([
      "missing_snapshot_manifest",
      "missing_transaction_backup",
      "server_validation_unavailable",
      "formal_commit_confirm_unavailable",
    ]);
    expect(result.chapterOnlyConfirmReadiness).toMatchObject({
      status: "ready",
      blockingReasons: [],
      confirmRequestContextAvailable: true,
      serverFlagRequiredForWrite: true,
      fullFormalCommitReady: false,
      doesNotUpdateState: true,
      readinessStatus: "ready_for_formal_review",
    });
    expect(result.confirmRequestContext).toMatchObject({
      previewHash: "draft-hash",
      workspaceDraftId: "draft-hash",
      baseHash: "committed-chapter-hash",
    });
    expect(result.canConfirm).toBe(false);
    expect(result.confirmUnavailable).toBe(true);
  });

  it.each([
    ["missing chapter target", { chapterTarget: null }, "missing_chapter_target"],
    ["missing workspace diff", { chapterTarget: 1, workspaceDraftId: "" }, "missing_workspace_diff"],
    ["stale hash", { chapterTarget: 1, workspaceDraftId: "draft", staleHash: true }, "stale_hash"],
    ["context mismatch", { chapterTarget: 1, workspaceDraftId: "draft", contextMismatch: true }, "context_mismatch"],
    ["protected target", { chapterTarget: 1, workspaceDraftId: "draft", protectedTarget: true }, "protected_target"],
    ["missing snapshot manifest", { chapterTarget: 1, workspaceDraftId: "draft", snapshotManifestAvailable: false }, "missing_snapshot_manifest"],
    ["missing transaction backup", { chapterTarget: 1, workspaceDraftId: "draft", snapshotManifestAvailable: true, transactionBackupAvailable: false }, "missing_transaction_backup"],
    ["server validation unavailable", {
      chapterTarget: 1,
      workspaceDraftId: "draft",
      snapshotManifestAvailable: true,
      transactionBackupAvailable: true,
      serverValidationAvailable: false,
    }, "server_validation_unavailable"],
  ])("blocks %s", (_label, input, expectedReason) => {
    const result = buildFormalCommitPreviewResult({
      projectPath: "/Users/example/story",
      commitPlan: {},
      confirmRouteAvailable: true,
      ...input,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockingReasons).toContain(expectedReason);
    expect(result.didFormalCommit).toBe(false);
    expect(result.canConfirm).toBe(false);
  });

  it("detects forbidden preview request fields", () => {
    expect(findForbiddenFormalCommitPreviewFields({
      projectPath: "/Users/example/story",
      chapter: 1,
      rawPatchText: "@@ patch",
      arbitraryFilePath: "/tmp/outside.md",
      confirm: true,
      apply: true,
      write: true,
      commit: true,
      agentAutoApply: true,
      rollback: true,
      memoryWrite: true,
      formalCommit: true,
    })).toEqual([
      "rawPatchText",
      "arbitraryFilePath",
      "confirm",
      "apply",
      "write",
      "commit",
      "agentAutoApply",
      "rollback",
      "memoryWrite",
      "formalCommit",
    ]);
  });
});
