import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCommitPreviewTransaction,
  findTransactionResidues,
  validateCommitApplyPreflight,
} from "./transaction-hardening.js";

describe("transaction hardening V1 guards", () => {
  let projectDir: string | undefined;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "story-engine-tx-hardening-"));
  });

  afterEach(async () => {
    if (projectDir) {
      await rm(projectDir, { recursive: true, force: true });
      projectDir = undefined;
    }
  });

  it("creates stable preview hashes and transaction ids for identical input", () => {
    const input = {
      projectDir: "/tmp/story-engine/project-a",
      chapter: 3,
      draftContent: "正文内容",
      commitPlan: { passed: true, commitPlan: { timelineEvents: [{ id: "ch0003-001", summary: "事件" }] } },
    };

    const first = buildCommitPreviewTransaction(input);
    const second = buildCommitPreviewTransaction(input);

    expect(first).toMatchObject({
      version: "transaction-hardening-v1",
      chapter: 3,
    });
    expect(first.transactionId).toBe(second.transactionId);
    expect(first.previewHash).toBe(second.previewHash);
    expect(first.draftHash).toBe(second.draftHash);
    expect(first.commitPlanHash).toBe(second.commitPlanHash);
  });

  it("changes preview hash when draft content changes", () => {
    const base = {
      projectDir: "/tmp/story-engine/project-a",
      chapter: 3,
      commitPlan: { passed: true, commitPlan: { threads: [] } },
    };

    const first = buildCommitPreviewTransaction({ ...base, draftContent: "第一版正文" });
    const second = buildCommitPreviewTransaction({ ...base, draftContent: "第二版正文" });

    expect(first.draftHash).not.toBe(second.draftHash);
    expect(first.previewHash).not.toBe(second.previewHash);
  });

  it("rejects apply preflight when preview hash does not match", () => {
    const current = buildCommitPreviewTransaction({
      projectDir: "/tmp/story-engine/project-a",
      chapter: 1,
      draftContent: "当前正文",
      commitPlan: { passed: true, commitPlan: { threads: [] } },
    });

    const result = validateCommitApplyPreflight({
      transactionId: current.transactionId,
      expectedPreviewHash: "wrong-preview-hash",
      idempotencyKey: "idem-1234567890",
      current,
      residues: [],
    });

    expect(result).toMatchObject({ ok: false, code: "preview_hash_mismatch" });
  });

  it("rejects apply preflight without idempotency key", () => {
    const current = buildCommitPreviewTransaction({
      projectDir: "/tmp/story-engine/project-a",
      chapter: 1,
      draftContent: "当前正文",
      commitPlan: { passed: true, commitPlan: { threads: [] } },
    });

    const result = validateCommitApplyPreflight({
      transactionId: current.transactionId,
      expectedPreviewHash: current.previewHash,
      idempotencyKey: "",
      current,
      residues: [],
    });

    expect(result).toMatchObject({ ok: false, code: "missing_idempotency_key" });
  });

  it("rejects apply preflight with an invalid idempotency key", () => {
    const current = buildCommitPreviewTransaction({
      projectDir: "/tmp/story-engine/project-a",
      chapter: 1,
      draftContent: "当前正文",
      commitPlan: { passed: true, commitPlan: { threads: [] } },
    });

    const result = validateCommitApplyPreflight({
      transactionId: current.transactionId,
      expectedPreviewHash: current.previewHash,
      idempotencyKey: "bad key with spaces",
      current,
      residues: [],
    });

    expect(result).toMatchObject({ ok: false, code: "missing_idempotency_key" });
  });

  it("allows apply preflight with matching preview hash, valid idempotency key, and no residues", () => {
    const current = buildCommitPreviewTransaction({
      projectDir: "/tmp/story-engine/project-a",
      chapter: 1,
      draftContent: "当前正文",
      commitPlan: { passed: true, commitPlan: { threads: [] } },
    });

    const result = validateCommitApplyPreflight({
      transactionId: current.transactionId,
      expectedPreviewHash: current.previewHash,
      idempotencyKey: "idem-1234567890",
      current,
      residues: [],
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects apply preflight when transaction residue exists", () => {
    const current = buildCommitPreviewTransaction({
      projectDir: "/tmp/story-engine/project-a",
      chapter: 1,
      draftContent: "当前正文",
      commitPlan: { passed: true, commitPlan: { threads: [] } },
    });

    const result = validateCommitApplyPreflight({
      transactionId: current.transactionId,
      expectedPreviewHash: current.previewHash,
      idempotencyKey: "idem-1234567890",
      current,
      residues: [{ id: "commit-chapter-0001", status: "staged", manifestPath: "/tmp/manifest.json" }],
    });

    expect(result).toMatchObject({ ok: false, code: "transaction_residue_found" });
  });

  it("allows apply preflight when transaction residue scan is empty", async () => {
    const projectDir = join(tmpdir(), `story-engine-tx-empty-${Date.now()}`);
    const current = buildCommitPreviewTransaction({
      projectDir,
      chapter: 1,
      draftContent: "当前正文",
      commitPlan: { passed: true, commitPlan: { threads: [] } },
    });

    try {
      const residues = await findTransactionResidues(projectDir);
      const result = validateCommitApplyPreflight({
        transactionId: current.transactionId,
        expectedPreviewHash: current.previewHash,
        idempotencyKey: "idem-1234567890",
        current,
        residues,
      });

      expect(residues).toEqual([]);
      expect(result).toEqual({ ok: true });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("detects transaction residue manifests", async () => {
    const projectDir = join(tmpdir(), `story-engine-tx-residue-${Date.now()}`);
    const txDir = join(projectDir, ".story-engine-tx", "commit-chapter-0001");
    await mkdir(txDir, { recursive: true });
    await writeFile(join(txDir, "manifest.json"), JSON.stringify({ status: "failed" }), "utf-8");

    try {
      const residues = await findTransactionResidues(projectDir);

      expect(residues).toEqual([
        expect.objectContaining({
          id: "commit-chapter-0001",
          status: "failed",
        }),
      ]);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("ignores valid finalized snapshot-manifest residues", async () => {
    await writeSnapshotManifest(validFinalizedSnapshotManifest());

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([]);
  });

  it("allows apply preflight when only valid finalized snapshot-manifest exists", async () => {
    await writeSnapshotManifest(validFinalizedSnapshotManifest());
    const residues = await findTransactionResidues(requireProjectDir());
    const current = buildCommitPreviewTransaction({
      projectDir: requireProjectDir(),
      chapter: 1,
      draftContent: "当前正文",
      commitPlan: { passed: true, commitPlan: { threads: [] } },
    });

    const result = validateCommitApplyPreflight({
      transactionId: current.transactionId,
      expectedPreviewHash: current.previewHash,
      idempotencyKey: "idem-1234567890",
      current,
      residues,
    });

    expect(residues).toEqual([]);
    expect(result).toEqual({ ok: true });
  });

  it.skipIf(process.platform === "win32")(
    "blocks .story-engine-tx symlink even when the target has a valid finalized snapshot-manifest",
    async () => {
      const targetTxDir = join(requireProjectDir(), "tx-target", "commit-chapter-0001");
      await mkdir(targetTxDir, { recursive: true });
      await writeFile(
        join(targetTxDir, "snapshot-manifest.json"),
        JSON.stringify(validFinalizedSnapshotManifest()),
        "utf-8",
      );
      await symlink(join(requireProjectDir(), "tx-target"), join(requireProjectDir(), ".story-engine-tx"));

      const residues = await findTransactionResidues(requireProjectDir());

      expect(residues).toEqual([
        expect.objectContaining({ id: ".story-engine-tx", status: "unsafe_tx_root" }),
      ]);
      expectPreflightBlockedByResidues(residues);
    },
  );

  it("blocks .story-engine-tx when it is a regular file", async () => {
    await writeFile(join(requireProjectDir(), ".story-engine-tx"), "not a transaction directory", "utf-8");

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: ".story-engine-tx", status: "unsafe_tx_root" }),
    ]);
  });

  it.skipIf(process.platform === "win32")("blocks snapshot-manifest symlinks", async () => {
    const txDir = join(requireProjectDir(), ".story-engine-tx", "commit-chapter-0001");
    const realManifestPath = join(txDir, "real-finalized-manifest.json");
    await mkdir(txDir, { recursive: true });
    await writeFile(realManifestPath, JSON.stringify(validFinalizedSnapshotManifest()), "utf-8");
    await symlink(realManifestPath, join(txDir, "snapshot-manifest.json"));

    const residues = await findTransactionResidues(requireProjectDir());

    expect(residues).toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "unsafe_snapshot_manifest" }),
    ]);
    expectPreflightBlockedByResidues(residues);
  });

  it("blocks snapshot-manifest directories", async () => {
    await mkdir(
      join(requireProjectDir(), ".story-engine-tx", "commit-chapter-0001", "snapshot-manifest.json"),
      { recursive: true },
    );

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "unsafe_snapshot_manifest" }),
    ]);
  });

  it.skipIf(process.platform === "win32")(
    "does not hide snapshot-manifest symlinks behind legacy manifest fallback",
    async () => {
      const txDir = join(requireProjectDir(), ".story-engine-tx", "commit-chapter-0001");
      const realManifestPath = join(txDir, "real-finalized-manifest.json");
      await mkdir(txDir, { recursive: true });
      await writeFile(realManifestPath, JSON.stringify(validFinalizedSnapshotManifest()), "utf-8");
      await symlink(realManifestPath, join(txDir, "snapshot-manifest.json"));
      await writeFile(join(txDir, "manifest.json"), JSON.stringify({ status: "staged" }), "utf-8");

      await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
        expect.objectContaining({ id: "commit-chapter-0001", status: "unsafe_snapshot_manifest" }),
      ]);
    },
  );

  it.skipIf(process.platform === "win32")("blocks child transaction directory symlinks", async () => {
    await mkdir(join(requireProjectDir(), ".story-engine-tx"), { recursive: true });
    const targetTxDir = join(requireProjectDir(), "tx-child-target");
    await mkdir(targetTxDir, { recursive: true });
    await writeFile(
      join(targetTxDir, "snapshot-manifest.json"),
      JSON.stringify(validFinalizedSnapshotManifest()),
      "utf-8",
    );
    await symlink(targetTxDir, join(requireProjectDir(), ".story-engine-tx", "commit-chapter-0001"));

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "unexpected_file" }),
    ]);
  });

  it("blocks finalized snapshot-manifest when transaction id chapter differs from manifest chapter", async () => {
    await writeSnapshotManifestForTransaction("commit-chapter-0002", validFinalizedSnapshotManifest());

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0002", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized snapshot-manifest when files chapter differs from transaction id", async () => {
    await writeSnapshotManifestForTransaction("commit-chapter-0002", {
      ...validFinalizedSnapshotManifest(),
      chapter: 2,
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0002", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized snapshot-manifest when appliedChangedFiles chapter differs from transaction id", async () => {
    await writeSnapshotManifestForTransaction("commit-chapter-0002", {
      ...validFinalizedSnapshotManifestForChapter(2),
      appliedChangedFiles: ["chapters/0001.md"],
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0002", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized snapshot-manifest for invalid transaction entry ids", async () => {
    await writeSnapshotManifestForTransaction("not-a-commit-id", validFinalizedSnapshotManifest());

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "not-a-commit-id", status: "finalized_invalid" }),
    ]);
  });

  it("blocks non-canonical finalized transaction ids with extra leading zeroes", async () => {
    await writeSnapshotManifestForTransaction("commit-chapter-00001", validFinalizedSnapshotManifestForChapter(1));

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-00001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks non-canonical finalized transaction ids with too few padding digits", async () => {
    await writeSnapshotManifestForTransaction("commit-chapter-001", validFinalizedSnapshotManifestForChapter(1));

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized zero chapter transaction ids", async () => {
    await writeSnapshotManifestForTransaction("commit-chapter-0000", {
      ...validFinalizedSnapshotManifestForChapter(1),
      chapter: 0,
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0000", status: "finalized_invalid" }),
    ]);
  });

  it("ignores valid finalized canonical five digit chapter ids", async () => {
    await writeSnapshotManifestForTransaction(
      "commit-chapter-10000",
      validFinalizedSnapshotManifestForChapter(10000),
    );

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([]);
  });

  it("blocks finalized snapshot-manifest missing finalizedAt", async () => {
    const { finalizedAt: _finalizedAt, ...manifest } = validFinalizedSnapshotManifest();
    await writeSnapshotManifest(manifest);

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized snapshot-manifest with empty finalizedAt", async () => {
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      finalizedAt: "",
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized snapshot-manifest with invalid finalizedAt", async () => {
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      finalizedAt: "not-a-date",
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized files entries missing rollbackAction", async () => {
    const [{ rollbackAction: _rollbackAction, ...file }] = finalizedDeleteIfCreatedFilesForChapter(1);
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      files: [file],
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized files entries with invalid rollbackAction", async () => {
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      files: [
        {
          relativePath: "chapters/0001.md",
          snapshotPath: null,
          rollbackAction: "bad",
        },
      ],
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized delete_if_created entries with snapshotPath", async () => {
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      files: [
        {
          relativePath: "chapters/0001.md",
          snapshotPath: ".story-engine-tx/commit-chapter-0001/snapshot/chapters/0001.md",
          rollbackAction: "delete_if_created",
        },
      ],
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized restore_previous entries missing snapshotPath", async () => {
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      files: [
        {
          relativePath: "chapters/0001.md",
          rollbackAction: "restore_previous",
          byteLength: 10,
          sha256: "a".repeat(64),
        },
      ],
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized restore_previous entries with mismatched snapshotPath", async () => {
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      files: [
        {
          relativePath: "chapters/0001.md",
          rollbackAction: "restore_previous",
          snapshotPath: ".story-engine-tx/commit-chapter-0001/snapshot/chapters/0002.md",
          byteLength: 10,
          sha256: "a".repeat(64),
        },
      ],
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized restore_previous entries missing byteLength", async () => {
    const [{ byteLength: _byteLength, ...file }] = finalizedRestorePreviousFilesForChapter(1);
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      files: [file],
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized restore_previous entries missing sha256", async () => {
    const [{ sha256: _sha256, ...file }] = finalizedRestorePreviousFilesForChapter(1);
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      files: [file],
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized restore_previous entries with invalid sha256", async () => {
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      files: [
        {
          ...finalizedRestorePreviousFilesForChapter(1)[0],
          sha256: "A".repeat(64),
        },
      ],
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("ignores valid finalized restore_previous metadata shape without reading snapshot content", async () => {
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      files: finalizedRestorePreviousFilesForChapter(1),
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([]);
  });

  it("blocks finalized snapshot-manifest missing appliedChangedFiles", async () => {
    const { appliedChangedFiles: _appliedChangedFiles, ...manifest } = validFinalizedSnapshotManifest();
    await writeSnapshotManifest(manifest);

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized snapshot-manifest with state JSON appliedChangedFiles", async () => {
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      appliedChangedFiles: ["timeline/events.json"],
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized snapshot-manifest with unknown formalApplyMode", async () => {
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      formalApplyMode: "unknown",
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized snapshot-manifest with stateWritesEnabled true", async () => {
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      stateWritesEnabled: true,
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it("blocks finalized snapshot-manifest with cleanupPerformed true", async () => {
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      cleanupPerformed: true,
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  it.each([
    "snapshot_created",
    "applied",
    "applying",
    "rollback_failed",
    "rollback_succeeded",
  ])("blocks formal commit snapshot-manifest status %s", async (status) => {
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      status,
    });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status }),
    ]);
  });

  it("blocks malformed snapshot-manifest JSON", async () => {
    await writeRawSnapshotManifest("not json");

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "unreadable_snapshot_manifest" }),
    ]);
  });

  it("blocks missing snapshot-manifest and missing legacy manifest", async () => {
    await mkdir(join(requireProjectDir(), ".story-engine-tx", "commit-chapter-0001"), { recursive: true });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "missing_manifest" }),
    ]);
  });

  it("blocks unexpected files under transaction root", async () => {
    await mkdir(join(requireProjectDir(), ".story-engine-tx"), { recursive: true });
    await writeFile(join(requireProjectDir(), ".story-engine-tx", "unexpected.txt"), "residue", "utf-8");

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      { id: "unexpected.txt", status: "unexpected_file" },
    ]);
  });

  it("preserves legacy manifest.json behavior", async () => {
    await writeLegacyManifest({ status: "staged" });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "staged" }),
    ]);
  });

  it("prefers finalized snapshot-manifest over legacy manifest", async () => {
    await writeSnapshotManifest(validFinalizedSnapshotManifest());
    await writeLegacyManifest({ status: "staged" });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([]);
  });

  it("does not hide invalid snapshot-manifest behind legacy manifest fallback", async () => {
    await writeSnapshotManifest({
      ...validFinalizedSnapshotManifest(),
      appliedChangedFiles: ["story/assets.json"],
    });
    await writeLegacyManifest({ status: "staged" });

    await expect(findTransactionResidues(requireProjectDir())).resolves.toEqual([
      expect.objectContaining({ id: "commit-chapter-0001", status: "finalized_invalid" }),
    ]);
  });

  function requireProjectDir(): string {
    if (!projectDir) throw new Error("projectDir missing");
    return projectDir;
  }

  async function writeSnapshotManifest(manifest: Record<string, unknown>): Promise<void> {
    await writeSnapshotManifestForTransaction("commit-chapter-0001", manifest);
  }

  async function writeRawSnapshotManifest(content: string): Promise<void> {
    await writeRawSnapshotManifestForTransaction("commit-chapter-0001", content);
  }

  async function writeSnapshotManifestForTransaction(id: string, manifest: Record<string, unknown>): Promise<void> {
    await writeRawSnapshotManifestForTransaction(id, JSON.stringify(manifest));
  }

  async function writeRawSnapshotManifestForTransaction(id: string, content: string): Promise<void> {
    const txDir = join(requireProjectDir(), ".story-engine-tx", id);
    await mkdir(txDir, { recursive: true });
    await writeFile(join(txDir, "snapshot-manifest.json"), content, "utf-8");
  }

  async function writeLegacyManifest(manifest: Record<string, unknown>): Promise<void> {
    const txDir = join(requireProjectDir(), ".story-engine-tx", "commit-chapter-0001");
    await mkdir(txDir, { recursive: true });
    await writeFile(join(txDir, "manifest.json"), JSON.stringify(manifest), "utf-8");
  }

  function expectPreflightBlockedByResidues(
    residues: Awaited<ReturnType<typeof findTransactionResidues>>,
  ): void {
    const current = buildCommitPreviewTransaction({
      projectDir: requireProjectDir(),
      chapter: 1,
      draftContent: "当前正文",
      commitPlan: { passed: true, commitPlan: { threads: [] } },
    });

    expect(validateCommitApplyPreflight({
      transactionId: current.transactionId,
      expectedPreviewHash: current.previewHash,
      idempotencyKey: "idem-1234567890",
      current,
      residues,
    })).toMatchObject({ ok: false, code: "transaction_residue_found" });
  }
});

