import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildMarkdownPatchPreview, type WorkspacePatchPreview } from "./workspace-patch-preview.js";
import {
  evaluateWorkspacePatchApplyReadiness,
  summarizePatchApplyReadiness,
} from "./workspace-patch-apply-readiness.js";

const packageRoot = process.cwd();

async function source(relativePath: string): Promise<string> {
  return readFile(resolve(packageRoot, relativePath), "utf-8");
}

function previewFor(targetPath: string): WorkspacePatchPreview {
  return buildMarkdownPatchPreview({
    targetPath,
    beforeText: "before",
    afterText: "after",
  });
}

describe("Workspace Patch Apply Readiness V1", () => {
  it("requires confirmation for normal chapter previews before any future apply", () => {
    const readiness = evaluateWorkspacePatchApplyReadiness({
      preview: previewFor("chapters/chapter-001.md"),
      targetPath: "chapters/chapter-001.md",
      userConfirmed: false,
      strongConfirmed: false,
    });

    expect(readiness.readyToApply).toBe(false);
    expect(readiness.decision).toBe("needs_confirmation");
    expect(readiness.requiredChecks).toContain("user_confirmation");
  });

  it("still blocks confirmed normal chapter previews because canApplyInV1 is false", () => {
    const readiness = evaluateWorkspacePatchApplyReadiness({
      preview: previewFor("chapters/chapter-001.md"),
      targetPath: "chapters/chapter-001.md",
      userConfirmed: true,
      strongConfirmed: false,
    });

    expect(readiness.readyToApply).toBe(false);
    expect(readiness.decision).toBe("blocked");
    expect(readiness.reasons.join(" ")).toContain("canApplyInV1");
  });

  it("requires strong confirmation for constitution previews before future apply", () => {
    const readiness = evaluateWorkspacePatchApplyReadiness({
      preview: previewFor("constitution.md"),
      targetPath: "constitution.md",
      userConfirmed: true,
      strongConfirmed: false,
    });

    expect(readiness.readyToApply).toBe(false);
    expect(readiness.decision).toBe("needs_strong_confirmation");
    expect(readiness.requiredChecks).toContain("strong_confirmation");
  });

  it("requires confirmation and warns about skill impact for skill previews", () => {
    const readiness = evaluateWorkspacePatchApplyReadiness({
      preview: previewFor("skills/chapter-writing.md"),
      targetPath: "skills/chapter-writing.md",
      userConfirmed: false,
      strongConfirmed: false,
    });

    expect(readiness.readyToApply).toBe(false);
    expect(readiness.decision).toBe("needs_confirmation");
    expect(readiness.warnings.join(" ")).toContain("skill");
    expect(readiness.warnings.join(" ")).toContain("impact");
  });

  it("blocks unknown markdown previews", () => {
    const readiness = evaluateWorkspacePatchApplyReadiness({
      preview: previewFor("random.md"),
      targetPath: "random.md",
      userConfirmed: true,
      strongConfirmed: true,
    });

    expect(readiness.readyToApply).toBe(false);
    expect(readiness.decision).toBe("blocked");
    expect(readiness.reasons.join(" ")).toContain("unknown_markdown");
  });

  it("blocks state json previews", () => {
    const readiness = evaluateWorkspacePatchApplyReadiness({
      preview: previewFor("story/state/hooks.json"),
      targetPath: "story/state/hooks.json",
      userConfirmed: true,
      strongConfirmed: true,
    });

    expect(readiness.decision).toBe("blocked");
    expect(readiness.reasons.join(" ")).toContain("json_state");
  });

  it("blocks memory path previews", () => {
    const readiness = evaluateWorkspacePatchApplyReadiness({
      preview: previewFor("memory/project.md"),
      targetPath: "memory/project.md",
      userConfirmed: true,
      strongConfirmed: true,
    });

    expect(readiness.decision).toBe("blocked");
    expect(readiness.reasons.join(" ")).toContain("memory_record");
  });

  it("blocks transaction path previews", () => {
    const readiness = evaluateWorkspacePatchApplyReadiness({
      preview: previewFor(".story-engine-tx/tx-1/manifest.json"),
      targetPath: ".story-engine-tx/tx-1/manifest.json",
      userConfirmed: true,
      strongConfirmed: true,
    });

    expect(readiness.decision).toBe("blocked");
    expect(readiness.reasons.join(" ")).toContain("transaction_record");
  });

  it("blocks stale patch previews when expected and current hashes differ", () => {
    const readiness = evaluateWorkspacePatchApplyReadiness({
      preview: previewFor("chapters/chapter-001.md"),
      targetPath: "chapters/chapter-001.md",
      userConfirmed: true,
      strongConfirmed: false,
      expectedBeforeHash: "hash-before-preview",
      currentFileHash: "hash-now",
    });

    expect(readiness.readyToApply).toBe(false);
    expect(readiness.decision).toBe("blocked");
    expect(readiness.reasons.join(" ")).toContain("stale patch");
  });

  it("blocks unsafe audit flags", () => {
    const unsafePreview = {
      ...previewFor("chapters/chapter-001.md"),
      audit: {
        isPreviewOnly: false,
        willWriteFiles: true,
        willWriteMemory: true,
        willModifyStateJson: true,
        willApplyPatch: true,
        generatedAt: new Date(0).toISOString(),
      },
    } as unknown as WorkspacePatchPreview;

    const readiness = evaluateWorkspacePatchApplyReadiness({
      preview: unsafePreview,
      targetPath: "chapters/chapter-001.md",
      userConfirmed: true,
      strongConfirmed: false,
    });

    expect(readiness.readyToApply).toBe(false);
    expect(readiness.decision).toBe("blocked");
    expect(readiness.reasons.join(" ")).toContain("preview-only");
    expect(readiness.reasons.join(" ")).toContain("willWriteFiles");
    expect(readiness.reasons.join(" ")).toContain("willApplyPatch");
    expect(readiness.reasons.join(" ")).toContain("willModifyStateJson");
    expect(readiness.reasons.join(" ")).toContain("willWriteMemory");
  });

  it("summarizes readiness without implying apply will run", () => {
    const readiness = evaluateWorkspacePatchApplyReadiness({
      preview: previewFor("chapters/chapter-001.md"),
      targetPath: "chapters/chapter-001.md",
      userConfirmed: false,
      strongConfirmed: false,
    });

    const summary = summarizePatchApplyReadiness(readiness);

    expect(summary).toContain("needs_confirmation");
    expect(summary).toContain("readyToApply=false");
    expect(summary).toContain("willWriteFiles=false");
    expect(summary).toContain("willWriteMemory=false");
  });

  it("keeps readiness helper source free of runtime I/O and execution APIs", async () => {
    const helperSource = await source("src/agent-command-center/workspace-patch-apply-readiness.ts");

    expect(helperSource).not.toContain("writeFile");
    expect(helperSource).not.toContain("readFile");
    expect(helperSource).not.toContain("fs.write");
    expect(helperSource).not.toContain("fetch(");
    expect(helperSource).not.toContain("applyCommit");
    expect(helperSource).not.toContain("commitFastDraft");
    expect(helperSource).not.toContain("CommitEngine");
  });
});
