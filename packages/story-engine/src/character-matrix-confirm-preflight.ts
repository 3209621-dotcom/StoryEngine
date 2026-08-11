import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CharacterMatrixAppearance,
  CharacterMatrixEntry,
  CharacterMatrixLedger,
  CharacterMatrixRelationshipEvent,
} from "./types.js";

export const CHARACTER_MATRIX_CONFIRM_TARGET_FILE = "story/character-matrix.json";

export type CharacterMatrixConfirmBlockedReason =
  | "invalid_target_file"
  | "empty_candidates"
  | "missing_candidate_id"
  | "missing_candidate_name"
  | "missing_evidence"
  | "duplicate_candidate_id"
  | "duplicate_candidate_name"
  | "unsupported_candidate_status"
  | "attempts_to_overwrite_accepted_character"
  | "attempts_to_overwrite_promoted_character"
  | "unsafe_path"
  | "malformed_matrix";

export interface CharacterMatrixConfirmCandidate {
  readonly id: string;
  readonly name: string;
  readonly status?: CharacterMatrixEntry["status"];
  readonly roleHint?: string;
  readonly relationToProtagonist?: string;
  readonly riskHint?: string;
  readonly firstSeenChapter?: number;
  readonly lastSeenChapter?: number;
  readonly evidence: readonly string[];
  readonly appearances?: readonly CharacterMatrixAppearance[];
  readonly relationshipEvents?: readonly CharacterMatrixRelationshipEvent[];
}

export interface CharacterMatrixConfirmPreflightInput {
  readonly projectDir: string;
  readonly candidates: readonly CharacterMatrixConfirmCandidate[];
  readonly expectedTargetFile: string;
}

export interface CharacterMatrixConfirmPreflightPlan {
  readonly targetFile: string;
  readonly baseHash: string;
  readonly previewHash: string;
  readonly candidates: readonly CharacterMatrixConfirmCandidate[];
  readonly changedEntryIds: readonly string[];
  readonly blockedReasons: readonly CharacterMatrixConfirmBlockedReason[];
  readonly safeToConfirmFutureWrite: boolean;
  readonly wouldWrite: false;
  readonly changedFiles: readonly [];
  readonly matrixWasMissing: boolean;
}

const DEFAULT_MATRIX: CharacterMatrixLedger = {
  version: "v0",
  entries: [],
};

export async function buildCharacterMatrixConfirmPreflightPlan(
  input: CharacterMatrixConfirmPreflightInput,
): Promise<CharacterMatrixConfirmPreflightPlan> {
  const blockedReasons = new Set<CharacterMatrixConfirmBlockedReason>();
  const targetFile = input.expectedTargetFile;
  if (targetFile !== CHARACTER_MATRIX_CONFIRM_TARGET_FILE) {
    blockedReasons.add("invalid_target_file");
  }
  if (isUnsafePath(targetFile)) {
    blockedReasons.add("unsafe_path");
  }

  const matrixSnapshot = await readMatrixSnapshot(input.projectDir);
  if (matrixSnapshot.malformed) {
    blockedReasons.add("malformed_matrix");
  }

  const candidates = normalizeCandidates(input.candidates);
  if (candidates.length === 0) {
    blockedReasons.add("empty_candidates");
  }
  for (const candidate of input.candidates) {
    if (candidate.status !== undefined && candidate.status !== "candidate") {
      blockedReasons.add("unsupported_candidate_status");
    }
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  for (const candidate of candidates) {
    const idKey = candidate.id.trim();
    const nameKey = candidate.name.trim();
    if (idKey.length === 0) {
      blockedReasons.add("missing_candidate_id");
    } else if (ids.has(idKey)) {
      blockedReasons.add("duplicate_candidate_id");
    } else {
      ids.add(idKey);
    }
    if (nameKey.length === 0) {
      blockedReasons.add("missing_candidate_name");
    } else if (names.has(nameKey)) {
      blockedReasons.add("duplicate_candidate_name");
    } else {
      names.add(nameKey);
    }
    if (candidate.evidence.length === 0) {
      blockedReasons.add("missing_evidence");
    }
    if (isUnsafePath(candidate.id) || isUnsafePath(candidate.name)) {
      blockedReasons.add("unsafe_path");
    }
    const existing = findExistingEntry(matrixSnapshot.matrix, candidate);
    if (existing?.status === "accepted") {
      blockedReasons.add("attempts_to_overwrite_accepted_character");
    }
    if (existing?.status === "promoted") {
      blockedReasons.add("attempts_to_overwrite_promoted_character");
    }
  }

  const baseHash = sha256(stableStringify(matrixSnapshot.matrix));
  const previewHash = sha256(stableStringify({
    targetFile,
    baseHash,
    candidates,
  }));

  return {
    targetFile,
    baseHash,
    previewHash,
    candidates,
    changedEntryIds: candidates.map((candidate) => candidate.id),
    blockedReasons: [...blockedReasons],
    safeToConfirmFutureWrite: blockedReasons.size === 0,
    wouldWrite: false,
    changedFiles: [],
    matrixWasMissing: matrixSnapshot.missing,
  };
}

interface MatrixSnapshot {
  readonly matrix: CharacterMatrixLedger;
  readonly missing: boolean;
  readonly malformed: boolean;
}

async function readMatrixSnapshot(projectDir: string): Promise<MatrixSnapshot> {
  try {
    const raw = await readFile(join(projectDir, CHARACTER_MATRIX_CONFIRM_TARGET_FILE), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isCharacterMatrixLedger(parsed)) {
      return { matrix: DEFAULT_MATRIX, missing: false, malformed: true };
    }
    return { matrix: normalizeMatrix(parsed), missing: false, malformed: false };
  } catch (error) {
    if (isNodeEnoent(error)) {
      return { matrix: DEFAULT_MATRIX, missing: true, malformed: false };
    }
    return { matrix: DEFAULT_MATRIX, missing: false, malformed: true };
  }
}

function normalizeMatrix(matrix: CharacterMatrixLedger): CharacterMatrixLedger {
  return {
    version: "v0",
    entries: matrix.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      status: entry.status,
      ...(entry.roleHint !== undefined ? { roleHint: entry.roleHint } : {}),
      ...(entry.relationToProtagonist !== undefined ? { relationToProtagonist: entry.relationToProtagonist } : {}),
      ...(entry.riskHint !== undefined ? { riskHint: entry.riskHint } : {}),
      ...(entry.firstSeenChapter !== undefined ? { firstSeenChapter: entry.firstSeenChapter } : {}),
      ...(entry.lastSeenChapter !== undefined ? { lastSeenChapter: entry.lastSeenChapter } : {}),
      ...(entry.promotedCharacterId !== undefined ? { promotedCharacterId: entry.promotedCharacterId } : {}),
      evidence: [...entry.evidence].filter((item) => item.trim().length > 0).sort(),
      appearances: [...entry.appearances].sort(compareEvidenceRecords),
      relationshipEvents: [...entry.relationshipEvents].sort(compareEvidenceRecords),
    })).sort(compareMatrixEntries),
  };
}