function validFinalizedSnapshotManifest(): Record<string, unknown> {
  return validFinalizedSnapshotManifestForChapter(1);
}

function validFinalizedSnapshotManifestForChapter(chapter: number): Record<string, unknown> {
  const chapterPath = `chapters/${String(chapter).padStart(4, "0")}.md`;
  return {
    status: "finalized",
    chapter,
    createdAt: "2026-05-23T00:00:00.000Z",
    finalizedAt: "2026-05-23T00:01:00.000Z",
    files: finalizedDeleteIfCreatedFilesForChapter(chapter),
    noFormalStateWriteConfirmed: true,
    productionApplyImplemented: false,
    routeWired: true,
    formalApplyMode: "chapter_only_v0a",
    stateWritesEnabled: false,
    defaultFormalWritesEnabled: false,
    cleanupPerformed: false,
    appliedChangedFiles: [chapterPath],
  };
}

function finalizedDeleteIfCreatedFilesForChapter(chapter: number): Array<Record<string, unknown>> {
  return [
    {
      relativePath: `chapters/${String(chapter).padStart(4, "0")}.md`,
      snapshotPath: null,
      rollbackAction: "delete_if_created",
    },
  ];
}

function finalizedRestorePreviousFilesForChapter(chapter: number): Array<Record<string, unknown>> {
  const chapterPath = `chapters/${String(chapter).padStart(4, "0")}.md`;
  return [
    {
      relativePath: chapterPath,
      snapshotPath: `.story-engine-tx/commit-chapter-${String(chapter).padStart(4, "0")}/snapshot/${chapterPath}`,
      rollbackAction: "restore_previous",
      byteLength: 10,
      sha256: "a".repeat(64),
    },
  ];
}
