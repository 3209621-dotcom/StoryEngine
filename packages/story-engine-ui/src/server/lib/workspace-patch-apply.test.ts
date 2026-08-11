import { createHash } from "node:crypto";
import { access, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMarkdownPatchPreview } from "../../agent-command-center/workspace-patch-preview.js";
import { makeHomeTempDir } from "./home-test-tmp.js";
import { applyWorkspacePatch, type WorkspacePatchApplyInput } from "./workspace-patch-apply.js";

describe("Workspace Patch Apply V0 server helper", () => {
  let projectDir: string | undefined;
  const externalDirs: string[] = [];

  beforeEach(async () => {
    projectDir = await createProject();
  });

  afterEach(async () => {
    if (projectDir) {
      await rm(projectDir, { recursive: true, force: true });
      projectDir = undefined;
    }
    await Promise.all(externalDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("applies a normal chapter Markdown patch with valid hash and confirmation", async () => {
    const input = await requestFor("chapters/chapter-001.md", "旧章节正文\n", "新章节正文\n");

    const result = await applyWorkspacePatch(input);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.documentType).toBe("chapter_markdown");
    expect(result.changedFiles).toEqual(["chapters/chapter-001.md"]);
    expect(result.rollbackAvailable).toBe(true);
    expect(result).toMatchObject({
      noStateJsonWrite: true,
      noMemoryWrite: true,
      noFormalCommitApply: true,
      rollbackNote: "rollbackAvailable means transaction backup exists; UI undo is not yet implemented.",
    });
    await expect(readFile(join(requireProjectDir(), "chapters/chapter-001.md"), "utf-8")).resolves.toBe("新章节正文\n");
  });

  it("applies draft Markdown patches", async () => {
    const input = await requestFor("drafts/chapter-002.md", "旧草稿\n", "新草稿\n");

    const result = await applyWorkspacePatch(input);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.documentType).toBe("draft_markdown");
    await expect(readFile(join(requireProjectDir(), "drafts/chapter-002.md"), "utf-8")).resolves.toBe("新草稿\n");
  });

  it.each([
    ["notes/revision.md", "note_markdown"],
    ["reviews/chapter-001.md", "review_markdown"],
    ["quality-reports/chapter-001.md", "quality_report_markdown"],
    ["tasks/task-001.md", "task_log_markdown"],
  ] as const)("applies %s as an allowed ordinary Markdown target", async (targetPath, documentType) => {
    const input = await requestFor(targetPath, "before\n", "after\n");

    const result = await applyWorkspacePatch(input);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.documentType).toBe(documentType);
    await expect(readFile(join(requireProjectDir(), targetPath), "utf-8")).resolves.toBe("after\n");
  });

  it("rejects missing user confirmation without writing the target", async () => {
    const input = await requestFor("chapters/chapter-001.md", "旧章节正文\n", "新章节正文\n", {
      userConfirmed: false,
    });

    const result = await applyWorkspacePatch(input);

    expect(result).toMatchObject({ ok: false, code: "missing_user_confirmation" });
    await expect(readFile(join(requireProjectDir(), "chapters/chapter-001.md"), "utf-8")).resolves.toBe("旧章节正文\n");
  });

  it("rejects stale hash mismatches without writing the target", async () => {
    const input = await requestFor("chapters/chapter-001.md", "旧章节正文\n", "新章节正文\n", {
      expectedBeforeHash: sha256("stale\n"),
    });

    const result = await applyWorkspacePatch(input);

    expect(result).toMatchObject({ ok: false, code: "stale_hash_mismatch" });
    await expect(readFile(join(requireProjectDir(), "chapters/chapter-001.md"), "utf-8")).resolves.toBe("旧章节正文\n");
  });

  it("blocks symlink ancestors that escape the project root without writing the external target", async () => {
    const outsideDir = await makeHomeTempDir("story-engine-ui-workspace-patch-outside-");
    externalDirs.push(outsideDir);
    await mkdir(join(outsideDir, "nested"), { recursive: true });
    await writeFile(join(outsideDir, "nested", "chapter-001.md"), "external before\n", "utf-8");
    await mkdir(join(requireProjectDir(), "chapters"), { recursive: true });
    await symlink(outsideDir, join(requireProjectDir(), "chapters", "linked"), "dir");
    const input = await requestFor("chapters/linked/nested/chapter-001.md", "external before\n", "external after\n", {
      createTarget: false,
    });

    const result = await applyWorkspacePatch(input);

    expect(result).toMatchObject({ ok: false, code: "target_disk_unsafe" });
    await expect(readFile(join(outsideDir, "nested", "chapter-001.md"), "utf-8")).resolves.toBe("external before\n");
  });

  it("blocks symlink target files without writing the external target", async () => {
    const outsideDir = await makeHomeTempDir("story-engine-ui-workspace-patch-outside-");
    externalDirs.push(outsideDir);
    await writeFile(join(outsideDir, "outside.md"), "external before\n", "utf-8");
    await mkdir(join(requireProjectDir(), "chapters"), { recursive: true });
    await symlink(join(outsideDir, "outside.md"), join(requireProjectDir(), "chapters", "chapter-001.md"));
    const input = await requestFor("chapters/chapter-001.md", "external before\n", "external after\n", {
      createTarget: false,
    });

    const result = await applyWorkspacePatch(input);

    expect(result).toMatchObject({ ok: false, code: "target_disk_unsafe" });
    await expect(readFile(join(outsideDir, "outside.md"), "utf-8")).resolves.toBe("external before\n");
  });

  it("blocks .story-engine-tx symlink transaction roots before writing target or external artifacts", async () => {
    const outsideDir = await makeHomeTempDir("story-engine-ui-workspace-patch-tx-outside-");
    externalDirs.push(outsideDir);
    await symlink(outsideDir, join(requireProjectDir(), ".story-engine-tx"), "dir");
    const input = await requestFor("chapters/chapter-001.md", "before\n", "after\n", {
      idempotencyKey: "tx-root-symlink",
    });
    const txId = transactionIdFor(input.idempotencyKey);

    const result = await applyWorkspacePatch(input);

    expect(result).toMatchObject({ ok: false, code: "transaction_root_unsafe" });
    await expect(readFile(join(requireProjectDir(), "chapters", "chapter-001.md"), "utf-8")).resolves.toBe("before\n");
    await expectNoTransactionArtifacts(join(outsideDir, "workspace-patches", txId));
  });

  it("blocks workspace-patches symlink transaction parents before writing target or external artifacts", async () => {
    const outsideDir = await makeHomeTempDir("story-engine-ui-workspace-patch-tx-parent-outside-");
    externalDirs.push(outsideDir);
    await mkdir(join(requireProjectDir(), ".story-engine-tx"), { recursive: true });
    await symlink(outsideDir, join(requireProjectDir(), ".story-engine-tx", "workspace-patches"), "dir");
    const input = await requestFor("chapters/chapter-001.md", "before\n", "after\n", {
      idempotencyKey: "tx-parent-symlink",
    });
    const txId = transactionIdFor(input.idempotencyKey);

    const result = await applyWorkspacePatch(input);

    expect(result).toMatchObject({ ok: false, code: "transaction_root_unsafe" });
    await expect(readFile(join(requireProjectDir(), "chapters", "chapter-001.md"), "utf-8")).resolves.toBe("before\n");
    await expectNoTransactionArtifacts(join(outsideDir, txId));
  });

  it.each([
    "before.md",
    "after.md",
    "change-summary.md",
    "manifest.json",
  ] as const)("blocks transaction %s symlinks before writing target or external artifacts", async (fileName) => {
    const outsideDir = await makeHomeTempDir("story-engine-ui-workspace-patch-tx-file-outside-");
    externalDirs.push(outsideDir);
    await writeFile(join(outsideDir, fileName), "external before\n", "utf-8");
    const input = await requestFor("chapters/chapter-001.md", "before\n", "after\n", {
      idempotencyKey: `tx-file-symlink-${fileName}`,
    });
    const txDir = join(requireProjectDir(), ".story-engine-tx", "workspace-patches", transactionIdFor(input.idempotencyKey));
    await mkdir(txDir, { recursive: true });
    await symlink(join(outsideDir, fileName), join(txDir, fileName));

    const result = await applyWorkspacePatch(input);

    expect(result).toMatchObject({ ok: false, code: "transaction_file_unsafe" });
    await expect(readFile(join(outsideDir, fileName), "utf-8")).resolves.toBe("external before\n");
    await expect(readFile(join(requireProjectDir(), "chapters", "chapter-001.md"), "utf-8")).resolves.toBe("before\n");
  });

  it("blocks an existing transaction directory without a valid applied manifest instead of overwriting files", async () => {
    const input = await requestFor("chapters/chapter-001.md", "before\n", "after\n", {
      idempotencyKey: "existing-tx-without-applied-manifest",
    });
    const txDir = join(requireProjectDir(), ".story-engine-tx", "workspace-patches", transactionIdFor(input.idempotencyKey));
    await mkdir(txDir, { recursive: true });

    const result = await applyWorkspacePatch(input);

    expect(result).toMatchObject({ ok: false, code: "idempotency_key_conflict" });
    await expect(readFile(join(requireProjectDir(), "chapters", "chapter-001.md"), "utf-8")).resolves.toBe("before\n");
  });

  it("blocks symlink temp files before writing target or external content", async () => {
    const outsideDir = await makeHomeTempDir("story-engine-ui-workspace-patch-temp-outside-");
    externalDirs.push(outsideDir);
    await writeFile(join(outsideDir, "outside.md"), "external before\n", "utf-8");
    const input = await requestFor("chapters/chapter-001.md", "before\n", "after\n", {
      idempotencyKey: "temp-file-symlink",
    });
    await symlink(join(outsideDir, "outside.md"), tempPathFor(requireProjectDir(), "chapters/chapter-001.md", input.idempotencyKey));

    const result = await applyWorkspacePatch(input);

    expect(result).toMatchObject({ ok: false, code: "temp_file_unsafe" });
    await expect(readFile(join(outsideDir, "outside.md"), "utf-8")).resolves.toBe("external before\n");
    await expect(readFile(join(requireProjectDir(), "chapters", "chapter-001.md"), "utf-8")).resolves.toBe("before\n");
  });

  it("blocks existing regular temp files instead of overwriting them", async () => {
    const input = await requestFor("chapters/chapter-001.md", "before\n", "after\n", {
      idempotencyKey: "temp-file-existing",
    });
    await writeFile(tempPathFor(requireProjectDir(), "chapters/chapter-001.md", input.idempotencyKey), "existing temp\n", "utf-8");

    const result = await applyWorkspacePatch(input);

    expect(result).toMatchObject({ ok: false, code: "temp_file_unsafe" });
    await expect(readFile(join(requireProjectDir(), "chapters", "chapter-001.md"), "utf-8")).resolves.toBe("before\n");
  });

  it("blocks final pre-rename stale hash mismatches and preserves the user's latest target content", async () => {
    const input = await requestFor("chapters/chapter-001.md", "before\n", "after\n", {
      idempotencyKey: "final-stale-before-rename",
    });
    const tempFile = tempPathFor(requireProjectDir(), "chapters/chapter-001.md", input.idempotencyKey);

    const result = await applyWorkspacePatch(input, {
      afterTempWriteBeforeRename: async () => {
        await writeFile(join(requireProjectDir(), "chapters", "chapter-001.md"), "user changed\n", "utf-8");
      },
    } as Parameters<typeof applyWorkspacePatch>[1] & {
      readonly afterTempWriteBeforeRename: () => Promise<void>;
    });

    expect(result).toMatchObject({ ok: false, code: "stale_hash_mismatch" });
    await expect(readFile(join(requireProjectDir(), "chapters", "chapter-001.md"), "utf-8")).resolves.toBe("user changed\n");
    await expect(access(tempFile)).rejects.toThrow();
  });

  it("cleans up temp files when final target disk safety fails", async () => {
    const input = await requestFor("chapters/chapter-001.md", "before\n", "after\n", {
      idempotencyKey: "final-disk-safety-fails",
    });
    const targetFile = join(requireProjectDir(), "chapters", "chapter-001.md");
    const tempFile = tempPathFor(requireProjectDir(), "chapters/chapter-001.md", input.idempotencyKey);

    const result = await applyWorkspacePatch(input, {
      afterTempWriteBeforeRename: async () => {
        await rm(targetFile);
        await mkdir(targetFile);
      },
    } as Parameters<typeof applyWorkspacePatch>[1] & {
      readonly afterTempWriteBeforeRename: () => Promise<void>;
    });

    expect(result).toMatchObject({ ok: false, code: "target_disk_unsafe" });
    await expect(access(tempFile)).rejects.toThrow();
  });

  it("cleans up temp files when the target disappears before final rename", async () => {
    const input = await requestFor("chapters/chapter-001.md", "before\n", "after\n", {
      idempotencyKey: "final-read-fails",
    });
    const targetFile = join(requireProjectDir(), "chapters", "chapter-001.md");
    const tempFile = tempPathFor(requireProjectDir(), "chapters/chapter-001.md", input.idempotencyKey);

    const result = await applyWorkspacePatch(input, {
      afterTempWriteBeforeRename: async () => {
        await rm(targetFile);
      },
    } as Parameters<typeof applyWorkspacePatch>[1] & {
      readonly afterTempWriteBeforeRename: () => Promise<void>;
    });

    expect(result).toMatchObject({ ok: false, code: "target_read_failed" });
    await expect(access(tempFile)).rejects.toThrow();
  });

  it("cleans up temp files when rename fails and preserves the target", async () => {
    const input = await requestFor("chapters/chapter-001.md", "before\n", "after\n", {
      idempotencyKey: "rename-failure-cleanup",
    });
    const tempFile = tempPathFor(requireProjectDir(), "chapters/chapter-001.md", input.idempotencyKey);

    const result = await applyWorkspacePatch(input, {
      renameTempFile: async () => {
        throw new Error("simulated rename failure");
      },
    } as Parameters<typeof applyWorkspacePatch>[1] & {
      readonly renameTempFile: (tempFile: string, targetFile: string) => Promise<void>;
    });

    expect(result).toMatchObject({ ok: false, code: "write_failed" });
    await expect(readFile(join(requireProjectDir(), "chapters", "chapter-001.md"), "utf-8")).resolves.toBe("before\n");
    await expect(access(tempFile)).rejects.toThrow();
    expect(result.warnings.join(" ")).not.toContain("temp_cleanup_failed");
  });

  it("does not follow temp symlinks during cleanup", async () => {
    const outsideDir = await makeHomeTempDir("story-engine-ui-workspace-patch-temp-cleanup-outside-");
    externalDirs.push(outsideDir);
    await writeFile(join(outsideDir, "outside.md"), "external before\n", "utf-8");
    const input = await requestFor("chapters/chapter-001.md", "before\n", "after\n", {
      idempotencyKey: "temp-cleanup-symlink",
    });
    const targetFile = join(requireProjectDir(), "chapters", "chapter-001.md");
    const tempFile = tempPathFor(requireProjectDir(), "chapters/chapter-001.md", input.idempotencyKey);

    const result = await applyWorkspacePatch(input, {
      afterTempWriteBeforeRename: async () => {
        await rm(tempFile);
        await symlink(join(outsideDir, "outside.md"), tempFile);
        await writeFile(targetFile, "user changed\n", "utf-8");
      },
    } as Parameters<typeof applyWorkspacePatch>[1] & {
      readonly afterTempWriteBeforeRename: () => Promise<void>;
    });

    expect(result).toMatchObject({ ok: false, code: "stale_hash_mismatch" });
    await expect(readFile(targetFile, "utf-8")).resolves.toBe("user changed\n");
    await expect(readFile(join(outsideDir, "outside.md"), "utf-8")).resolves.toBe("external before\n");
    await expect(lstat(tempFile).then((info) => info.isSymbolicLink())).resolves.toBe(true);
    expect(result.warnings.join(" ")).toContain("temp cleanup skipped because file is not a regular temp file");
  });

  it("revalidates temp files after runtime hooks and blocks symlink replacement before rename", async () => {
    const outsideDir = await makeHomeTempDir("story-engine-ui-workspace-patch-temp-replace-outside-");
    externalDirs.push(outsideDir);
    await writeFile(join(outsideDir, "outside.md"), "external before\n", "utf-8");
    const input = await requestFor("chapters/chapter-001.md", "before\n", "after\n", {
      idempotencyKey: "temp-post-hook-symlink-replacement",
    });
    const targetFile = join(requireProjectDir(), "chapters", "chapter-001.md");
    const tempFile = tempPathFor(requireProjectDir(), "chapters/chapter-001.md", input.idempotencyKey);

    const result = await applyWorkspacePatch(input, {
      afterTempWriteBeforeRename: async () => {
        await rm(tempFile);
        await symlink(join(outsideDir, "outside.md"), tempFile);
      },
    } as Parameters<typeof applyWorkspacePatch>[1] & {
      readonly afterTempWriteBeforeRename: () => Promise<void>;
    });

    expect(result).toMatchObject({ ok: false, code: "temp_file_unsafe" });
    await expect(readFile(targetFile, "utf-8")).resolves.toBe("before\n");
    await expect(readFile(join(outsideDir, "outside.md"), "utf-8")).resolves.toBe("external before\n");
    await expect(lstat(tempFile).then((info) => info.isSymbolicLink())).resolves.toBe(true);
    expect(result.warnings.join(" ")).toContain("temp cleanup skipped because file is not a regular temp file");
  });

  it("revalidates temp content hash after runtime hooks and blocks regular file replacement before rename", async () => {
    const input = await requestFor("chapters/chapter-001.md", "before\n", "after\n", {
      idempotencyKey: "temp-post-hook-content-replacement",
    });
    const targetFile = join(requireProjectDir(), "chapters", "chapter-001.md");
    const tempFile = tempPathFor(requireProjectDir(), "chapters/chapter-001.md", input.idempotencyKey);

    const result = await applyWorkspacePatch(input, {
      afterTempWriteBeforeRename: async () => {
        await rm(tempFile);
        await writeFile(tempFile, "unexpected replacement\n", "utf-8");
      },
    } as Parameters<typeof applyWorkspacePatch>[1] & {
      readonly afterTempWriteBeforeRename: () => Promise<void>;
    });

    expect(result).toMatchObject({ ok: false, code: "temp_file_unsafe" });
    if (result.ok) throw new Error("expected temp hash mismatch to fail");
    await expect(readFile(targetFile, "utf-8")).resolves.toBe("before\n");
    await expect(access(tempFile)).rejects.toThrow();
    expect(result.reasons.join(" ")).toContain("temp file content hash does not match afterText hash");
  });

  it.each([
    ["../outside.md", "path_safety_failed"],
    ["chapters/../../outside.md", "path_safety_failed"],
    ["/tmp/outside.md", "path_safety_failed"],
    [".env", "path_safety_failed"],
    [".story-engine-tx/tx/manifest.json", "path_safety_failed"],
    ["story/state/hooks.json", "target_not_allowed_v0"],
    ["memory/project.json", "target_not_allowed_v0"],
    ["random.md", "target_not_allowed_v0"],
    ["skills/chapter-writing.md", "target_not_allowed_v0"],
    ["constitution.md", "target_not_allowed_v0"],
    ["characters/protagonist.md", "target_not_allowed_v0"],
    ["worldbuilding/rules.md", "target_not_allowed_v0"],
  ] as const)("blocks protected or unsupported target %s", async (targetPath, code) => {
    const input = await requestFor(targetPath, "before\n", "after\n", {
      createTarget: targetPath.endsWith(".md") && !targetPath.startsWith("../") && !targetPath.startsWith("/"),
    });

    const result = await applyWorkspacePatch(input);

    expect(result).toMatchObject({ ok: false, code });
  });

  it("creates transaction manifest, before, after, and change summary on success", async () => {
    const input = await requestFor("chapters/chapter-001.md", "旧章节正文\n", "新章节正文\n");

    const result = await applyWorkspacePatch(input);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const txDir = join(requireProjectDir(), result.transactionPath);
    await expect(access(join(txDir, "manifest.json"))).resolves.toBeUndefined();
    await expect(readFile(join(txDir, "before.md"), "utf-8")).resolves.toBe("旧章节正文\n");
    await expect(readFile(join(txDir, "after.md"), "utf-8")).resolves.toBe("新章节正文\n");
    await expect(readFile(join(txDir, "change-summary.md"), "utf-8")).resolves.toContain("chapters/chapter-001.md");
    const changeSummary = await readFile(join(txDir, "change-summary.md"), "utf-8");
    expect(changeSummary).toContain("## Safety");
    expect(changeSummary).toContain("Markdown Workspace edit");
    expect(changeSummary).toContain("not Formal Commit apply");
    expect(changeSummary).toContain("No state JSON was written");
    expect(changeSummary).toContain("No memory was written");
    expect(changeSummary).toContain("UI undo is not yet implemented");
    const manifest = JSON.parse(await readFile(join(txDir, "manifest.json"), "utf-8")) as {
      readonly targetPath?: string;
      readonly documentType?: string;
      readonly beforeHash?: string;
      readonly afterHash?: string;
      readonly rollbackAvailable?: boolean;
      readonly changedFiles?: readonly string[];
    };
    expect(manifest).toMatchObject({
      targetPath: "chapters/chapter-001.md",
      documentType: "chapter_markdown",
      beforeHash: sha256("旧章节正文\n"),
      afterHash: sha256("新章节正文\n"),
      rollbackAvailable: true,
      changedFiles: ["chapters/chapter-001.md"],
    });
  });

  it("returns the existing result for repeated same idempotencyKey", async () => {
    const input = await requestFor("chapters/chapter-001.md", "旧章节正文\n", "新章节正文\n", {
      idempotencyKey: "same-idempotency-key",
    });

    const first = await applyWorkspacePatch(input);
    const second = await applyWorkspacePatch(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected idempotent success");
    expect(second.patchApplyTxId).toBe(first.patchApplyTxId);
    expect(second).toMatchObject({
      noStateJsonWrite: true,
      noMemoryWrite: true,
      noFormalCommitApply: true,
      rollbackNote: "rollbackAvailable means transaction backup exists; UI undo is not yet implemented.",
    });
    expect(second.warnings.join(" ")).toContain("idempotency");
  });

  it("returns success with post_apply_audit_failed warning when final manifest write fails after rename", async () => {
    const input = await requestFor("chapters/chapter-001.md", "旧章节正文\n", "新章节正文\n");

    const result = await applyWorkspacePatch(input, {
      writeAppliedManifest: async () => {
        throw new Error("simulated applied manifest failure");
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.warnings.join(" ")).toContain("post_apply_audit_failed");
    await expect(readFile(join(requireProjectDir(), "chapters/chapter-001.md"), "utf-8")).resolves.toBe("新章节正文\n");
  });

  it("blocks conflicting repeated idempotencyKey", async () => {
    const firstInput = await requestFor("chapters/chapter-001.md", "旧章节正文\n", "新章节正文\n", {
      idempotencyKey: "conflicting-idempotency-key",
    });
    const first = await applyWorkspacePatch(firstInput);
    expect(first.ok).toBe(true);

    const conflicting = await requestFor("drafts/chapter-002.md", "旧草稿\n", "不同内容\n", {
      idempotencyKey: "conflicting-idempotency-key",
    });

    const result = await applyWorkspacePatch(conflicting);

    expect(result).toMatchObject({ ok: false, code: "idempotency_key_conflict" });
  });

  it("keeps implementation source free of Formal Commit and model execution APIs", async () => {
    const source = await readFile(resolve(process.cwd(), "src/server/lib/workspace-patch-apply.ts"), "utf-8");

    expect(source).not.toContain("applyCommit");
    expect(source).not.toContain("commitFastDraft");
    expect(source).not.toContain("CommitEngine");
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("story/state");
    expect(source).not.toContain("memory/");
  });

  async function requestFor(
    targetPath: string,
    beforeText: string,
    afterText: string,
    overrides: Partial<WorkspacePatchApplyInput> & { readonly createTarget?: boolean } = {},
  ): Promise<WorkspacePatchApplyInput> {
    if (overrides.createTarget !== false && !targetPath.includes("..") && !targetPath.startsWith("/") && !targetPath.startsWith(".")) {
      await mkdir(join(requireProjectDir(), targetPath.split("/").slice(0, -1).join("/")), { recursive: true });
      await writeFile(join(requireProjectDir(), targetPath), beforeText, "utf-8");
    }
    const preview = buildMarkdownPatchPreview({ targetPath, beforeText, afterText });
    return {
      projectDir: requireProjectDir(),
      targetPath,
      beforeText,
      afterText,
      patchId: preview.patchId,
      expectedBeforeHash: sha256(beforeText),
      userConfirmed: true,
      idempotencyKey: `idem-${sha256(targetPath).slice(0, 16)}`,
      ...overrides,
    };
  }

  function requireProjectDir(): string {
    if (!projectDir) throw new Error("missing test project");
    return projectDir;
  }
});

async function expectNoTransactionArtifacts(transactionDir: string): Promise<void> {
  await Promise.all([
    expect(access(join(transactionDir, "manifest.json"))).rejects.toThrow(),
    expect(access(join(transactionDir, "before.md"))).rejects.toThrow(),
    expect(access(join(transactionDir, "after.md"))).rejects.toThrow(),
    expect(access(join(transactionDir, "change-summary.md"))).rejects.toThrow(),
  ]);
}

function transactionIdFor(idempotencyKey: string): string {
  return `workspace-patch-${sha256(idempotencyKey).slice(0, 16)}`;
}

function tempPathFor(projectDir: string, targetPath: string, idempotencyKey: string): string {
  const targetFile = join(projectDir, targetPath);
  const tempFileName = `${targetPath.split("/").at(-1) ?? "workspace-patch"}.${transactionIdFor(idempotencyKey)}.tmp`;
  return join(targetFile, "..", tempFileName);
}

async function createProject(): Promise<string> {
  const root = await makeHomeTempDir("story-engine-ui-workspace-patch-apply-");
  await Promise.all([
    mkdir(join(root, "story", "state"), { recursive: true }),
    mkdir(join(root, "timeline"), { recursive: true }),
    mkdir(join(root, "world"), { recursive: true }),
    mkdir(join(root, "characters"), { recursive: true }),
  ]);
  await writeFile(join(root, "project.json"), JSON.stringify({ title: "Patch Apply Test" }), "utf-8");
  await writeFile(join(root, "story", "state", "hooks.json"), "[]\n", "utf-8");
  await writeFile(join(root, "memory", "project.json"), "{}\n", "utf-8").catch(async () => {
    await mkdir(join(root, "memory"), { recursive: true });
    await writeFile(join(root, "memory", "project.json"), "{}\n", "utf-8");
  });
  return root;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}
