import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { loadMemoryContextRuntimeAdapter } from "./memory-context-runtime-adapter.js";

const packageRoot = process.cwd();

async function makeProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "memory-context-adapter-"));
  await writeProjectFile(
    projectRoot,
    "memory/project.json",
    JSON.stringify([
      {
        id: "project-rule-1",
        type: "project_rule",
        text: "章节改稿必须保留悬念线索。",
        confidence: 0.9,
        relevanceScore: 0.86,
      },
    ]),
  );
  return projectRoot;
}

async function writeProjectFile(projectRoot: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = join(projectRoot, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text);
}

async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

async function source(relativePath: string): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(resolve(packageRoot, relativePath))) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

describe("memory context runtime adapter", () => {
  it("returns idle and does not call runtime when disabled", async () => {
    const result = await loadMemoryContextRuntimeAdapter({
      enabled: false,
      projectRoot: "/definitely/missing/project",
      memoryTargetPath: "../memory/project.json",
    });

    expect(result).toEqual({
      status: "idle",
      viewModel: null,
      warnings: [],
      blockingReasons: [],
      sourcePath: null,
      normalizedPath: "",
      readOnly: true,
      canWrite: false,
      canInjectAutomatically: false,
      didReadFile: false,
      didWriteMemory: false,
      didInjectAutomatically: false,
    });
  });

  it("returns ready with read-only ViewModel for a legal memory file", async () => {
    const projectRoot = await makeProject();
    try {
      const result = await loadMemoryContextRuntimeAdapter({
        projectRoot,
        memoryTargetPath: "memory/project.json",
      });

      expect(result.status).toBe("ready");
      expect(result.viewModel?.relevantMemories).toEqual([
        expect.objectContaining({
          id: "project-rule-1",
          type: "project_rule",
          text: "章节改稿必须保留悬念线索。",
        }),
      ]);
      expect(result.readOnly).toBe(true);
      expect(result.canWrite).toBe(false);
      expect(result.canInjectAutomatically).toBe(false);
      expect(result.didReadFile).toBe(true);
      expect(result.didWriteMemory).toBe(false);
      expect(result.didInjectAutomatically).toBe(false);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("returns warning for malformed JSON without uncontrolled throw", async () => {
    const projectRoot = await makeProject();
    try {
      await writeProjectFile(projectRoot, "memory/bad.json", "{not json");

      const result = await loadMemoryContextRuntimeAdapter({
        projectRoot,
        memoryTargetPath: "memory/bad.json",
      });

      expect(result.status).toBe("warning");
      expect(result.viewModel).not.toBeNull();
      expect(result.warnings.join(" ")).toContain("parse failed warning");
      expect(result.blockingReasons).toEqual([]);
      expect(result.didWriteMemory).toBe(false);
      expect(result.didInjectAutomatically).toBe(false);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("returns warning or safe empty ViewModel for empty memory file", async () => {
    const projectRoot = await makeProject();
    try {
      await writeProjectFile(projectRoot, "memory/empty.txt", "");

      const result = await loadMemoryContextRuntimeAdapter({
        projectRoot,
        memoryTargetPath: "memory/empty.txt",
      });

      expect(["ready", "warning"]).toContain(result.status);
      expect(result.viewModel).not.toBeNull();
      expect(result.viewModel?.readOnly).toBe(true);
      expect(result.viewModel?.canWrite).toBe(false);
      expect(result.viewModel?.canInjectAutomatically).toBe(false);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("returns blocked for unsafe paths", async () => {
    const projectRoot = await makeProject();
    try {
      const result = await loadMemoryContextRuntimeAdapter({
        projectRoot,
        memoryTargetPath: "../memory/project.json",
      });

      expect(result.status).toBe("blocked");
      expect(result.viewModel).toBeNull();
      expect(result.blockingReasons.length).toBeGreaterThan(0);
      expect(result.didReadFile).toBe(false);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("returns controlled warning or blocked output for missing target", async () => {
    const projectRoot = await makeProject();
    try {
      const result = await loadMemoryContextRuntimeAdapter({
        projectRoot,
        memoryTargetPath: "memory/missing.json",
      });

      expect(["warning", "blocked", "failed"]).toContain(result.status);
      expect(result.viewModel).toBeNull();
      expect([...result.warnings, ...result.blockingReasons].length).toBeGreaterThan(0);
      expect(result.didWriteMemory).toBe(false);
      expect(result.didInjectAutomatically).toBe(false);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("keeps adapter source free of UI, write, and direct filesystem boundaries", async () => {
    const adapterSource = await source("src/agent-command-center/memory-context-runtime-adapter.ts");

    expect(adapterSource).toContain("readMemoryRuntimeMinimal");
    expect(adapterSource).not.toContain("testHooks");
    expect(adapterSource).not.toContain("readFile");
    expect(adapterSource).not.toContain("writeFile");
    expect(adapterSource).not.toContain("open(");
    expect(adapterSource).not.toContain("lstat");
    expect(adapterSource).not.toContain("realpath");
    expect(adapterSource).not.toContain("applyWorkspacePatch");
    expect(adapterSource).not.toContain("CommitEngine");
    expect(adapterSource).not.toContain("commitFastDraft");
    expect(adapterSource).not.toContain("applyCommit");
    expect(adapterSource).not.toContain("server/routes");
    expect(adapterSource).not.toContain("api/client");
    expect(adapterSource).not.toContain("components/v2");
    expect(adapterSource).not.toContain("afterText");
    expect(adapterSource).not.toContain("patch preview");
  });
});
