import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CharacterMatrixConfirmCandidate } from "../character-matrix-confirm-preflight.js";
import { buildCharacterMatrixConfirmPreflightPlan } from "../character-matrix-confirm-preflight.js";

const targetFile = "story/character-matrix.json";

describe("Character Matrix Confirm Preview/Preflight V1", () => {
  it("builds a safe preview plan for a valid candidate without writing files", async () => {
    const projectDir = await emptyProject();
    const beforeExists = await exists(join(projectDir, targetFile));

    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir,
      expectedTargetFile: targetFile,
      candidates: [validCandidate()],
    });

    expect(plan).toMatchObject({
      targetFile,
      blockedReasons: [],
      safeToConfirmFutureWrite: true,
      wouldWrite: false,
      changedFiles: [],
      changedEntryIds: ["matrix-lu-ying"],
    });
    expect(plan.baseHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.previewHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(await exists(join(projectDir, targetFile))).toBe(beforeExists);
  });

  it("blocks target files other than story/character-matrix.json", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: "story/character-bible.json",
      candidates: [validCandidate()],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("invalid_target_file");
    expect(plan.wouldWrite).toBe(false);
    expect(plan.changedFiles).toEqual([]);
  });

  it("blocks empty candidates", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: targetFile,
      candidates: [],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("empty_candidates");
  });

  it("blocks missing candidate id", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: targetFile,
      candidates: [{ ...validCandidate(), id: " " }],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("missing_candidate_id");
  });

  it("blocks missing candidate name", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: targetFile,
      candidates: [{ ...validCandidate(), name: "" }],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("missing_candidate_name");
  });

  it("blocks missing evidence", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: targetFile,
      candidates: [{ ...validCandidate(), evidence: [" "] }],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("missing_evidence");
  });

  it("blocks duplicate candidate ids", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: targetFile,
      candidates: [
        validCandidate({ id: "matrix-lu-ying", name: "陆映" }),
        validCandidate({ id: "matrix-lu-ying", name: "陆映-重复" }),
      ],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("duplicate_candidate_id");
  });

  it("blocks duplicate candidate names", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: targetFile,
      candidates: [
        validCandidate({ id: "matrix-lu-ying", name: "陆映" }),
        validCandidate({ id: "matrix-lu-ying-2", name: "陆映" }),
      ],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("duplicate_candidate_name");
  });

  it("blocks candidate status accepted for V1", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ status: "accepted" })],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("unsupported_candidate_status");
    expect(plan.wouldWrite).toBe(false);
    expect(plan.changedFiles).toEqual([]);
  });

  it("blocks candidate status promoted for V1", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ status: "promoted" })],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("unsupported_candidate_status");
    expect(plan.wouldWrite).toBe(false);
    expect(plan.changedFiles).toEqual([]);
  });

  it("blocks candidate status ignored for V1", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ status: "ignored" })],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("unsupported_candidate_status");
    expect(plan.wouldWrite).toBe(false);
    expect(plan.changedFiles).toEqual([]);
  });

  it("allows undefined candidate status by normalizing to candidate", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ status: undefined })],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(true);
    expect(plan.blockedReasons).not.toContain("unsupported_candidate_status");
    expect(plan.candidates[0]?.status).toBe("candidate");
    expect(plan.wouldWrite).toBe(false);
    expect(plan.changedFiles).toEqual([]);
  });

  it("allows candidate status", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ status: "candidate" })],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(true);
    expect(plan.blockedReasons).not.toContain("unsupported_candidate_status");
    expect(plan.candidates[0]?.status).toBe("candidate");
    expect(plan.wouldWrite).toBe(false);
    expect(plan.changedFiles).toEqual([]);
  });

  it("blocks attempts to overwrite an accepted character", async () => {
    const projectDir = await projectWithMatrix({
      version: "v0",
      entries: [{
        ...validCandidate({ id: "matrix-lu-ying", name: "陆映" }),
        status: "accepted",
      }],
    });

    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir,
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ id: "matrix-lu-ying", name: "陆映" })],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("attempts_to_overwrite_accepted_character");
  });

  it("blocks attempts to overwrite a promoted character", async () => {
    const projectDir = await projectWithMatrix({
      version: "v0",
      entries: [{
        ...validCandidate({ id: "matrix-lu-ying", name: "陆映" }),
        status: "promoted",
      }],
    });

    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir,
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ id: "matrix-lu-ying", name: "陆映" })],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("attempts_to_overwrite_promoted_character");
  });

  it("blocks malformed existing matrix without throwing", async () => {
    const projectDir = await emptyProject();
    await mkdir(join(projectDir, "story"), { recursive: true });
    await writeFile(join(projectDir, targetFile), "{\"version\":\"v0\",\"entries\":", "utf-8");

    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir,
      expectedTargetFile: targetFile,
      candidates: [validCandidate()],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("malformed_matrix");
    expect(plan.wouldWrite).toBe(false);
  });

  it("uses the default empty matrix when the file is missing", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: targetFile,
      candidates: [validCandidate()],
    });

    expect(plan.matrixWasMissing).toBe(true);
    expect(plan.blockedReasons).not.toContain("malformed_matrix");
    expect(plan.safeToConfirmFutureWrite).toBe(true);
  });

  it("keeps baseHash stable for identical matrix content", async () => {
    const matrix = {
      version: "v0",
      entries: [validCandidate()],
    };
    const firstProject = await projectWithMatrix(matrix);
    const secondProject = await projectWithMatrix(matrix);

    const first = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: firstProject,
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ id: "matrix-zhou-boyan", name: "周泊言" })],
    });
    const second = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: secondProject,
      expectedTargetFile: targetFile,
      candidates: [validCandidate({ id: "matrix-zhou-boyan", name: "周泊言" })],
    });

    expect(first.baseHash).toBe(second.baseHash);
  });

  it("keeps previewHash stable for identical input", async () => {
    const projectDir = await emptyProject();
    const input = {
      projectDir,
      expectedTargetFile: targetFile,
      candidates: [validCandidate()],
    };

    const first = await buildCharacterMatrixConfirmPreflightPlan(input);
    const second = await buildCharacterMatrixConfirmPreflightPlan(input);

    expect(first.previewHash).toBe(second.previewHash);
  });

  it("keeps previewHash stable when candidate order changes semantically", async () => {
    const projectDir = await emptyProject();
    const luYing = validCandidate({ id: "matrix-lu-ying", name: "陆映" });
    const zhouBoyan = validCandidate({ id: "matrix-zhou-boyan", name: "周泊言" });

    const first = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir,
      expectedTargetFile: targetFile,
      candidates: [luYing, zhouBoyan],
    });
    const second = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir,
      expectedTargetFile: targetFile,
      candidates: [zhouBoyan, luYing],
    });

    expect(first.previewHash).toBe(second.previewHash);
    expect(first.candidates.map((candidate) => candidate.id)).toEqual(["matrix-lu-ying", "matrix-zhou-boyan"]);
  });

  it("does not write story/character-matrix.json", async () => {
    const projectDir = await projectWithMatrix({
      version: "v0",
      entries: [],
    });
    const before = await readFile(join(projectDir, targetFile), "utf-8");

    await buildCharacterMatrixConfirmPreflightPlan({
      projectDir,
      expectedTargetFile: targetFile,
      candidates: [validCandidate()],
    });

    await expect(readFile(join(projectDir, targetFile), "utf-8")).resolves.toBe(before);
  });

  it("does not write profile, bible, chapter, timeline, world, or memory files", async () => {
    const projectDir = await emptyProject();

    await buildCharacterMatrixConfirmPreflightPlan({
      projectDir,
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

  it("blocks unsafe paths in target and candidate identifiers", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: "../story/character-matrix.json",
      candidates: [validCandidate({ id: "../matrix-lu-ying" })],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("unsafe_path");
  });

  it("blocks absolute target paths as unsafe invalid targets", async () => {
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir: await emptyProject(),
      expectedTargetFile: "/tmp/story/character-matrix.json",
      candidates: [validCandidate()],
    });

    expect(plan.safeToConfirmFutureWrite).toBe(false);
    expect(plan.blockedReasons).toContain("invalid_target_file");
    expect(plan.blockedReasons).toContain("unsafe_path");
    expect(plan.wouldWrite).toBe(false);
    expect(plan.changedFiles).toEqual([]);
  });

  it("does not expose commit apply, formal write routes, or CommitEngine apply imports in preflight source", async () => {
    const source = await readFile(new URL("../character-matrix-confirm-preflight.ts", import.meta.url), "utf-8");

    expect(source).not.toContain("/api/commit/apply");
    expect(source).not.toContain("/api/formal-write/");
    expect(source).not.toContain("commitFastDraft");
    expect(source).not.toContain("applyCommit");
    expect(source).not.toContain("CommitEngine");
  });
});

async function emptyProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "story-engine-matrix-preflight-"));
}

async function projectWithMatrix(matrix: unknown): Promise<string> {
  const projectDir = await emptyProject();
  await mkdir(join(projectDir, "story"), { recursive: true });
  await writeFile(join(projectDir, targetFile), `${JSON.stringify(matrix, null, 2)}\n`, "utf-8");
  return projectDir;
}

function validCandidate(overrides: Partial<CharacterMatrixConfirmCandidate> = {}): CharacterMatrixConfirmCandidate {
  return {
    id: "matrix-lu-ying",
    name: "陆映",
    status: "candidate" as const,
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

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function expectMissing(projectDir: string, relativePath: string): Promise<void> {
  await expect(access(join(projectDir, relativePath))).rejects.toThrow();
}
