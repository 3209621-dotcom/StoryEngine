import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  canAgentProposeEdit,
  canAgentRead,
  classifyWorkspaceLayer,
  classifyWorkspaceRole,
  isMarkdownWorkspacePath,
  isProtectedStatePath,
  requiresPatchConfirmation,
} from "./hybrid-workspace.js";

const packageRoot = process.cwd();

async function source(relativePath: string): Promise<string> {
  return readFile(resolve(packageRoot, relativePath), "utf-8");
}

describe("Hybrid Workspace Foundation V1", () => {
  it("classifies canonical JSON state as readable but not directly editable", () => {
    const path = "story/state/hooks.json";

    expect(classifyWorkspaceLayer(path)).toBe("json_state_engine");
    expect(classifyWorkspaceRole(path)).toBe("json_state");
    expect(canAgentRead(path)).toBe(true);
    expect(canAgentProposeEdit(path)).toBe(false);
    expect(isProtectedStatePath(path)).toBe(true);
    expect(requiresPatchConfirmation(path)).toBe(false);
  });

  it("protects top-level story state JSON files", () => {
    const path = "story/threads.json";

    expect(classifyWorkspaceLayer(path)).toBe("json_state_engine");
    expect(classifyWorkspaceRole(path)).toBe("json_state");
    expect(isProtectedStatePath(path)).toBe(true);
    expect(canAgentProposeEdit(path)).toBe(false);
  });

  it("protects transaction records from agent edits", () => {
    const path = ".story-engine-tx/tx-1/manifest.json";

    expect(classifyWorkspaceLayer(path)).toBe("json_state_engine");
    expect(classifyWorkspaceRole(path)).toBe("transaction_record");
    expect(canAgentRead(path)).toBe(true);
    expect(canAgentProposeEdit(path)).toBe(false);
    expect(isProtectedStatePath(path)).toBe(true);
  });

  it("allows chapter markdown only as future patch proposals", () => {
    const path = "chapters/chapter-001.md";

    expect(classifyWorkspaceLayer(path)).toBe("markdown_workspace");
    expect(classifyWorkspaceRole(path)).toBe("markdown_chapter");
    expect(canAgentRead(path)).toBe(true);
    expect(canAgentProposeEdit(path)).toBe(true);
    expect(requiresPatchConfirmation(path)).toBe(true);
    expect(isMarkdownWorkspacePath(path)).toBe(true);
  });

  it("allows draft markdown as future patch proposals", () => {
    const path = "drafts/chapter-002.md";

    expect(classifyWorkspaceLayer(path)).toBe("markdown_workspace");
    expect(classifyWorkspaceRole(path)).toBe("markdown_draft");
    expect(canAgentRead(path)).toBe(true);
    expect(canAgentProposeEdit(path)).toBe(true);
    expect(requiresPatchConfirmation(path)).toBe(true);
  });

  it("classifies notes and review markdown as editable workspace content", () => {
    expect(classifyWorkspaceRole("notes/review.md")).toBe("markdown_note");
    expect(canAgentProposeEdit("notes/review.md")).toBe(true);
    expect(requiresPatchConfirmation("notes/review.md")).toBe(true);

    expect(classifyWorkspaceRole("reviews/chapter-001.md")).toBe("markdown_review");
    expect(canAgentProposeEdit("reviews/chapter-001.md")).toBe(true);
  });

  it("requires confirmation for skill docs and strong confirmation for constitution docs", () => {
    expect(classifyWorkspaceRole("skills/chapter-writing.md")).toBe("markdown_skill");
    expect(canAgentProposeEdit("skills/chapter-writing.md")).toBe(true);
    expect(requiresPatchConfirmation("skills/chapter-writing.md")).toBe(true);

    expect(classifyWorkspaceRole("constitution.md")).toBe("markdown_constitution");
    expect(canAgentProposeEdit("constitution.md")).toBe(false);
    expect(requiresPatchConfirmation("constitution.md")).toBe(true);
  });

  it("classifies memory records as readable but not directly editable in V1", () => {
    const path = "memory/project.json";

    expect(classifyWorkspaceLayer(path)).toBe("memory_system");
    expect(classifyWorkspaceRole(path)).toBe("memory_record");
    expect(canAgentRead(path)).toBe(true);
    expect(canAgentProposeEdit(path)).toBe(false);
  });

  it("blocks unknown paths until explicitly handled", () => {
    const path = "assets/image.png";

    expect(classifyWorkspaceLayer(path)).toBe("unknown");
    expect(classifyWorkspaceRole(path)).toBe("unknown");
    expect(canAgentRead(path)).toBe(false);
    expect(canAgentProposeEdit(path)).toBe(false);
    expect(requiresPatchConfirmation(path)).toBe(false);
  });

  it("keeps the metadata helper free of runtime execution and write APIs", async () => {
    const helperSource = await source("src/agent-command-center/hybrid-workspace.ts");

    expect(helperSource).not.toContain("fetch(");
    expect(helperSource).not.toContain("applyCommit");
    expect(helperSource).not.toContain("commitFastDraft");
    expect(helperSource).not.toContain("CommitEngine");
    expect(helperSource).not.toContain("writeFile");
    expect(helperSource).not.toContain("fs.write");
  });
});
