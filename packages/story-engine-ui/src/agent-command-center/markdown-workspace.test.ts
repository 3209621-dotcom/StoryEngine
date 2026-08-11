import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  canAgentProposeMarkdownEdit,
  canAgentReadMarkdown,
  canDirectlyWriteMarkdownInV1,
  canPatchApplyMarkdownInFuture,
  classifyMarkdownDocumentType,
  getMarkdownDocumentPolicy,
  requiresMarkdownPatchConfirmation,
  requiresMarkdownStrongConfirmation,
  summarizeMarkdownWorkspacePolicy,
} from "./markdown-workspace.js";

const packageRoot = process.cwd();

async function source(relativePath: string): Promise<string> {
  return readFile(resolve(packageRoot, relativePath), "utf-8");
}

describe("Markdown Workspace Foundation V1", () => {
  it("classifies chapter markdown as future patch proposal content", () => {
    const path = "chapters/chapter-001.md";
    const policy = getMarkdownDocumentPolicy(classifyMarkdownDocumentType(path));

    expect(classifyMarkdownDocumentType(path)).toBe("chapter_markdown");
    expect(policy.defaultLayer).toBe("markdown_workspace");
    expect(policy.role).toBe("markdown_chapter");
    expect(canAgentReadMarkdown(path)).toBe(true);
    expect(canAgentProposeMarkdownEdit(path)).toBe(true);
    expect(requiresMarkdownPatchConfirmation(path)).toBe(true);
    expect(canDirectlyWriteMarkdownInV1(path)).toBe(false);
    expect(canPatchApplyMarkdownInFuture(path)).toBe(true);
  });

  it("classifies manuscript markdown as chapter markdown", () => {
    expect(classifyMarkdownDocumentType("manuscript/chapter-001.md")).toBe("chapter_markdown");
  });

  it("classifies drafts as editable future patch proposal content", () => {
    const path = "drafts/chapter-002.md";

    expect(classifyMarkdownDocumentType(path)).toBe("draft_markdown");
    expect(canAgentProposeMarkdownEdit(path)).toBe(true);
    expect(requiresMarkdownPatchConfirmation(path)).toBe(true);
  });

  it("classifies outline markdown", () => {
    expect(classifyMarkdownDocumentType("outlines/book.md")).toBe("outline_markdown");
    expect(canAgentProposeMarkdownEdit("outlines/book.md")).toBe(true);
  });

  it("requires confirmation for character markdown", () => {
    const path = "characters/protagonist.md";

    expect(classifyMarkdownDocumentType(path)).toBe("character_markdown");
    expect(classifyMarkdownDocumentType("characters.md")).toBe("character_markdown");
    expect(canAgentProposeMarkdownEdit(path)).toBe(true);
    expect(requiresMarkdownPatchConfirmation(path)).toBe(true);
    expect(requiresMarkdownStrongConfirmation(path)).toBe(false);
  });

  it("classifies worldbuilding markdown", () => {
    expect(classifyMarkdownDocumentType("worldbuilding/rules.md")).toBe("world_markdown");
    expect(canAgentProposeMarkdownEdit("worldbuilding/rules.md")).toBe(true);
  });

  it("classifies review and quality report markdown", () => {
    expect(classifyMarkdownDocumentType("reviews/chapter-001.md")).toBe("review_markdown");
    expect(classifyMarkdownDocumentType("quality-reports/chapter-001.md")).toBe("quality_report_markdown");
    expect(canAgentProposeMarkdownEdit("reviews/chapter-001.md")).toBe(true);
    expect(canAgentProposeMarkdownEdit("quality-reports/chapter-001.md")).toBe(true);
  });

  it("classifies task logs as markdown workspace content", () => {
    expect(classifyMarkdownDocumentType("tasks/task-001.md")).toBe("task_log_markdown");
    expect(canAgentProposeMarkdownEdit("tasks/task-001.md")).toBe(true);
  });

  it("requires confirmation and impact notes for skill markdown", () => {
    const policy = getMarkdownDocumentPolicy("skill_markdown");

    expect(classifyMarkdownDocumentType("skills/chapter-writing.md")).toBe("skill_markdown");
    expect(policy.requiresPatchConfirmation).toBe(true);
    expect(policy.requiresStrongConfirmation).toBe(false);
    expect(policy.notes.join(" ")).toContain("impact");
  });

  it("requires strong confirmation for constitution markdown", () => {
    const path = "constitution.md";

    expect(classifyMarkdownDocumentType(path)).toBe("constitution_markdown");
    expect(classifyMarkdownDocumentType("constitution/core.md")).toBe("constitution_markdown");
    expect(canAgentProposeMarkdownEdit(path)).toBe(true);
    expect(requiresMarkdownPatchConfirmation(path)).toBe(true);
    expect(requiresMarkdownStrongConfirmation(path)).toBe(true);
    expect(canDirectlyWriteMarkdownInV1(path)).toBe(false);
  });

  it("blocks unknown markdown by default", () => {
    const path = "random.md";

    expect(classifyMarkdownDocumentType(path)).toBe("unknown_markdown");
    expect(canAgentReadMarkdown(path)).toBe(false);
    expect(canAgentProposeMarkdownEdit(path)).toBe(false);
    expect(requiresMarkdownPatchConfirmation(path)).toBe(false);
    expect(canPatchApplyMarkdownInFuture(path)).toBe(false);
  });

  it("blocks non-markdown paths", () => {
    const path = "chapters/chapter-001.txt";

    expect(classifyMarkdownDocumentType(path)).toBe("unknown_markdown");
    expect(canAgentReadMarkdown(path)).toBe(false);
    expect(canAgentProposeMarkdownEdit(path)).toBe(false);
  });

  it("summarizes markdown workspace policy", () => {
    const summary = summarizeMarkdownWorkspacePolicy("skills/chapter-writing.md");

    expect(summary).toContain("skill_markdown");
    expect(summary).toContain("layer=markdown_workspace");
    expect(summary).toContain("proposeEdit=true");
    expect(summary).toContain("directWriteV1=false");
  });

  it("keeps the helper free of runtime execution and write APIs", async () => {
    const helperSource = await source("src/agent-command-center/markdown-workspace.ts");

    expect(helperSource).not.toContain("fetch(");
    expect(helperSource).not.toContain("applyCommit");
    expect(helperSource).not.toContain("commitFastDraft");
    expect(helperSource).not.toContain("CommitEngine");
    expect(helperSource).not.toContain("writeFile");
    expect(helperSource).not.toContain("fs.write");
  });
});
