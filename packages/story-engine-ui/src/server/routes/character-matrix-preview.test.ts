import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewCharacterMatrixConfirmPreflight } from "../../api/client.js";
import { makeHomeTempDir } from "../lib/home-test-tmp.js";
import type { Middleware } from "../lib/project-io.js";
import { registerCharacterMatrixPreviewRoutes } from "./character-matrix-preview.js";

const targetFile = "story/character-matrix.json";

describe("character matrix preview/preflight route", () => {
  it("returns a safe read-only preview plan for a valid candidate", async () => {
    const projectDir = await createMatrixPreviewProject();

    const response = await callCharacterMatrixPreviewRoute({
      projectPath: projectDir,
      expectedTargetFile: targetFile,
      candidates: [validCandidate()],
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      ok: true,
      plan: {
        targetFile,
        blockedReasons: [],
        safeToConfirmFutureWrite: true,
        wouldWrite: false,
        changedFiles: [],
        changedEntryIds: ["matrix-lu-ying"],
      },
    });
    await expectMissing(projectDir, targetFile);
  });

  it("keeps invalid targets preview-only and does not write files", async () => {
    const projectDir = await createMatrixPreviewProject();

    const response = await callCharacterMatrixPreviewRoute({
      projectPath: projectDir,
      expectedTargetFile: "story/character-bible.json",
      candidates: [validCandidate()],
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      ok: true,
      plan: {
        safeToConfirmFutureWrite: false,
        blockedReasons: ["invalid_target_file"],
        wouldWrite: false,
        changedFiles: [],
      },
    });
    await expectMissing(projectDir, targetFile);
  });

  it("blocks missing expectedTargetFile instead of defaulting to the legal matrix target", async () => {
    const projectDir = await createMatrixPreviewProject();

    const response = await callCharacterMatrixPreviewRoute({
      projectPath: projectDir,
      candidates: [validCandidate()],
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      ok: true,
      plan: {
        safeToConfirmFutureWrite: false,
        blockedReasons: ["invalid_target_file"],
        wouldWrite: false,
        changedFiles: [],
      },
    });
    await expectMissing(projectDir, targetFile);
  });

  it("blocks empty expectedTargetFile instead of defaulting to the legal matrix target", async () => {
    const projectDir = await createMatrixPreviewProject();

    const response = await callCharacterMatrixPreviewRoute({
      projectPath: projectDir,
      expectedTargetFile: "",
      candidates: [validCandidate()],
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      ok: true,
      plan: {
        safeToConfirmFutureWrite: false,
        blockedReasons: ["invalid_target_file"],
        wouldWrite: false,
        changedFiles: [],
      },
    });
    await expectMissing(projectDir, targetFile);
  });

  it("blocks unsupported candidate statuses without writing the matrix", async () => {
    const projectDir = await createMatrixPreviewProject();

    const accepted = await callCharacterMatrixPreviewRoute({
      projectPath: projectDir,
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ status: "accepted" })],
    });
    const promoted = await callCharacterMatrixPreviewRoute({
      projectPath: projectDir,
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ status: "promoted" })],
    });
    const ignored = await callCharacterMatrixPreviewRoute({
      projectPath: projectDir,
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ status: "ignored" })],
    });

    for (const response of [accepted, promoted, ignored]) {
      expect(response.statusCode).toBe(200);
      expect(response.payload).toMatchObject({
        ok: true,
        plan: {
          safeToConfirmFutureWrite: false,
          blockedReasons: ["unsupported_candidate_status"],
          wouldWrite: false,
          changedFiles: [],
        },
      });
    }
    await expectMissing(projectDir, targetFile);
  });

  it("blocks unknown candidate status strings instead of normalizing them to candidate", async () => {
    const projectDir = await createMatrixPreviewProject();

    const response = await callCharacterMatrixPreviewRoute({
      projectPath: projectDir,
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ status: "foo" })],
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      ok: true,
      plan: {
        safeToConfirmFutureWrite: false,
        blockedReasons: ["unsupported_candidate_status"],
        wouldWrite: false,
        changedFiles: [],
      },
    });
    await expectMissing(projectDir, targetFile);
  });

  it("blocks malformed candidate status values instead of normalizing them to candidate", async () => {
    const projectDir = await createMatrixPreviewProject();

    const nullStatus = await callCharacterMatrixPreviewRoute({
      projectPath: projectDir,
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ status: null })],
    });
    const numberStatus = await callCharacterMatrixPreviewRoute({
      projectPath: projectDir,
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ status: 123 })],
    });

    for (const response of [nullStatus, numberStatus]) {
      expect(response.statusCode).toBe(200);
      expect(response.payload).toMatchObject({
        ok: true,
        plan: {
          safeToConfirmFutureWrite: false,
          blockedReasons: ["unsupported_candidate_status"],
          wouldWrite: false,
          changedFiles: [],
        },
      });
    }
    await expectMissing(projectDir, targetFile);
  });

  it("allows omitted candidate status and normalizes it to candidate", async () => {
    const projectDir = await createMatrixPreviewProject();
    const { status: _status, ...candidateWithoutStatus } = validCandidate();

    const response = await callCharacterMatrixPreviewRoute({
      projectPath: projectDir,
      expectedTargetFile: targetFile,
      candidates: [candidateWithoutStatus],
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      ok: true,
      plan: {
        safeToConfirmFutureWrite: true,
        blockedReasons: [],
        wouldWrite: false,
        changedFiles: [],
        candidates: [{ status: "candidate" }],
      },
    });
    await expectMissing(projectDir, targetFile);
  });

  it("does not write profile, bible, chapter, timeline, world, or memory files", async () => {
    const projectDir = await createMatrixPreviewProject();

    await callCharacterMatrixPreviewRoute({
      projectPath: projectDir,
      expectedTargetFile: targetFile,
      candidates: [validCandidate()],
    });

    await expectMissing(projectDir, "characters/lin-xiao/profile.json");
    await expectMissing(projectDir, "story/character-bible.json");
    await expectMissing(projectDir, "chapters/0001.md");
    await expectMissing(projectDir, "timeline/events.json");
    await expectMissing(projectDir, "world/state.json");
    await expectMissing(projectDir, "memory/context.json");
  });

  it("rejects unsafe project paths through guardProjectPath", async () => {
    const response = await callCharacterMatrixPreviewRoute({
      projectPath: "/etc",
      expectedTargetFile: targetFile,
      candidates: [validCandidate()],
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({
      ok: false,
      error: "不安全的项目路径",
    });
  });

  it("returns 405 for non-POST requests", async () => {
    const response = await callCharacterMatrixPreviewRoute({}, "GET");

    expect(response.statusCode).toBe(405);
    expect(response.payload).toEqual({
      ok: false,
      error: "Only POST is supported.",
    });
  });

  it("passes through non-matching routes", async () => {
    const handlers: Middleware[] = [];
    registerCharacterMatrixPreviewRoutes({ use: (handler) => handlers.push(handler) });
    const req = Object.assign(Readable.from([]), {
      method: "POST",
      url: "/api/character-matrix/confirm",
    }) as IncomingMessage;
    const res = createResponseCollector();
    let nextCalled = false;

    await new Promise<void>((resolve, reject) => {
      const result = handlers[0]?.(req, res.response, (error?: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        nextCalled = true;
        resolve();
      }) as unknown;
      Promise.resolve(result).then(() => resolve(), reject);
    });

    expect(nextCalled).toBe(true);
    expect(res.chunks).toEqual([]);
  });

  it("client method posts only preview fields to the preview endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => jsonResponse({
      ok: true,
      plan: {
        targetFile,
        baseHash: "base",
        previewHash: "preview",
        candidates: [],
        changedEntryIds: [],
        blockedReasons: [],
        safeToConfirmFutureWrite: true,
        wouldWrite: false,
        changedFiles: [],
        matrixWasMissing: true,
      },
    }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await previewCharacterMatrixConfirmPreflight({
      projectPath: "/Users/example/project",
      expectedTargetFile: targetFile,
      candidates: [validCandidate()],
      confirm: true,
      apply: true,
      write: true,
      route: "/api/commit/apply",
    } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/character-matrix/preview-preflight",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      projectPath: "/Users/example/project",
      expectedTargetFile: targetFile,
      candidates: [validCandidate()],
    });
    expect(body).not.toHaveProperty("confirm");
    expect(body).not.toHaveProperty("apply");
    expect(body).not.toHaveProperty("write");
    expect(body).not.toHaveProperty("route");
    expect(JSON.stringify(body)).not.toContain("/api/commit/apply");
    expect(JSON.stringify(body)).not.toContain("/api/formal-write/");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function createMatrixPreviewProject(): Promise<string> {
  const projectDir = await makeHomeTempDir("character-matrix-preview-");
  await writeFile(join(projectDir, "project.json"), "{\"title\":\"Matrix Preview\"}\n", "utf-8");
  await mkdir(join(projectDir, "story"), { recursive: true });
  await mkdir(join(projectDir, "timeline"), { recursive: true });
  await mkdir(join(projectDir, "world"), { recursive: true });
  await mkdir(join(projectDir, "characters"), { recursive: true });
  return projectDir;
}

async function callCharacterMatrixPreviewRoute(
  body: unknown,
  method = "POST",
): Promise<{
  readonly statusCode: number;
  readonly payload: Record<string, unknown>;
}> {
  const handlers: Middleware[] = [];
  registerCharacterMatrixPreviewRoutes({ use: (handler) => handlers.push(handler) });
  const req = Object.assign(Readable.from(method === "POST" ? [Buffer.from(JSON.stringify(body))] : []), {
    method,
    url: "/api/character-matrix/preview-preflight",
  }) as IncomingMessage;
  const res = createResponseCollector();

  await new Promise<void>((resolve, reject) => {
    const result = handlers[0]?.(req, res.response, (error?: unknown) => error ? reject(error) : resolve()) as unknown;
    Promise.resolve(result).then(() => resolve(), reject);
  });

  return {
    statusCode: res.response.statusCode,
    payload: JSON.parse(Buffer.concat(res.chunks).toString("utf-8")) as Record<string, unknown>,
  };
}

function createResponseCollector(): {
  readonly response: ServerResponse;
  readonly chunks: Buffer[];
} {
  const chunks: Buffer[] = [];
  const response = {
    statusCode: 200,
    setHeader: (name: string, value: string | number | readonly string[]) => {
      void name;
      void value;
      return response as unknown as ServerResponse;
    },
    end: (chunk?: string | Buffer) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return response as unknown as ServerResponse;
    },
  } as unknown as ServerResponse;
  return { response, chunks };
}

function validCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "matrix-lu-ying",
    name: "陆映",
    status: "candidate",
    roleHint: "风控合规部",
    relationToProtagonist: "提醒林序核对会议记录",
    riskHint: "可能隐藏权限盘来源",
    firstSeenChapter: 5,
    lastSeenChapter: 5,
    evidence: ["第5章在风控会议室门口递出蓝色权限盘。"],
    appearances: [{ chapter: 5, evidence: "陆映站在会议室门口等林序。" }],
    relationshipEvents: [{ chapter: 5, evidence: "陆映提醒林序先核对会议记录。" }],
    ...overrides,
  };
}

async function expectMissing(projectDir: string, relativePath: string): Promise<void> {
  await expect(access(join(projectDir, relativePath))).rejects.toThrow();
}

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
