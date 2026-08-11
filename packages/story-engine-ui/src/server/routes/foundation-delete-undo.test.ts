import { readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { applyFoundationWriteSuggestion, createStoryProject, toSafeCharacterId } from "@actalk/story-engine";
import { afterEach, describe, expect, it } from "vitest";
import type { FoundationGapSuggestion } from "../../api/types.js";
import { makeHomeTempDir } from "../lib/home-test-tmp.js";
import type { Middleware } from "../lib/project-io.js";
import { registerFoundationGapsRoutes } from "./foundation-gaps.js";

// 跟踪本文件建的临时根目录。用 mkdtemp 一建成功就登记，这样即便后续建项目步骤抛错，
// afterEach 也能把根目录清掉，不会在 home 里留下空壳（旧版按 projectDir 清，偶发漏清）。
const createdRoots = new Set<string>();

describe("foundation delete undo roundtrip", () => {
  let projectDir: string | undefined;

  afterEach(async () => {
    await Promise.all([...createdRoots].map((root) => rm(root, { recursive: true, force: true })));
    createdRoots.clear();
    projectDir = undefined;
  });

  it("deletes a character through the apply route and restores everything via rollback", async () => {
    projectDir = await createDeleteTestProject();
    const targetId = toSafeCharacterId("苏晓薇");
    const suggestion = deleteCharacterSuggestion(targetId);

    const applyResponse = await callFoundationGapsRoute("/api/foundation-gaps/apply", {
      projectPath: projectDir,
      confirm: true,
      decisions: [{ suggestionId: suggestion.id, decision: "accept" }],
      currentSuggestions: [suggestion],
    });

    expect(applyResponse.statusCode).toBe(200);
    const applyResult = applyResponse.payload.result as {
      readonly applied: boolean;
      readonly writes: readonly { readonly targetFile: string }[];
      readonly undo?: { readonly undoId: string; readonly changedFiles: readonly string[] };
    };
    expect(applyResult.applied).toBe(true);
    expect(applyResult.undo?.undoId).toBeTruthy();
    expect(applyResult.undo?.changedFiles).toContain("story/character-bible.json");
    expect(applyResult.undo?.changedFiles).toContain(`characters/${targetId}/profile.json`);

    const bibleAfterDelete = await readProjectJson<{ readonly characters: readonly { readonly name: string }[] }>(projectDir, "story/character-bible.json");
    expect(bibleAfterDelete.characters.some((character) => character.name === "苏晓薇")).toBe(false);
    await expect(readFile(join(projectDir, "characters", targetId, "profile.json"), "utf-8")).rejects.toThrow();

    const rollbackResponse = await callFoundationGapsRoute("/api/foundation-gaps/rollback", {
      projectPath: projectDir,
      undoId: applyResult.undo?.undoId,
    });

    expect(rollbackResponse.statusCode).toBe(200);
    const bibleAfterRollback = await readProjectJson<{ readonly characters: readonly { readonly name: string }[] }>(projectDir, "story/character-bible.json");
    expect(bibleAfterRollback.characters.some((character) => character.name === "苏晓薇")).toBe(true);
    await expect(readFile(join(projectDir, "characters", targetId, "profile.json"), "utf-8")).resolves.toContain("苏晓薇");
  });

  it("skips unconfirmed deletes of appeared characters and applies after confirmation", async () => {
    projectDir = await createDeleteTestProject({ withAppearances: true });
    const targetId = toSafeCharacterId("苏晓薇");
    const suggestion = deleteCharacterSuggestion(targetId);

    const blockedResponse = await callFoundationGapsRoute("/api/foundation-gaps/apply", {
      projectPath: projectDir,
      confirm: true,
      decisions: [{ suggestionId: suggestion.id, decision: "accept" }],
      currentSuggestions: [suggestion],
    });
    const blockedResult = blockedResponse.payload.result as {
      readonly applied: boolean;
      readonly plan: { readonly skippedConflicts: readonly { readonly description: string }[] };
    };
    expect(blockedResult.applied).toBe(false);
    expect(blockedResult.plan.skippedConflicts.some((conflict) => conflict.description.startsWith("delete_needs_explicit_confirm:"))).toBe(true);
    const bibleStillThere = await readProjectJson<{ readonly characters: readonly { readonly name: string }[] }>(projectDir, "story/character-bible.json");
    expect(bibleStillThere.characters.some((character) => character.name === "苏晓薇")).toBe(true);

    const confirmedResponse = await callFoundationGapsRoute("/api/foundation-gaps/apply", {
      projectPath: projectDir,
      confirm: true,
      decisions: [{ suggestionId: suggestion.id, decision: "accept" }],
      currentSuggestions: [{ ...suggestion, confirmedByUser: true }],
    });
    const confirmedResult = confirmedResponse.payload.result as { readonly applied: boolean };
    expect(confirmedResult.applied).toBe(true);
    const bibleAfter = await readProjectJson<{ readonly characters: readonly { readonly name: string }[] }>(projectDir, "story/character-bible.json");
    expect(bibleAfter.characters.some((character) => character.name === "苏晓薇")).toBe(false);
  });
});

function deleteCharacterSuggestion(targetId: string): FoundationGapSuggestion {
  return {
    id: "ai-delete-test-1",
    gapId: "ai-gap-delete",
    category: "characters",
    actionType: "delete_foundation_entry",
    targetFile: "story/character-bible.json",
    targetPath: "$",
    targetId,
    before: { name: "苏晓薇" },
    after: null,
    rationale: "用户明确要求删除该角色资料。",
    risk: "warning",
    requiresUserConfirm: true,
    sourceUserMessage: "删除角色苏晓薇",
    extractedEntityName: "苏晓薇",
  };
}

async function createDeleteTestProject(options: { readonly withAppearances?: boolean } = {}): Promise<string> {
  const rootDir = await makeHomeTempDir("story-engine-ui-foundation-delete-");
  createdRoots.add(rootDir);
  const { projectDir } = await createStoryProject({
    rootDir,
    title: "删除集成测试",
    genre: "都市爽文",
    premise: "林远进入集团权力中心。",
    mainCharacterName: "林远",
  });
  await applyFoundationWriteSuggestion({
    projectDir,
    suggestion: {
      actionType: "create_character",
      targetFile: "story/character-bible.json",
      targetPath: "characters",
      after: { name: "苏晓薇", role: "重要配角" },
      extractedEntityName: "苏晓薇",
    },
  });
  if (options.withAppearances) {
    const targetId = toSafeCharacterId("苏晓薇");
    await writeFile(join(projectDir, "story", "character-matrix.json"), `${JSON.stringify({
      version: "v0",
      entries: [{
        id: targetId,
        name: "苏晓薇",
        status: "accepted",
        evidence: [],
        appearances: [{ chapter: 3, evidence: "第3章出场" }],
        relationshipEvents: [],
      }],
    }, null, 2)}\n`, "utf-8");
  }
  return projectDir;
}

async function readProjectJson<T>(projectDir: string, relativePath: string): Promise<T> {
  return JSON.parse(await readFile(join(projectDir, relativePath), "utf-8")) as T;
}

async function callFoundationGapsRoute(
  path: string,
  body?: Record<string, unknown>,
): Promise<{ readonly statusCode: number; readonly payload: Record<string, unknown> }> {
  const handlers: Middleware[] = [];
  registerFoundationGapsRoutes({ use: (handler) => handlers.push(handler) });
  const rawBody = body ? JSON.stringify(body) : "";
  const req = Object.assign(Readable.from(rawBody ? [Buffer.from(rawBody)] : []), {
    method: "POST",
    url: path,
  }) as IncomingMessage;
  const chunks: Buffer[] = [];
  const res = {
    statusCode: 200,
    setHeader: (name: string, value: string | number | readonly string[]) => {
      void name;
      void value;
      return res as unknown as ServerResponse;
    },
    end: (chunk?: string | Buffer) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return res as unknown as ServerResponse;
    },
  } as unknown as ServerResponse;

  await new Promise<void>((resolve, reject) => {
    const result = handlers[0]?.(req, res, (error?: unknown) => error ? reject(error) : resolve()) as unknown;
    Promise.resolve(result).then(() => resolve(), reject);
  });

  const payload = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>;
  return { statusCode: res.statusCode, payload };
}
