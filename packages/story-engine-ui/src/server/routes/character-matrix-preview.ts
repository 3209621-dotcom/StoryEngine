/**
 * POST /api/character-matrix/preview-preflight
 *
 * Read-only Character Matrix preview/preflight scaffold.
 * This route exposes the core preflight plan and never writes matrix, story,
 * chapter, timeline, world, memory, or character files.
 */
import {
  buildCharacterMatrixConfirmPreflightPlan,
  type CharacterMatrixConfirmCandidate,
  type CharacterMatrixConfirmBlockedReason,
} from "@actalk/story-engine";
import {
  assertStoryEngineProject,
  guardProjectPath,
  readJsonBody,
  readString,
  writeJson,
  type DevApiResponse,
  type MiddlewareStack,
} from "../lib/project-io.js";

export function registerCharacterMatrixPreviewRoutes(middlewares: MiddlewareStack): void {
  middlewares.use(async (req, res, next) => {
    const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";
    if (pathname !== "/api/character-matrix/preview-preflight") {
      next();
      return;
    }
    await handleCharacterMatrixPreviewPreflight(req, res);
  });
}

async function handleCharacterMatrixPreviewPreflight(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Only POST is supported." });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const projectDir = readString(body.projectPath);
    if (!projectDir) {
      writeJson(res, 400, { ok: false, error: "Project path is required." });
      return;
    }
    if (!guardProjectPath(res, projectDir)) return;
    await assertStoryEngineProject(projectDir);

    const rawCandidates = body.candidates;
    const plan = await buildCharacterMatrixConfirmPreflightPlan({
      projectDir,
      expectedTargetFile: readString(body.expectedTargetFile) ?? "",
      candidates: readCharacterMatrixConfirmCandidates(rawCandidates),
    });
    const responsePlan = hasUnsupportedRawCandidateStatus(rawCandidates)
      ? blockPlan(plan, "unsupported_candidate_status")
      : plan;

    writeJson(res, 200, { ok: true, plan: responsePlan } as unknown as DevApiResponse);
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function readCharacterMatrixConfirmCandidates(value: unknown): readonly CharacterMatrixConfirmCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item): CharacterMatrixConfirmCandidate => ({
    id: readString(item.id) ?? "",
    name: readString(item.name) ?? "",
    ...(readCharacterMatrixStatus(item.status) !== undefined ? { status: readCharacterMatrixStatus(item.status) } : {}),
    ...(readString(item.roleHint) !== undefined ? { roleHint: readString(item.roleHint) ?? "" } : {}),
    ...(readString(item.relationToProtagonist) !== undefined ? { relationToProtagonist: readString(item.relationToProtagonist) ?? "" } : {}),
    ...(readString(item.riskHint) !== undefined ? { riskHint: readString(item.riskHint) ?? "" } : {}),
    ...(readNumber(item.firstSeenChapter) !== undefined ? { firstSeenChapter: readNumber(item.firstSeenChapter) ?? 0 } : {}),
    ...(readNumber(item.lastSeenChapter) !== undefined ? { lastSeenChapter: readNumber(item.lastSeenChapter) ?? 0 } : {}),
    evidence: readStringArray(item.evidence),
    appearances: readAppearanceArray(item.appearances),
    relationshipEvents: readRelationshipEventArray(item.relationshipEvents),
  }));
}

function readCharacterMatrixStatus(value: unknown): CharacterMatrixConfirmCandidate["status"] | undefined {
  if (value === "candidate" || value === "accepted" || value === "ignored" || value === "promoted") return value;
  return undefined;
}

function hasUnsupportedRawCandidateStatus(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.filter(isRecord).some((item) => {
    if (!Object.prototype.hasOwnProperty.call(item, "status")) return false;
    return readCharacterMatrixStatus(item.status) === undefined;
  });
}

function blockPlan(
  plan: Awaited<ReturnType<typeof buildCharacterMatrixConfirmPreflightPlan>>,
  reason: CharacterMatrixConfirmBlockedReason,
): Awaited<ReturnType<typeof buildCharacterMatrixConfirmPreflightPlan>> {
  const blockedReasons = plan.blockedReasons.includes(reason) ? plan.blockedReasons : [...plan.blockedReasons, reason];
  return {
    ...plan,
    blockedReasons,
    safeToConfirmFutureWrite: false,
    wouldWrite: false,
    changedFiles: [],
  };
}

function readAppearanceArray(value: unknown): CharacterMatrixConfirmCandidate["appearances"] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    chapter: readNumber(item.chapter) ?? 0,
    evidence: readString(item.evidence) ?? "",
    ...(readString(item.location) !== undefined ? { location: readString(item.location) ?? "" } : {}),
  }));
}

function readRelationshipEventArray(value: unknown): CharacterMatrixConfirmCandidate["relationshipEvents"] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    chapter: readNumber(item.chapter) ?? 0,
    evidence: readString(item.evidence) ?? "",
    ...(readString(item.relationToProtagonist) !== undefined ? { relationToProtagonist: readString(item.relationToProtagonist) ?? "" } : {}),
  }));
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(readString).filter((item): item is string => item !== undefined) : [];
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