function normalizeCandidates(
  candidates: readonly CharacterMatrixConfirmCandidate[],
): readonly CharacterMatrixConfirmCandidate[] {
  return candidates.map((candidate) => ({
    id: candidate.id.trim(),
    name: candidate.name.trim(),
    status: candidate.status ?? "candidate",
    ...(definedTrim(candidate.roleHint) !== undefined ? { roleHint: definedTrim(candidate.roleHint) } : {}),
    ...(definedTrim(candidate.relationToProtagonist) !== undefined ? { relationToProtagonist: definedTrim(candidate.relationToProtagonist) } : {}),
    ...(definedTrim(candidate.riskHint) !== undefined ? { riskHint: definedTrim(candidate.riskHint) } : {}),
    ...(candidate.firstSeenChapter !== undefined ? { firstSeenChapter: candidate.firstSeenChapter } : {}),
    ...(candidate.lastSeenChapter !== undefined ? { lastSeenChapter: candidate.lastSeenChapter } : {}),
    evidence: [...candidate.evidence.map((item) => item.trim()).filter((item) => item.length > 0)].sort(),
    appearances: [...(candidate.appearances ?? [])].sort(compareEvidenceRecords),
    relationshipEvents: [...(candidate.relationshipEvents ?? [])].sort(compareEvidenceRecords),
  })).sort(compareCandidateEntries);
}

function findExistingEntry(
  matrix: CharacterMatrixLedger,
  candidate: CharacterMatrixConfirmCandidate,
): CharacterMatrixEntry | undefined {
  return matrix.entries.find((entry) => entry.id === candidate.id || entry.name === candidate.name);
}

function isCharacterMatrixLedger(value: unknown): value is CharacterMatrixLedger {
  if (!isRecord(value)) return false;
  if (value.version !== "v0") return false;
  if (!Array.isArray(value.entries)) return false;
  return value.entries.every(isCharacterMatrixEntry);
}

function isCharacterMatrixEntry(value: unknown): value is CharacterMatrixEntry {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.name === "string"
    && isMatrixStatus(value.status)
    && Array.isArray(value.evidence)
    && value.evidence.every((item) => typeof item === "string")
    && Array.isArray(value.appearances)
    && value.appearances.every(isAppearance)
    && Array.isArray(value.relationshipEvents)
    && value.relationshipEvents.every(isRelationshipEvent);
}

function isMatrixStatus(value: unknown): value is CharacterMatrixEntry["status"] {
  return value === "candidate" || value === "accepted" || value === "ignored" || value === "promoted";
}

function isAppearance(value: unknown): value is CharacterMatrixAppearance {
  return isRecord(value) && typeof value.chapter === "number" && typeof value.evidence === "string";
}

function isRelationshipEvent(value: unknown): value is CharacterMatrixRelationshipEvent {
  return isRecord(value) && typeof value.chapter === "number" && typeof value.evidence === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnsafePath(value: string): boolean {
  return value.startsWith("/")
    || value.includes("\\")
    || value.split("/").some((part) => part === ".." || part === ".");
}

function definedTrim(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function compareMatrixEntries(left: CharacterMatrixEntry, right: CharacterMatrixEntry): number {
  return compareEntryKeys(left.id, left.name, right.id, right.name);
}

function compareCandidateEntries(left: CharacterMatrixConfirmCandidate, right: CharacterMatrixConfirmCandidate): number {
  return compareEntryKeys(left.id, left.name, right.id, right.name);
}

function compareEntryKeys(leftId: string, leftName: string, rightId: string, rightName: string): number {
  const idCompare = leftId.localeCompare(rightId);
  return idCompare !== 0 ? idCompare : leftName.localeCompare(rightName);
}

function compareEvidenceRecords(
  left: CharacterMatrixAppearance | CharacterMatrixRelationshipEvent,
  right: CharacterMatrixAppearance | CharacterMatrixRelationshipEvent,
): number {
  const chapterCompare = left.chapter - right.chapter;
  return chapterCompare !== 0 ? chapterCompare : left.evidence.localeCompare(right.evidence);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isNodeEnoent(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
