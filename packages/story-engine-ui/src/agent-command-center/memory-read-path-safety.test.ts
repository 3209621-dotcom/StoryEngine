import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { preflightMemoryReadPath } from "./memory-read-path-safety.js";

const packageRoot = process.cwd();
const projectRoot = "/Users/author/Documents/New project/demo-story";

async function source(relativePath: string): Promise<string> {
  return readFile(resolve(packageRoot, relativePath), "utf-8");
}

describe("memory read path safety preflight helper", () => {
  it.each([
    "memory/project.json",
    "memory/user/preferences.json",
    "memory/notes/continuity.md",
    "memory/notes/context.txt",
  ])("allows future memory source %s without file access authority", (targetPath) => {
    const result = preflightMemoryReadPath({ projectRoot, targetPath });

    expect(result).toMatchObject({
      allowed: true,
      normalizedPath: targetPath,
      targetRole: "allowed_memory_source",
      blockingReasons: [],
      willReadFile: false,
      willWriteMemory: false,
      willInjectAutomatically: false,
    });
    expect(result.reason).toBe("allowed memory source preflight only.");
  });

  it.each([
    ["../memory/project.json", "blocked_path_traversal"],
    ["memory/../../story/state/hooks.json", "blocked_path_traversal"],
  ] as const)("blocks path traversal for %s", (targetPath, targetRole) => {
    const result = preflightMemoryReadPath({ projectRoot, targetPath });

    expect(result.allowed).toBe(false);
    expect(result.targetRole).toBe(targetRole);
    expect(result.blockingReasons.join(" ")).toContain("path traversal");
    expect(result.willReadFile).toBe(false);
    expect(result.willWriteMemory).toBe(false);
    expect(result.willInjectAutomatically).toBe(false);
  });

  it("blocks absolute paths outside the project root", () => {
    const result = preflightMemoryReadPath({ projectRoot, targetPath: "/tmp/outside-memory.json" });

    expect(result).toMatchObject({
      allowed: false,
      targetRole: "blocked_outside_project",
      willReadFile: false,
      willWriteMemory: false,
      willInjectAutomatically: false,
    });
    expect(result.blockingReasons.join(" ")).toContain("outside project root");
  });

  it.each([
    [".story-engine-tx/workspace-patches/x", "blocked_transaction_record"],
    ["story/state/hooks.json", "blocked_state_json"],
    ["snapshot-manifest.json", "blocked_formal_commit_artifact"],
    ["memory/.secret.json", "blocked_hidden_path"],
    ["chapters/chapter-001.md", "blocked_unknown_target"],
    ["characters/protagonist.md", "blocked_unknown_target"],
  ] as const)("blocks %s as %s", (targetPath, targetRole) => {
    const result = preflightMemoryReadPath({ projectRoot, targetPath });

    expect(result.allowed).toBe(false);
    expect(result.targetRole).toBe(targetRole);
    expect(result.blockingReasons.length).toBeGreaterThan(0);
    expect(result.willReadFile).toBe(false);
    expect(result.willWriteMemory).toBe(false);
    expect(result.willInjectAutomatically).toBe(false);
  });

  it("keeps helper source free of disk, API, apply, and server route capabilities", async () => {
    const helperSource = await source("src/agent-command-center/memory-read-path-safety.ts");

    expect(helperSource).not.toContain("readFile");
    expect(helperSource).not.toContain("writeFile");
    expect(helperSource).not.toContain("realpath");
    expect(helperSource).not.toContain("lstat");
    expect(helperSource).not.toContain("fetch(");
    expect(helperSource).not.toContain("applyWorkspacePatch");
    expect(helperSource).not.toContain("CommitEngine");
    expect(helperSource).not.toContain("commitFastDraft");
    expect(helperSource).not.toContain("applyCommit");
    expect(helperSource).not.toContain("server/routes");
  });
});
