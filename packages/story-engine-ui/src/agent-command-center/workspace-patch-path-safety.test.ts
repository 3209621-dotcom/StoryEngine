import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  hasHiddenPathSegment,
  hasPathTraversal,
  isAbsolutePath,
  isWithinProjectRoot,
  normalizeWorkspacePatchTargetPath,
  validateWorkspacePatchTargetPath,
} from "./workspace-patch-path-safety.js";

const packageRoot = process.cwd();
const projectRoot = "/Users/author/Documents/New project/demo-story";

async function source(relativePath: string): Promise<string> {
  return readFile(resolve(packageRoot, relativePath), "utf-8");
}

describe("workspace patch path safety metadata helper", () => {
  it("allows ordinary relative Markdown paths", () => {
    const result = validateWorkspacePatchTargetPath({
      projectRoot,
      targetPath: "chapters/chapter-001.md",
    });

    expect(result.ok).toBe(true);
    expect(result.normalizedPath).toBe("chapters/chapter-001.md");
    expect(result.reasons).toEqual([]);
    expect(hasPathTraversal("chapters/chapter-001.md")).toBe(false);
    expect(hasHiddenPathSegment("chapters/chapter-001.md")).toBe(false);
  });

  it("blocks parent directory traversal at the start", () => {
    const result = validateWorkspacePatchTargetPath({
      projectRoot,
      targetPath: "../outside.md",
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("path traversal");
    expect(hasPathTraversal("../outside.md")).toBe(true);
  });

  it("blocks parent directory traversal in the middle", () => {
    const result = validateWorkspacePatchTargetPath({
      projectRoot,
      targetPath: "chapters/../../outside.md",
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("path traversal");
    expect(hasPathTraversal("chapters/../../outside.md")).toBe(true);
  });

  it("blocks Windows absolute paths outside the project root", () => {
    const result = validateWorkspacePatchTargetPath({
      projectRoot,
      targetPath: "C:\\Users\\x\\outside.md",
    });

    expect(result.ok).toBe(false);
    expect(isAbsolutePath("C:\\Users\\x\\outside.md")).toBe(true);
    expect(result.reasons.join(" ")).toContain("outside project root");
  });

  it("blocks POSIX absolute paths outside the project root", () => {
    const result = validateWorkspacePatchTargetPath({
      projectRoot,
      targetPath: "/tmp/outside.md",
    });

    expect(result.ok).toBe(false);
    expect(isAbsolutePath("/tmp/outside.md")).toBe(true);
    expect(isWithinProjectRoot(projectRoot, "/tmp/outside.md")).toBe(false);
    expect(result.reasons.join(" ")).toContain("outside project root");
  });

  it("allows absolute paths only when they remain inside the project root", () => {
    const result = validateWorkspacePatchTargetPath({
      projectRoot,
      targetPath: `${projectRoot}/chapters/chapter-001.md`,
    });

    expect(result.ok).toBe(true);
    expect(result.normalizedPath).toBe("chapters/chapter-001.md");
    expect(isWithinProjectRoot(projectRoot, `${projectRoot}/chapters/chapter-001.md`)).toBe(true);
  });

  it("blocks hidden files", () => {
    const result = validateWorkspacePatchTargetPath({
      projectRoot,
      targetPath: ".env",
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("hidden");
    expect(hasHiddenPathSegment(".env")).toBe(true);
  });

  it("blocks hidden directories", () => {
    const result = validateWorkspacePatchTargetPath({
      projectRoot,
      targetPath: ".git/config",
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("hidden");
    expect(hasHiddenPathSegment(".git/config")).toBe(true);
  });

  it("blocks transaction hidden directories", () => {
    const result = validateWorkspacePatchTargetPath({
      projectRoot,
      targetPath: ".story-engine-tx/tx/manifest.json",
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("hidden");
    expect(hasHiddenPathSegment(".story-engine-tx/tx/manifest.json")).toBe(true);
  });

  it("blocks hidden files under otherwise valid folders", () => {
    const result = validateWorkspacePatchTargetPath({
      projectRoot,
      targetPath: "chapters/.secret.md",
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("hidden");
    expect(normalizeWorkspacePatchTargetPath("chapters\\.secret.md")).toBe("chapters/.secret.md");
  });

  it("keeps helper source free of runtime I/O and execution APIs", async () => {
    const helperSource = await source("src/agent-command-center/workspace-patch-path-safety.ts");

    expect(helperSource).not.toContain("readFile");
    expect(helperSource).not.toContain("writeFile");
    expect(helperSource).not.toContain("fs.write");
    expect(helperSource).not.toContain("fetch(");
    expect(helperSource).not.toContain("applyCommit");
    expect(helperSource).not.toContain("commitFastDraft");
    expect(helperSource).not.toContain("CommitEngine");
  });
});
