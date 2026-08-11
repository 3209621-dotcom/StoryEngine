import { createReadStream } from "node:fs";
import { appendFile, chmod, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { readMemoryRuntimeMinimal } from "./memory-read-runtime.js";

const packageRoot = process.cwd();

async function makeProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "memory-read-runtime-"));
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
  await writeProjectFile(
    projectRoot,
    "memory/user/preferences.json",
    JSON.stringify({
      userPreferences: [
        {
          id: "pref-1",
          text: "用户偏好紧凑对白。",
          confidence: 0.92,
          relevanceScore: 0.88,
        },
      ],
    }),
  );
  await writeProjectFile(projectRoot, "memory/notes/continuity.md", "- 账本线索暂时不能公开。\n- 小墨仍然怕水。\n");
  await writeProjectFile(projectRoot, "memory/notes/context.txt", "对白保持短句。\n动作承接要清楚。\n");
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

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolveClose();
    });
  });
}

describe("memory read runtime minimal helper", () => {
  it("reads allowed memory/project.json into a read-only ViewModel", async () => {
    const projectRoot = await makeProject();
    try {
      const result = await readMemoryRuntimeMinimal({ projectRoot, targetPath: "memory/project.json" });

      expect(result.ok).toBe(true);
      expect(result.didReadFile).toBe(true);
      expect(result.didWriteMemory).toBe(false);
      expect(result.didInjectAutomatically).toBe(false);
      expect(result.viewModel.readOnly).toBe(true);
      expect(result.viewModel.canWrite).toBe(false);
      expect(result.viewModel.canInjectAutomatically).toBe(false);
      expect(result.viewModel.relevantMemories).toEqual([
        expect.objectContaining({
          id: "project-rule-1",
          type: "project_rule",
          text: "章节改稿必须保留悬念线索。",
          readOnly: true,
          canWrite: false,
          canInjectAutomatically: false,
        }),
      ]);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("reads allowed memory/user/preferences.json as user_preference", async () => {
    const projectRoot = await makeProject();
    try {
      const result = await readMemoryRuntimeMinimal({ projectRoot, targetPath: "memory/user/preferences.json" });

      expect(result.ok).toBe(true);
      expect(result.viewModel.relevantMemories).toEqual([
        expect.objectContaining({
          id: "pref-1",
          type: "user_preference",
          text: "用户偏好紧凑对白。",
        }),
      ]);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("reads allowed Markdown memory into read-only continuity notes", async () => {
    const projectRoot = await makeProject();
    try {
      const result = await readMemoryRuntimeMinimal({ projectRoot, targetPath: "memory/notes/continuity.md" });

      expect(result.ok).toBe(true);
      expect(result.viewModel.relevantMemories).toEqual([
        expect.objectContaining({
          id: "memory/notes/continuity.md:1",
          sourceId: "memory/notes/continuity.md:1",
          type: "unresolved_continuity_note",
          text: "账本线索暂时不能公开。",
        }),
        expect.objectContaining({
          id: "memory/notes/continuity.md:2",
          type: "unresolved_continuity_note",
          text: "小墨仍然怕水。",
        }),
      ]);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("reads allowed TXT memory into read-only memory items", async () => {
    const projectRoot = await makeProject();
    try {
      const result = await readMemoryRuntimeMinimal({ projectRoot, targetPath: "memory/notes/context.txt" });

      expect(result.ok).toBe(true);
      expect(result.viewModel.relevantMemories).toEqual([
        expect.objectContaining({ id: "memory/notes/context.txt:1", text: "对白保持短句。" }),
        expect.objectContaining({ id: "memory/notes/context.txt:2", text: "动作承接要清楚。" }),
      ]);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("turns malformed JSON into warning without uncontrolled throw", async () => {
    const projectRoot = await makeProject();
    try {
      await writeProjectFile(projectRoot, "memory/bad.json", "{not json");

      const result = await readMemoryRuntimeMinimal({ projectRoot, targetPath: "memory/bad.json" });

      expect(result.ok).toBe(true);
      expect(result.didReadFile).toBe(true);
      expect(result.warnings.join(" ")).toContain("parse failed warning");
      expect(result.viewModel.warnings.join(" ")).toContain("parse failed warning");
      expect(result.viewModel.relevantMemories).toEqual([]);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("blocks when target is replaced by symlink after final guard and before open", async () => {
    const projectRoot = await makeProject();
    const outsideRoot = await mkdtemp(join(tmpdir(), "memory-read-runtime-outside-"));
    try {
      await writeFile(join(outsideRoot, "outside.txt"), "do not read this");

      const result = await readMemoryRuntimeMinimal({
        projectRoot,
        targetPath: "memory/project.json",
        testHooks: {
          afterFinalGuardBeforeOpen: async () => {
            await rm(join(projectRoot, "memory/project.json"));
            await symlink(join(outsideRoot, "outside.txt"), join(projectRoot, "memory/project.json"));
          },
        },
      });

      expect(result.ok).toBe(false);
      expect(result.didReadFile).toBe(false);
      expect(result.blockingReasons.length).toBeGreaterThan(0);
      expect(result.viewModel.relevantMemories.map((memory) => memory.text)).not.toContain("do not read this");
    } finally {
      await removePath(projectRoot);
      await removePath(outsideRoot);
    }
  });

  it("blocks when target is replaced by another regular file after final guard and before open", async () => {
    const projectRoot = await makeProject();
    try {
      await writeProjectFile(projectRoot, "memory/replacement.json", JSON.stringify([{ id: "bad", text: "replacement content" }]));

      const result = await readMemoryRuntimeMinimal({
        projectRoot,
        targetPath: "memory/project.json",
        testHooks: {
          afterFinalGuardBeforeOpen: async () => {
            await rm(join(projectRoot, "memory/project.json"));
            // rename 必产生全新 inode（Linux 上 rm+write 可能复用同一 inode 导致 identity 不变）
            await rename(join(projectRoot, "memory/replacement.json"), join(projectRoot, "memory/project.json"));
          },
        },
      });

      expect(result.ok).toBe(false);
      expect(result.didReadFile).toBe(false);
      expect(result.blockingReasons.join(" ")).toContain("identity mismatch");
      expect(result.viewModel.relevantMemories.map((memory) => memory.text)).not.toContain("replacement content");
    } finally {
      await removePath(projectRoot);
    }
  });

  it("blocks when target is replaced by directory after final guard and before open", async () => {
    const projectRoot = await makeProject();
    try {
      const result = await readMemoryRuntimeMinimal({
        projectRoot,
        targetPath: "memory/project.json",
        testHooks: {
          afterFinalGuardBeforeOpen: async () => {
            await rm(join(projectRoot, "memory/project.json"));
            await mkdir(join(projectRoot, "memory/project.json"));
          },
        },
      });

      expect(result.ok).toBe(false);
      expect(result.didReadFile).toBe(false);
      expect(result.blockingReasons.length).toBeGreaterThan(0);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("returns controlled warning when target is deleted after final guard and before open", async () => {
    const projectRoot = await makeProject();
    try {
      const result = await readMemoryRuntimeMinimal({
        projectRoot,
        targetPath: "memory/project.json",
        testHooks: {
          afterFinalGuardBeforeOpen: async () => {
            await rm(join(projectRoot, "memory/project.json"));
          },
        },
      });

      expect(result.ok).toBe(false);
      expect(result.didReadFile).toBe(false);
      expect(result.warnings.join(" ")).toContain("read failed warning");
    } finally {
      await removePath(projectRoot);
    }
  });

  it("turns empty files into safe empty ViewModel with warning", async () => {
    const projectRoot = await makeProject();
    try {
      await writeProjectFile(projectRoot, "memory/empty.txt", "");

      const result = await readMemoryRuntimeMinimal({ projectRoot, targetPath: "memory/empty.txt" });

      expect(result.ok).toBe(true);
      expect(result.warnings.join(" ")).toContain("empty file warning");
      expect(result.viewModel.relevantMemories).toEqual([]);
      expect(result.viewModel.readOnly).toBe(true);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("blocks oversized files before content enters the ViewModel", async () => {
    const projectRoot = await makeProject();
    try {
      await writeProjectFile(projectRoot, "memory/large.txt", "0123456789");

      const result = await readMemoryRuntimeMinimal({
        projectRoot,
        targetPath: "memory/large.txt",
        limits: { maxFileBytes: 5, maxMemoryItems: 10, maxTextLengthPerItem: 100 },
      });

      expect(result.ok).toBe(false);
      expect(result.didReadFile).toBe(false);
      expect(result.blockingReasons.join(" ")).toContain("oversized file");
      expect(result.viewModel.relevantMemories).toEqual([]);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("clamps huge maxFileBytes to the hard cap before allocating the bounded read buffer", async () => {
    const projectRoot = await makeProject();
    try {
      await writeProjectFile(projectRoot, "memory/too-large-for-hard-cap.txt", "x".repeat(64 * 1024 + 1));

      const result = await readMemoryRuntimeMinimal({
        projectRoot,
        targetPath: "memory/too-large-for-hard-cap.txt",
        limits: { maxFileBytes: 128 * 1024, maxMemoryItems: 10, maxTextLengthPerItem: 100 },
      });

      expect(result.ok).toBe(false);
      expect(result.didAttemptReadFile).toBe(false);
      expect(result.didReadFile).toBe(false);
      expect(result.blockingReasons.join(" ")).toContain("oversized file");
      expect(result.viewModel.relevantMemories).toEqual([]);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("uses default maxFileBytes for Infinity instead of allocating from invalid input", async () => {
    const projectRoot = await makeProject();
    try {
      await writeProjectFile(projectRoot, "memory/infinity-limit.txt", "x".repeat(64 * 1024 + 1));

      const result = await readMemoryRuntimeMinimal({
        projectRoot,
        targetPath: "memory/infinity-limit.txt",
        limits: { maxFileBytes: Number.POSITIVE_INFINITY, maxMemoryItems: 10, maxTextLengthPerItem: 100 },
      });

      expect(result.ok).toBe(false);
      expect(result.didAttemptReadFile).toBe(false);
      expect(result.didReadFile).toBe(false);
      expect(result.blockingReasons.join(" ")).toContain("oversized file");
      expect(result.viewModel.relevantMemories).toEqual([]);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("blocks when same file grows past maxFileBytes after open/fstat and before bounded read", async () => {
    const projectRoot = await makeProject();
    try {
      await writeProjectFile(projectRoot, "memory/notes/growing.txt", "abc");

      const result = await readMemoryRuntimeMinimal({
        projectRoot,
        targetPath: "memory/notes/growing.txt",
        limits: { maxFileBytes: 5, maxMemoryItems: 10, maxTextLengthPerItem: 100 },
        testHooks: {
          afterOpenFstatIdentityCheckBeforeRead: async () => {
            await appendFile(join(projectRoot, "memory/notes/growing.txt"), "defgh");
          },
        },
      });

      expect(result.ok).toBe(false);
      expect(result.didAttemptReadFile).toBe(true);
      expect(result.didReadFile).toBe(false);
      expect(result.didWriteMemory).toBe(false);
      expect(result.didInjectAutomatically).toBe(false);
      expect(result.blockingReasons.join(" ")).toContain("maxFileBytes");
      expect(result.blockingReasons.join(" ")).toContain("oversized");
      expect(result.viewModel.relevantMemories.map((memory) => memory.text)).not.toContain("abcdefgh");
    } finally {
      await removePath(projectRoot);
    }
  });

  it("reads appended same-file content when bounded read remains within maxFileBytes", async () => {
    const projectRoot = await makeProject();
    try {
      await writeProjectFile(projectRoot, "memory/notes/growing-ok.txt", "abc");

      const result = await readMemoryRuntimeMinimal({
        projectRoot,
        targetPath: "memory/notes/growing-ok.txt",
        limits: { maxFileBytes: 10, maxMemoryItems: 10, maxTextLengthPerItem: 100 },
        testHooks: {
          afterOpenFstatIdentityCheckBeforeRead: async () => {
            await appendFile(join(projectRoot, "memory/notes/growing-ok.txt"), "def");
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(result.didAttemptReadFile).toBe(true);
      expect(result.didReadFile).toBe(true);
      expect(result.viewModel.relevantMemories).toEqual([
        expect.objectContaining({ text: "abcdef" }),
      ]);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("clamps huge maxMemoryItems to the hard cap", async () => {
    const projectRoot = await makeProject();
    try {
      const lines = Array.from({ length: 105 }, (_, index) => `memory item ${index + 1}`).join("\n");
      await writeProjectFile(projectRoot, "memory/notes/many-items.txt", `${lines}\n`);

      const result = await readMemoryRuntimeMinimal({
        projectRoot,
        targetPath: "memory/notes/many-items.txt",
        limits: { maxFileBytes: 64 * 1024, maxMemoryItems: 1000, maxTextLengthPerItem: 100 },
      });

      expect(result.ok).toBe(true);
      expect(result.viewModel.relevantMemories).toHaveLength(100);
      expect(result.warnings.join(" ")).toContain("max item count");
    } finally {
      await removePath(projectRoot);
    }
  });

  it("clamps huge maxTextLengthPerItem to the hard cap", async () => {
    const projectRoot = await makeProject();
    try {
      await writeProjectFile(projectRoot, "memory/notes/long-item.txt", `${"x".repeat(1200)}\n`);

      const result = await readMemoryRuntimeMinimal({
        projectRoot,
        targetPath: "memory/notes/long-item.txt",
        limits: { maxFileBytes: 64 * 1024, maxMemoryItems: 10, maxTextLengthPerItem: 10_000 },
      });

      expect(result.ok).toBe(true);
      expect(result.viewModel.relevantMemories).toEqual([
        expect.objectContaining({ text: "x".repeat(1000) }),
      ]);
      expect(result.warnings.join(" ")).toContain("max text length per memory item");
    } finally {
      await removePath(projectRoot);
    }
  });

  it("enforces max item count and max text length per item", async () => {
    const projectRoot = await makeProject();
    try {
      await writeProjectFile(projectRoot, "memory/notes/limited.txt", "abcdef\n123456\nxyz\n");

      const result = await readMemoryRuntimeMinimal({
        projectRoot,
        targetPath: "memory/notes/limited.txt",
        limits: { maxFileBytes: 1024, maxMemoryItems: 2, maxTextLengthPerItem: 3 },
      });

      expect(result.ok).toBe(true);
      expect(result.viewModel.relevantMemories).toHaveLength(2);
      expect(result.viewModel.relevantMemories.map((memory) => memory.text)).toEqual(["abc", "123"]);
      expect(result.warnings.join(" ")).toContain("max item count");
      expect(result.warnings.join(" ")).toContain("max text length per memory item");
    } finally {
      await removePath(projectRoot);
    }
  });

  it.each([
    "../memory/project.json",
    "/tmp/outside-memory.json",
    "memory/.secret.json",
    ".story-engine-tx/workspace-patches/x",
    "story/state/hooks.json",
    "snapshot-manifest.json",
  ])("blocks unsafe target %s before readFile", async (targetPath) => {
    const projectRoot = await makeProject();
    try {
      const result = await readMemoryRuntimeMinimal({ projectRoot, targetPath });

      expect(result.ok).toBe(false);
      expect(result.didReadFile).toBe(false);
      expect(result.blockingReasons.length).toBeGreaterThan(0);
      expect(result.viewModel.readOnly).toBe(true);
      expect(result.viewModel.canWrite).toBe(false);
      expect(result.viewModel.canInjectAutomatically).toBe(false);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("blocks target symlink before reading content", async () => {
    const projectRoot = await makeProject();
    try {
      await symlink(join(projectRoot, "memory/project.json"), join(projectRoot, "memory/link.json"));

      const result = await readMemoryRuntimeMinimal({ projectRoot, targetPath: "memory/link.json" });

      expect(result.ok).toBe(false);
      expect(result.didReadFile).toBe(false);
      expect(result.blockingReasons.join(" ")).toContain("target file symlink");
    } finally {
      await removePath(projectRoot);
    }
  });

  it("blocks target directory before reading content", async () => {
    const projectRoot = await makeProject();
    try {
      await mkdir(join(projectRoot, "memory/dir.json"));

      const result = await readMemoryRuntimeMinimal({ projectRoot, targetPath: "memory/dir.json" });

      expect(result.ok).toBe(false);
      expect(result.didReadFile).toBe(false);
      expect(result.blockingReasons.join(" ")).toContain("target directory");
    } finally {
      await removePath(projectRoot);
    }
  });

  it("blocks non-regular files before reading content", async () => {
    const projectRoot = await makeProject();
    const socketPath = join(projectRoot, "memory/socket.txt");
    const server = createServer();
    try {
      await new Promise<void>((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(socketPath, resolveListen);
      });

      const result = await readMemoryRuntimeMinimal({ projectRoot, targetPath: "memory/socket.txt" });

      expect(result.ok).toBe(false);
      expect(result.didReadFile).toBe(false);
      expect(result.blockingReasons.join(" ")).toContain("non-regular file");
    } finally {
      await closeServer(server);
      await removePath(projectRoot);
    }
  });

  it("returns controlled warning or blocked result for missing targets", async () => {
    const projectRoot = await makeProject();
    try {
      const result = await readMemoryRuntimeMinimal({ projectRoot, targetPath: "memory/missing.json" });

      expect(result.ok).toBe(false);
      expect(result.didReadFile).toBe(false);
      expect(result.blockingReasons.join(" ")).toContain("memory disk guard check failed");
      expect(result.warnings.join(" ")).toContain("read failed warning");
    } finally {
      await removePath(projectRoot);
    }
  });

  it("turns readFile failure into warning without changing write or injection flags", async () => {
    const projectRoot = await makeProject();
    try {
      await writeProjectFile(projectRoot, "memory/unreadable.txt", "secret");
      await chmod(join(projectRoot, "memory/unreadable.txt"), 0o000);

      const result = await readMemoryRuntimeMinimal({ projectRoot, targetPath: "memory/unreadable.txt" });

      expect(result.ok).toBe(false);
      expect(result.didWriteMemory).toBe(false);
      expect(result.didInjectAutomatically).toBe(false);
      expect(result.warnings.join(" ")).toContain("read failed warning");
    } finally {
      await chmod(join(projectRoot, "memory/unreadable.txt"), 0o600).catch(() => {});
      await removePath(projectRoot);
    }
  });

  it("uses safe defaults for invalid limits", async () => {
    const projectRoot = await makeProject();
    try {
      const result = await readMemoryRuntimeMinimal({
        projectRoot,
        targetPath: "memory/notes/context.txt",
        limits: {
          maxFileBytes: Number.NaN,
          maxMemoryItems: -1,
          maxTextLengthPerItem: -10,
        },
      });

      expect(result.ok).toBe(true);
      expect(result.didReadFile).toBe(true);
      expect(result.viewModel.relevantMemories.length).toBeGreaterThan(0);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("treats zero item and text limits as safe empty output", async () => {
    const projectRoot = await makeProject();
    try {
      const result = await readMemoryRuntimeMinimal({
        projectRoot,
        targetPath: "memory/notes/context.txt",
        limits: {
          maxFileBytes: 1024,
          maxMemoryItems: 0,
          maxTextLengthPerItem: 0,
        },
      });

      expect(result.ok).toBe(true);
      expect(result.didReadFile).toBe(true);
      expect(result.viewModel.relevantMemories).toEqual([]);
      expect(result.warnings.join(" ")).toContain("max item count");
    } finally {
      await removePath(projectRoot);
    }
  });

  it("keeps runtime source free of path-based fs.promises.readFile target usage", async () => {
    const helperSource = await source("src/agent-command-center/memory-read-runtime.ts");

    expect(helperSource).not.toContain('import { lstat, readFile }');
    expect(helperSource).not.toContain("readFile(sourcePath");
    expect(helperSource).not.toContain("fileHandle.readFile");
    expect(helperSource).not.toContain(".readFile(");
    expect(helperSource).not.toContain("fs.promises.readFile");
    expect(helperSource).toContain("open(");
    expect(helperSource).toContain("fileHandle.stat()");
    expect(helperSource).toContain("fileHandle.read(");
    expect(helperSource).toContain("maxFileBytes + 1");
    expect(helperSource).toContain("HARD_MAX_FILE_BYTES");
    expect(helperSource).toContain("HARD_MAX_MEMORY_ITEMS");
    expect(helperSource).toContain("HARD_MAX_TEXT_LENGTH_PER_ITEM");
  });

  it("keeps helper source free of write, apply, Formal Commit, server route, API, UI, prompt, and afterText hooks", async () => {
    const helperSource = await source("src/agent-command-center/memory-read-runtime.ts");

    expect(helperSource).not.toContain("writeFile");
    expect(helperSource).not.toContain("applyWorkspacePatch");
    expect(helperSource).not.toContain("CommitEngine");
    expect(helperSource).not.toContain("commitFastDraft");
    expect(helperSource).not.toContain("applyCommit");
    expect(helperSource).not.toContain("server/routes");
    expect(helperSource).not.toContain("api/client");
    expect(helperSource).not.toContain("components/v2");
    expect(helperSource).not.toContain("afterText");
    expect(helperSource).not.toContain("patch preview");
  });
});
