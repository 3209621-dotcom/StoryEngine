import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, realpath, rm, symlink } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { guardMemoryReadDiskPath } from "./memory-read-disk-guard.js";

const packageRoot = process.cwd();

async function makeProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "memory-disk-guard-"));
  await mkdir(join(projectRoot, "memory/user"), { recursive: true });
  await mkdir(join(projectRoot, "memory/notes"), { recursive: true });
  await createRegularFile(join(projectRoot, "memory/project.json"));
  await createRegularFile(join(projectRoot, "memory/user/preferences.json"));
  await createRegularFile(join(projectRoot, "memory/notes/continuity.md"));
  await createRegularFile(join(projectRoot, "memory/notes/context.txt"));
  return projectRoot;
}

async function createRegularFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "w");
  await handle.close();
}

async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

async function textFromStream(path: string): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(path)) {
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

describe("memory read disk guard helper", () => {
  it.each([
    "memory/project.json",
    "memory/user/preferences.json",
    "memory/notes/continuity.md",
    "memory/notes/context.txt",
  ])("allows regular memory source %s without reading file contents", async (targetPath) => {
    const projectRoot = await makeProject();
    try {
      const result = await guardMemoryReadDiskPath({ projectRoot, targetPath });

      expect(result).toMatchObject({
        allowed: true,
        normalizedPath: targetPath,
        targetRole: "allowed_memory_source",
        blockingReasons: [],
        isRegularFile: true,
        symlinkBlocked: false,
        willReadFile: false,
        willWriteMemory: false,
        willInjectAutomatically: false,
      });
      expect(result.realProjectRoot).toBe(await realpath(projectRoot));
      expect(result.realTargetPath).toBe(await realpath(resolve(projectRoot, targetPath)));
    } finally {
      await removePath(projectRoot);
    }
  });

  it("blocks a target file symlink", async () => {
    const projectRoot = await makeProject();
    try {
      await symlink(join(projectRoot, "memory/project.json"), join(projectRoot, "memory/link.json"));

      const result = await guardMemoryReadDiskPath({ projectRoot, targetPath: "memory/link.json" });

      expect(result.allowed).toBe(false);
      expect(result.targetRole).toBe("blocked_target_symlink");
      expect(result.symlinkBlocked).toBe(true);
      expect(result.blockingReasons.join(" ")).toContain("target file symlink");
      expect(result.willReadFile).toBe(false);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("blocks a memory ancestor directory symlink escape", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memory-disk-guard-root-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "memory-disk-guard-outside-"));
    try {
      await mkdir(join(outsideRoot, "memory"), { recursive: true });
      await createRegularFile(join(outsideRoot, "memory/project.json"));
      await symlink(join(outsideRoot, "memory"), join(projectRoot, "memory"));

      const result = await guardMemoryReadDiskPath({ projectRoot, targetPath: "memory/project.json" });

      expect(result.allowed).toBe(false);
      expect(result.targetRole).toBe("blocked_memory_ancestor_symlink");
      expect(result.symlinkBlocked).toBe(true);
      expect(result.blockingReasons.join(" ")).toContain("symlink escape");
    } finally {
      await removePath(projectRoot);
      await removePath(outsideRoot);
    }
  });

  it("blocks a projectRoot symlink escape", async () => {
    const linkParent = await mkdtemp(join(tmpdir(), "memory-disk-guard-link-parent-"));
    const outsideRoot = await makeProject();
    const linkedProjectRoot = join(linkParent, "project-link");
    try {
      await symlink(outsideRoot, linkedProjectRoot);

      const result = await guardMemoryReadDiskPath({ projectRoot: linkedProjectRoot, targetPath: "memory/project.json" });

      expect(result.allowed).toBe(false);
      expect(result.targetRole).toBe("blocked_project_root_symlink");
      expect(result.symlinkBlocked).toBe(true);
      expect(result.blockingReasons.join(" ")).toContain("projectRoot symlink");
    } finally {
      await removePath(linkParent);
      await removePath(outsideRoot);
    }
  });

  it("blocks a target directory", async () => {
    const projectRoot = await makeProject();
    try {
      await mkdir(join(projectRoot, "memory/dir.json"));

      const result = await guardMemoryReadDiskPath({ projectRoot, targetPath: "memory/dir.json" });

      expect(result.allowed).toBe(false);
      expect(result.targetRole).toBe("blocked_target_directory");
      expect(result.isRegularFile).toBe(false);
      expect(result.willReadFile).toBe(false);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("blocks a non-regular file target", async () => {
    const projectRoot = await makeProject();
    const socketPath = join(projectRoot, "memory/socket.txt");
    const server = createServer();
    try {
      await new Promise<void>((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(socketPath, resolveListen);
      });

      const result = await guardMemoryReadDiskPath({ projectRoot, targetPath: "memory/socket.txt" });

      expect(result.allowed).toBe(false);
      expect(result.targetRole).toBe("blocked_non_regular_file");
      expect(result.isRegularFile).toBe(false);
      expect(result.blockingReasons.join(" ")).toContain("non-regular file");
    } finally {
      await closeServer(server);
      await removePath(projectRoot);
    }
  });

  it("blocks a target symlink whose real path escapes the project", async () => {
    const projectRoot = await makeProject();
    const outsideRoot = await mkdtemp(join(tmpdir(), "memory-disk-guard-outside-"));
    try {
      await createRegularFile(join(outsideRoot, "outside.txt"));
      await symlink(join(outsideRoot, "outside.txt"), join(projectRoot, "memory/outside.txt"));

      const result = await guardMemoryReadDiskPath({ projectRoot, targetPath: "memory/outside.txt" });

      expect(result.allowed).toBe(false);
      expect(result.targetRole).toBe("blocked_target_realpath_outside_project");
      expect(result.symlinkBlocked).toBe(true);
      expect(result.blockingReasons.join(" ")).toContain("outside project root");
    } finally {
      await removePath(projectRoot);
      await removePath(outsideRoot);
    }
  });

  it.each([
    ["../memory/project.json", "blocked_path_traversal"],
    ["/tmp/outside-memory.json", "blocked_outside_project"],
    ["memory/../../story/state/hooks.json", "blocked_path_traversal"],
    ["memory/.secret.json", "blocked_hidden_path"],
    [".story-engine-tx/workspace-patches/x", "blocked_transaction_record"],
    ["story/state/hooks.json", "blocked_state_json"],
    ["snapshot-manifest.json", "blocked_formal_commit_artifact"],
    ["chapters/chapter-001.md", "blocked_unknown_target"],
    ["characters/protagonist.md", "blocked_unknown_target"],
  ] as const)("keeps preflight block for %s", async (targetPath, targetRole) => {
    const projectRoot = await makeProject();
    try {
      const result = await guardMemoryReadDiskPath({ projectRoot, targetPath });

      expect(result.allowed).toBe(false);
      expect(result.targetRole).toBe(targetRole);
      expect(result.blockingReasons.length).toBeGreaterThan(0);
      expect(result.willReadFile).toBe(false);
      expect(result.willWriteMemory).toBe(false);
      expect(result.willInjectAutomatically).toBe(false);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("returns a controlled blocking reason when disk checks fail", async () => {
    const projectRoot = await makeProject();
    try {
      const result = await guardMemoryReadDiskPath({ projectRoot, targetPath: "memory/missing.json" });

      expect(result.allowed).toBe(false);
      expect(result.targetRole).toBe("blocked_disk_check_failed");
      expect(result.blockingReasons.join(" ")).toContain("memory disk guard check failed");
      expect(result.willReadFile).toBe(false);
    } finally {
      await removePath(projectRoot);
    }
  });

  it("keeps helper source free of content reads, writes, API, apply, and server route capabilities", async () => {
    const helperSource = await textFromStream(resolve(packageRoot, "src/agent-command-center/memory-read-disk-guard.ts"));

    expect(helperSource).not.toContain("readFile");
    expect(helperSource).not.toContain("writeFile");
    expect(helperSource).not.toContain("fetch(");
    expect(helperSource).not.toContain("applyWorkspacePatch");
    expect(helperSource).not.toContain("CommitEngine");
    expect(helperSource).not.toContain("commitFastDraft");
    expect(helperSource).not.toContain("applyCommit");
    expect(helperSource).not.toContain("server/routes");
  });
});
