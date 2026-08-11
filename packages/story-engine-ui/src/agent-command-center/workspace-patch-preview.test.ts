import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildLineDiff,
  buildMarkdownPatchPreview,
  canPreviewPatchForPath,
  classifyPatchRisk,
  summarizePatchPreview,
} from "./workspace-patch-preview.js";

const packageRoot = process.cwd();

async function source(relativePath: string): Promise<string> {
  return readFile(resolve(packageRoot, relativePath), "utf-8");
}

describe("Workspace Patch Diff Preview V1", () => {
  it("builds preview-only chapter markdown update previews", () => {
    const preview = buildMarkdownPatchPreview({
      targetPath: "chapters/chapter-001.md",
      beforeText: "旧章节\n第二行",
      afterText: "新章节\n第二行",
      title: "调整第一段",
      reason: "用户要求换开头",
    });

    expect(preview.patchId).toContain("patch-preview-");
    expect(preview.targetPath).toBe("chapters/chapter-001.md");
    expect(preview.documentType).toBe("chapter_markdown");
    expect(preview.changeKind).toBe("update");
    expect(preview.riskLevel).toBe("low");
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.requiresStrongConfirmation).toBe(false);
    expect(preview.canApplyInV1).toBe(false);
    expect(preview.audit.isPreviewOnly).toBe(true);
    expect(preview.audit.willWriteFiles).toBe(false);
    expect(preview.audit.willWriteMemory).toBe(false);
    expect(preview.audit.willApplyPatch).toBe(false);
  });

  it("builds preview-only draft markdown update previews", () => {
    const preview = buildMarkdownPatchPreview({
      targetPath: "drafts/chapter-002.md",
      beforeText: "旧草稿",
      afterText: "新草稿",
    });

    expect(preview.documentType).toBe("draft_markdown");
    expect(preview.canApplyInV1).toBe(false);
    expect(preview.audit.isPreviewOnly).toBe(true);
  });

  it("builds preview-only review markdown update previews", () => {
    const preview = buildMarkdownPatchPreview({
      targetPath: "reviews/chapter-001.md",
      beforeText: "旧审稿",
      afterText: "新审稿",
    });

    expect(preview.documentType).toBe("review_markdown");
    expect(preview.riskLevel).toBe("low");
    expect(preview.canApplyInV1).toBe(false);
  });

  it("marks skill markdown as high risk and confirmation-gated", () => {
    const preview = buildMarkdownPatchPreview({
      targetPath: "skills/chapter-writing.md",
      beforeText: "旧技能",
      afterText: "新技能",
    });

    expect(preview.documentType).toBe("skill_markdown");
    expect(preview.riskLevel).toBe("high");
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.requiresStrongConfirmation).toBe(false);
    expect(preview.warnings.join(" ")).toContain("impact");
  });

  it("marks constitution markdown as high risk and strong-confirmation-gated", () => {
    const preview = buildMarkdownPatchPreview({
      targetPath: "constitution.md",
      beforeText: "旧宪法",
      afterText: "新宪法",
    });

    expect(preview.documentType).toBe("constitution_markdown");
    expect(preview.riskLevel).toBe("high");
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.requiresStrongConfirmation).toBe(true);
  });

  it("blocks unknown markdown", () => {
    const preview = buildMarkdownPatchPreview({
      targetPath: "random.md",
      beforeText: "旧内容",
      afterText: "新内容",
    });

    expect(preview.documentType).toBe("unknown_markdown");
    expect(preview.riskLevel).toBe("blocked");
    expect(preview.canApplyInV1).toBe(false);
    expect(preview.blockedReasons.join(" ")).toContain("unknown");
    expect(canPreviewPatchForPath("random.md")).toBe(false);
  });

  it("blocks JSON state paths", () => {
    const preview = buildMarkdownPatchPreview({
      targetPath: "story/state/hooks.json",
      beforeText: "{}",
      afterText: "{\"changed\":true}",
    });

    expect(preview.riskLevel).toBe("blocked");
    expect(preview.blockedReasons.join(" ")).toContain("json_state");
    expect(canPreviewPatchForPath("story/state/hooks.json")).toBe(false);
  });

  it("blocks memory paths", () => {
    const preview = buildMarkdownPatchPreview({
      targetPath: "memory/project.md",
      beforeText: "旧记忆",
      afterText: "新记忆",
    });

    expect(preview.riskLevel).toBe("blocked");
    expect(preview.blockedReasons.join(" ")).toContain("memory_record");
    expect(canPreviewPatchForPath("memory/project.md")).toBe(false);
  });

  it("blocks transaction paths", () => {
    const preview = buildMarkdownPatchPreview({
      targetPath: ".story-engine-tx/tx-1/manifest.json",
      beforeText: "{}",
      afterText: "{}",
    });

    expect(preview.riskLevel).toBe("blocked");
    expect(preview.blockedReasons.join(" ")).toContain("transaction_record");
    expect(canPreviewPatchForPath(".story-engine-tx/tx-1/manifest.json")).toBe(false);
  });

  it("builds simple line diffs with removed and added lines", () => {
    const diffText = buildLineDiff("alpha\nbeta", "alpha\ngamma");

    expect(diffText).toContain("- beta");
    expect(diffText).toContain("+ gamma");
  });

  it("summarizes preview status and risk", () => {
    const summary = summarizePatchPreview(
      buildMarkdownPatchPreview({
        targetPath: "notes/idea.md",
        beforeText: "旧笔记",
        afterText: "新笔记",
      }),
    );

    expect(summary).toContain("notes/idea.md");
    expect(summary).toContain("note_markdown");
    expect(summary).toContain("previewOnly=true");
    expect(summary).toContain("canApplyInV1=false");
    expect(summary).toContain("willWriteMemory=false");
  });

  it("classifies patch risk without reading files", () => {
    expect(classifyPatchRisk("chapters/chapter-001.md")).toBe("low");
    expect(classifyPatchRisk("skills/chapter-writing.md")).toBe("high");
    expect(classifyPatchRisk("constitution.md")).toBe("high");
    expect(classifyPatchRisk("story/state/hooks.json")).toBe("blocked");
  });

  it("keeps helper source free of runtime I/O and execution APIs", async () => {
    const helperSource = await source("src/agent-command-center/workspace-patch-preview.ts");

    expect(helperSource).not.toContain("writeFile");
    expect(helperSource).not.toContain("fs.write");
    expect(helperSource).not.toContain("readFile");
    expect(helperSource).not.toContain("fetch(");
    expect(helperSource).not.toContain("applyCommit");
    expect(helperSource).not.toContain("commitFastDraft");
    expect(helperSource).not.toContain("CommitEngine");
  });
});
