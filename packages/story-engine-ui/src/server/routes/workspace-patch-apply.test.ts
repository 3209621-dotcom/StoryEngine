import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { buildMarkdownPatchPreview } from "../../agent-command-center/workspace-patch-preview.js";
import { makeHomeTempDir } from "../lib/home-test-tmp.js";
import type { Middleware } from "../lib/project-io.js";
import { registerWorkspacePatchApplyRoutes } from "./workspace-patch-apply.js";

describe("Workspace Patch Apply V0 route", () => {
  let projectDir: string | undefined;
  const externalDirs: string[] = [];

  afterEach(async () => {
    if (projectDir) {
      await rm(projectDir, { recursive: true, force: true });
      projectDir = undefined;
    }
    await Promise.all(externalDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("returns a structured success response for a confirmed normal Markdown patch", async () => {
    projectDir = await createProject();
    await mkdir(join(projectDir, "chapters"), { recursive: true });
    await writeFile(join(projectDir, "chapters", "chapter-001.md"), "before\n", "utf-8");
    const response = await callWorkspacePatchApplyRoute(validBody({
      projectPath: projectDir,
      targetPath: "chapters/chapter-001.md",
      beforeText: "before\n",
      afterText: "after\n",
    }));

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      ok: true,
      targetPath: "chapters/chapter-001.md",
      documentType: "chapter_markdown",
      rollbackAvailable: true,
      rollbackNote: "rollbackAvailable means transaction backup exists; UI undo is not yet implemented.",
      noStateJsonWrite: true,
      noMemoryWrite: true,
      noFormalCommitApply: true,
      changedFiles: ["chapters/chapter-001.md"],
    });
    expect(typeof response.payload.patchApplyTxId).toBe("string");
    expect(typeof response.payload.changeSummary).toBe("string");
    expect(typeof response.payload.transactionPath).toBe("string");
    await expect(readFile(join(projectDir, "chapters", "chapter-001.md"), "utf-8")).resolves.toBe("after\n");
  });

  it("returns safety flags and rollback note on idempotency replay success", async () => {
    projectDir = await createProject();
    await mkdir(join(projectDir, "chapters"), { recursive: true });
    await writeFile(join(projectDir, "chapters", "chapter-001.md"), "before\n", "utf-8");
    const body = validBody({
      projectPath: projectDir,
      targetPath: "chapters/chapter-001.md",
      beforeText: "before\n",
      afterText: "after\n",
    });

    const first = await callWorkspacePatchApplyRoute(body);
    const second = await callWorkspacePatchApplyRoute(body);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.payload).toMatchObject({
      ok: true,
      rollbackNote: "rollbackAvailable means transaction backup exists; UI undo is not yet implemented.",
      noStateJsonWrite: true,
      noMemoryWrite: true,
      noFormalCommitApply: true,
    });
    expect(String(second.payload.warnings)).toContain("idempotency");
  });

  it("returns structured error codes for malformed requests", async () => {
    const response = await callWorkspacePatchApplyRoute({
      projectPath: "",
      targetPath: "chapters/chapter-001.md",
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toMatchObject({
      ok: false,
      code: "missing_project_path",
    });
  });

  it("returns structured error codes for blocked targets", async () => {
    projectDir = await createProject();
    await mkdir(join(projectDir, "skills"), { recursive: true });
    await writeFile(join(projectDir, "skills", "chapter-writing.md"), "before\n", "utf-8");

    const response = await callWorkspacePatchApplyRoute(validBody({
      projectPath: projectDir,
      targetPath: "skills/chapter-writing.md",
      beforeText: "before\n",
      afterText: "after\n",
    }));

    expect(response.statusCode).toBe(403);
    expect(response.payload).toMatchObject({
      ok: false,
      code: "target_not_allowed_v0",
    });
    await expect(readFile(join(projectDir, "skills", "chapter-writing.md"), "utf-8")).resolves.toBe("before\n");
  });

  it.each([
    ["../outside.md", "path_safety_failed", 400],
    [".env", "path_safety_failed", 400],
    ["story/state/hooks.json", "target_not_allowed_v0", 403],
    ["memory/project.json", "target_not_allowed_v0", 403],
  ] as const)("blocks unsafe or protected route target %s", async (targetPath, code, statusCode) => {
    projectDir = await createProject();
    if (targetPath === "story/state/hooks.json") {
      await mkdir(join(projectDir, "story", "state"), { recursive: true });
      await writeFile(join(projectDir, targetPath), "before\n", "utf-8");
    }
    if (targetPath === "memory/project.json") {
      await mkdir(join(projectDir, "memory"), { recursive: true });
      await writeFile(join(projectDir, targetPath), "before\n", "utf-8");
    }

    const response = await callWorkspacePatchApplyRoute(validBody({
      projectPath: projectDir,
      targetPath,
      beforeText: "before\n",
      afterText: "after\n",
    }));

    expect(response.statusCode).toBe(statusCode);
    expect(response.payload).toMatchObject({ ok: false, code });
  });

  it("blocks stale hash mismatches at route level", async () => {
    projectDir = await createProject();
    await mkdir(join(projectDir, "chapters"), { recursive: true });
    await writeFile(join(projectDir, "chapters", "chapter-001.md"), "current\n", "utf-8");
    const body = validBody({
      projectPath: projectDir,
      targetPath: "chapters/chapter-001.md",
      beforeText: "before\n",
      afterText: "after\n",
    });

    const response = await callWorkspacePatchApplyRoute(body);

    expect(response.statusCode).toBe(409);
    expect(response.payload).toMatchObject({ ok: false, code: "stale_hash_mismatch" });
    await expect(readFile(join(projectDir, "chapters", "chapter-001.md"), "utf-8")).resolves.toBe("current\n");
  });

  it("blocks missing patch id at route level", async () => {
    projectDir = await createProject();
    const body = validBody({
      projectPath: projectDir,
      targetPath: "chapters/chapter-001.md",
      beforeText: "before\n",
      afterText: "after\n",
    });
    delete body.patchId;

    const response = await callWorkspacePatchApplyRoute(body);

    expect(response.statusCode).toBe(400);
    expect(response.payload).toMatchObject({ ok: false, code: "missing_patch_id" });
  });

  it("blocks missing user confirmation at route level", async () => {
    projectDir = await createProject();
    const body = {
      ...validBody({
        projectPath: projectDir,
        targetPath: "chapters/chapter-001.md",
        beforeText: "before\n",
        afterText: "after\n",
      }),
      userConfirmed: false,
    };

    const response = await callWorkspacePatchApplyRoute(body);

    expect(response.statusCode).toBe(400);
    expect(response.payload).toMatchObject({ ok: false, code: "missing_user_confirmation" });
  });

  it("blocks idempotency conflicts at route level", async () => {
    projectDir = await createProject();
    await mkdir(join(projectDir, "chapters"), { recursive: true });
    await mkdir(join(projectDir, "drafts"), { recursive: true });
    await writeFile(join(projectDir, "chapters", "chapter-001.md"), "before\n", "utf-8");
    await writeFile(join(projectDir, "drafts", "chapter-002.md"), "draft before\n", "utf-8");
    const idempotencyKey = "route-conflicting-idempotency-key";

    const first = await callWorkspacePatchApplyRoute({
      ...validBody({
        projectPath: projectDir,
        targetPath: "chapters/chapter-001.md",
        beforeText: "before\n",
        afterText: "after\n",
      }),
      idempotencyKey,
    });
    const second = await callWorkspacePatchApplyRoute({
      ...validBody({
        projectPath: projectDir,
        targetPath: "drafts/chapter-002.md",
        beforeText: "draft before\n",
        afterText: "draft after\n",
      }),
      idempotencyKey,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.payload).toMatchObject({ ok: false, code: "idempotency_key_conflict" });
  });

  it("blocks symlink transaction roots at route level before writing target or external artifacts", async () => {
    projectDir = await createProject();
    await mkdir(join(projectDir, "chapters"), { recursive: true });
    await writeFile(join(projectDir, "chapters", "chapter-001.md"), "before\n", "utf-8");
    const outsideDir = await makeHomeTempDir("story-engine-ui-workspace-patch-route-tx-outside-");
    externalDirs.push(outsideDir);
    await symlink(outsideDir, join(projectDir, ".story-engine-tx"), "dir");
    const idempotencyKey = "route-tx-root-symlink";

    const response = await callWorkspacePatchApplyRoute({
      ...validBody({
        projectPath: projectDir,
        targetPath: "chapters/chapter-001.md",
        beforeText: "before\n",
        afterText: "after\n",
      }),
      idempotencyKey,
    });

    expect(response.statusCode).toBe(403);
    expect(response.payload).toMatchObject({ ok: false, code: "transaction_root_unsafe" });
    await expect(readFile(join(projectDir, "chapters", "chapter-001.md"), "utf-8")).resolves.toBe("before\n");
    await expect(access(join(outsideDir, "workspace-patches", transactionIdFor(idempotencyKey), "manifest.json"))).rejects.toThrow();
  });
});

async function callWorkspacePatchApplyRoute(body: unknown): Promise<{
  readonly statusCode: number;
  readonly payload: Record<string, unknown>;
}> {
  const handlers: Middleware[] = [];
  registerWorkspacePatchApplyRoutes({ use: (handler) => handlers.push(handler) });
  const handler = handlers[0];
  if (!handler) throw new Error("route not registered");

  const req = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  req.url = "/api/workspace-patch/apply";
  req.method = "POST";

  const chunks: Buffer[] = [];
  const res = {
    statusCode: 200,
    setHeader: () => undefined,
    end: (chunk: string) => {
      chunks.push(Buffer.from(chunk));
      return {} as ServerResponse;
    },
  } as unknown as ServerResponse;

  await handler(req, res, () => undefined);
  return {
    statusCode: res.statusCode,
    payload: JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>,
  };
}

function validBody(input: {
  readonly projectPath: string;
  readonly targetPath: string;
  readonly beforeText: string;
  readonly afterText: string;
}): Record<string, unknown> {
  const preview = buildMarkdownPatchPreview({
    targetPath: input.targetPath,
    beforeText: input.beforeText,
    afterText: input.afterText,
  });
  return {
    projectPath: input.projectPath,
    targetPath: input.targetPath,
    beforeText: input.beforeText,
    afterText: input.afterText,
    patchId: preview.patchId,
    expectedBeforeHash: sha256(input.beforeText),
    userConfirmed: true,
    idempotencyKey: `idem-${sha256(input.targetPath).slice(0, 16)}`,
  };
}

async function createProject(): Promise<string> {
  const root = await makeHomeTempDir("story-engine-ui-workspace-patch-route-");
  await Promise.all([
    mkdir(join(root, "story"), { recursive: true }),
    mkdir(join(root, "timeline"), { recursive: true }),
    mkdir(join(root, "world"), { recursive: true }),
    mkdir(join(root, "characters"), { recursive: true }),
  ]);
  await writeFile(join(root, "project.json"), JSON.stringify({ title: "Patch Apply Route Test" }), "utf-8");
  return root;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

function transactionIdFor(idempotencyKey: string): string {
  return `workspace-patch-${sha256(idempotencyKey).slice(0, 16)}`;
}
