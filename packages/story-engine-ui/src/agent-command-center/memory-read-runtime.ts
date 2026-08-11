import type { Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";

import { guardMemoryReadDiskPath } from "./memory-read-disk-guard.js";
import { preflightMemoryReadPath } from "./memory-read-path-safety.js";
import {
  buildMemoryReadViewModel,
  type MemoryReadFixtureCategory,
  type MemoryReadFixtureItem,
  type MemoryReadViewModel,
  type MemoryReadViewModelFixture,
} from "./memory-read-viewmodel.js";

export interface MemoryReadRuntimeLimits {
  readonly maxFileBytes: number;
  readonly maxMemoryItems: number;
  readonly maxTextLengthPerItem: number;
}

export interface MemoryReadRuntimeInput {
  readonly projectRoot: string;
  readonly targetPath: string;
  readonly limits?: Partial<MemoryReadRuntimeLimits>;
  /**
   * @internal Test-only hooks for exercising TOCTOU / race-condition windows.
   * Production runtime integration must not expose this field to external callers.
   * TODO: before production runtime integration, move testHooks to an internal
   * test-only wrapper or symbol-gated internal input.
   */
  readonly testHooks?: {
    readonly afterFinalGuardBeforeOpen?: () => Promise<void>;
    readonly afterOpenFstatIdentityCheckBeforeRead?: () => Promise<void>;
  };
}

export interface MemoryReadRuntimeResult {
  readonly ok: boolean;
  readonly viewModel: MemoryReadViewModel;
  readonly warnings: readonly string[];
  readonly blockingReasons: readonly string[];
  readonly sourcePath: string | null;
  readonly normalizedPath: string;
  readonly didReadFile: boolean;
  readonly didAttemptReadFile: boolean;
  readonly didWriteMemory: false;
  readonly didInjectAutomatically: false;
}

const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
const HARD_MAX_FILE_BYTES = 64 * 1024;
const DEFAULT_MAX_MEMORY_ITEMS = 50;
const HARD_MAX_MEMORY_ITEMS = 100;
const DEFAULT_MAX_TEXT_LENGTH_PER_ITEM = 500;
const HARD_MAX_TEXT_LENGTH_PER_ITEM = 1000;

const DEFAULT_LIMITS: MemoryReadRuntimeLimits = {
  maxFileBytes: DEFAULT_MAX_FILE_BYTES,
  maxMemoryItems: DEFAULT_MAX_MEMORY_ITEMS,
  maxTextLengthPerItem: DEFAULT_MAX_TEXT_LENGTH_PER_ITEM,
};

const JSON_CATEGORY_MAP = {
  userPreferences: "user_preference",
  projectRules: "project_rule",
  characterFacts: "character_fact",
  worldFacts: "world_fact",
  writingStylePreferences: "writing_style_preference",
  unresolvedContinuityNotes: "unresolved_continuity_note",
  recentAcceptedMemoryProposals: "recent_accepted_memory_proposal",
  rejectedSkippedMemoryProposals: "rejected_skipped_memory_proposal",
} as const satisfies Record<string, MemoryReadFixtureCategory>;

const JSON_ITEM_TYPES = new Set<MemoryReadFixtureCategory>(Object.values(JSON_CATEGORY_MAP));

export async function readMemoryRuntimeMinimal(input: MemoryReadRuntimeInput): Promise<MemoryReadRuntimeResult> {
  const limits = sanitizeLimits(input.limits);
  const preflight = preflightMemoryReadPath(input);
  if (!preflight.allowed) {
    return blockedResult({
      normalizedPath: preflight.normalizedPath,
      blockingReasons: preflight.blockingReasons,
      warnings: [],
      sourcePath: null,
    });
  }

  const diskGuard = await guardMemoryReadDiskPath(input);
  if (!diskGuard.allowed) {
    return blockedResult({
      normalizedPath: diskGuard.normalizedPath,
      blockingReasons: diskGuard.blockingReasons,
      warnings: diskGuard.targetRole === "blocked_disk_check_failed" ? ["read failed warning: disk guard failed before content read."] : [],
      sourcePath: diskGuard.realTargetPath,
    });
  }

  const finalGuard = await guardMemoryReadDiskPath(input);
  if (!finalGuard.allowed) {
    return blockedResult({
      normalizedPath: finalGuard.normalizedPath,
      blockingReasons: finalGuard.blockingReasons,
      warnings: ["read failed warning: final pre-read revalidation failed."],
      sourcePath: finalGuard.realTargetPath,
    });
  }

  const sourcePath = finalGuard.realTargetPath;
  if (!sourcePath) {
    return blockedResult({
      normalizedPath: finalGuard.normalizedPath,
      blockingReasons: ["memory read final guard did not return a real target path."],
      warnings: ["read failed warning: missing final real target path."],
      sourcePath,
    });
  }

  let targetStat: Stats;
  try {
    targetStat = await lstat(sourcePath);
  } catch (error) {
    const warnings = [`read failed warning: final pre-read size check failed: ${errorMessage(error)}`];
    return {
      ok: false,
      viewModel: safeViewModel(warnings),
      warnings,
      blockingReasons: [],
      sourcePath,
      normalizedPath: finalGuard.normalizedPath,
      didReadFile: false,
      didAttemptReadFile: false,
      didWriteMemory: false,
      didInjectAutomatically: false,
    };
  }

  await input.testHooks?.afterFinalGuardBeforeOpen?.();

  const content = await safeReadMemoryFileContentAfterGuard({
    sourcePath,
    normalizedPath: finalGuard.normalizedPath,
    targetStat,
    limits,
    afterOpenFstatIdentityCheckBeforeRead: input.testHooks?.afterOpenFstatIdentityCheckBeforeRead,
  });
  if (!content.ok) return content.result;

  const parsed = parseMemorySource({
    normalizedPath: finalGuard.normalizedPath,
    text: content.text,
    limits,
  });

  return {
    ok: true,
    viewModel: buildMemoryReadViewModel(parsed.fixture),
    warnings: parsed.warnings,
    blockingReasons: [],
    sourcePath,
    normalizedPath: finalGuard.normalizedPath,
    didReadFile: true,
    didAttemptReadFile: true,
    didWriteMemory: false,
    didInjectAutomatically: false,
  };
}

async function safeReadMemoryFileContentAfterGuard(input: {
  readonly sourcePath: string;
  readonly normalizedPath: string;
  readonly targetStat: Stats;
  readonly limits: MemoryReadRuntimeLimits;
  readonly afterOpenFstatIdentityCheckBeforeRead?: () => Promise<void>;
}): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly result: MemoryReadRuntimeResult }> {
  const stableIdentity = stableStatIdentity(input.targetStat);
  if (!stableIdentity) {
    return {
      ok: false,
      result: blockedResult({
        normalizedPath: input.normalizedPath,
        blockingReasons: ["memory read target identity fields are insufficient for safe file-handle read."],
        warnings: ["read failed warning: stable file identity unavailable."],
        sourcePath: input.sourcePath,
      }),
    };
  }

  let fileHandle: Awaited<ReturnType<typeof open>>;
  try {
    fileHandle = await open(input.sourcePath, "r");
  } catch (error) {
    const warnings = [`read failed warning: open failed after final guard: ${errorMessage(error)}`];
    return {
      ok: false,
      result: failedReadResult({
        normalizedPath: input.normalizedPath,
        sourcePath: input.sourcePath,
        warnings,
        didAttemptReadFile: true,
      }),
    };
  }

  try {
    const handleStat = await fileHandle.stat();
    const handleIdentity = stableStatIdentity(handleStat);
    if (!handleIdentity) {
      return {
        ok: false,
        result: blockedResult({
          normalizedPath: input.normalizedPath,
          blockingReasons: ["memory read file handle identity fields are insufficient for safe read."],
          warnings: ["read failed warning: stable file handle identity unavailable."],
          sourcePath: input.sourcePath,
        }),
      };
    }

    if (!sameStableIdentity(stableIdentity, handleIdentity)) {
      return {
        ok: false,
        result: blockedResult({
          normalizedPath: input.normalizedPath,
          blockingReasons: ["memory read file identity mismatch blocked after open/fstat."],
          warnings: ["read failed warning: file identity changed before content read."],
          sourcePath: input.sourcePath,
        }),
      };
    }

    if (!handleStat.isFile()) {
      return {
        ok: false,
        result: blockedResult({
          normalizedPath: input.normalizedPath,
          blockingReasons: ["memory read file handle is not a regular file."],
          warnings: ["read failed warning: opened target is not a regular file."],
          sourcePath: input.sourcePath,
        }),
      };
    }

    if (handleStat.size > input.limits.maxFileBytes) {
      return {
        ok: false,
        result: blockedResult({
          normalizedPath: input.normalizedPath,
          blockingReasons: [`oversized file blocked before memory content read: ${handleStat.size} bytes.`],
          warnings: ["oversized file warning: memory source exceeds max file size."],
          sourcePath: input.sourcePath,
        }),
      };
    }

    await input.afterOpenFstatIdentityCheckBeforeRead?.();

    try {
      const buffer = Buffer.alloc(input.limits.maxFileBytes + 1);
      const { bytesRead } = await fileHandle.read(buffer, 0, input.limits.maxFileBytes + 1, 0);
      if (bytesRead > input.limits.maxFileBytes) {
        return {
          ok: false,
          result: blockedResult({
            normalizedPath: input.normalizedPath,
            blockingReasons: [`oversized file blocked because maxFileBytes exceeded during bounded read: ${bytesRead} bytes.`],
            warnings: ["oversized file warning: memory source exceeded maxFileBytes during bounded read."],
            sourcePath: input.sourcePath,
            didAttemptReadFile: true,
          }),
        };
      }

      return {
        ok: true,
        text: buffer.subarray(0, bytesRead).toString("utf-8"),
      };
    } catch (error) {
      const warnings = [`read failed warning: file handle read failed: ${errorMessage(error)}`];
      return {
        ok: false,
        result: failedReadResult({
          normalizedPath: input.normalizedPath,
          sourcePath: input.sourcePath,
          warnings,
          didAttemptReadFile: true,
        }),
      };
    }
  } finally {
    await fileHandle.close();
  }
}

function parseMemorySource(input: {
  readonly normalizedPath: string;
  readonly text: string;
  readonly limits: MemoryReadRuntimeLimits;
}): { readonly fixture: MemoryReadViewModelFixture; readonly warnings: readonly string[] } {
  if (input.text.trim().length === 0) {
    const warnings = ["empty file warning: memory source produced no readable items."];
    return { fixture: { warnings }, warnings };
  }

  if (input.normalizedPath.endsWith(".json")) {
    return parseJsonMemorySource(input);
  }

  return parseLineMemorySource(input);
}

function parseJsonMemorySource(input: {
  readonly normalizedPath: string;
  readonly text: string;
  readonly limits: MemoryReadRuntimeLimits;
}): { readonly fixture: MemoryReadViewModelFixture; readonly warnings: readonly string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.text);
  } catch (error) {
    const warnings = [`parse failed warning: malformed JSON: ${errorMessage(error)}`];
    return { fixture: { warnings }, warnings };
  }

  const items: CategorizedItem[] = [];
  if (Array.isArray(parsed)) {
    items.push(...parsed.flatMap((item, index) => toCategorizedItem(item, "project_rule", `${input.normalizedPath}:${index + 1}`)));
  } else if (isRecord(parsed)) {
    if (Array.isArray(parsed.memories)) {
      items.push(
        ...parsed.memories.flatMap((item, index) => toCategorizedItem(item, "project_rule", `${input.normalizedPath}:memories:${index + 1}`)),
      );
    }

    for (const [fixtureKey, category] of Object.entries(JSON_CATEGORY_MAP)) {
      const value = parsed[fixtureKey];
      if (!Array.isArray(value)) continue;
      items.push(...value.flatMap((item, index) => toCategorizedItem(item, category, `${input.normalizedPath}:${fixtureKey}:${index + 1}`)));
    }
  }

  return buildFixtureFromItems(items, input.limits);
}

function parseLineMemorySource(input: {
  readonly normalizedPath: string;
  readonly text: string;
  readonly limits: MemoryReadRuntimeLimits;
}): { readonly fixture: MemoryReadViewModelFixture; readonly warnings: readonly string[] } {
  const defaultCategory: MemoryReadFixtureCategory = input.normalizedPath.endsWith(".md")
    ? "unresolved_continuity_note"
    : "project_rule";
  const items = input.text
    .split(/\r?\n/u)
    .map((line, index) => ({ line: normalizeTextLine(line), lineNumber: index + 1 }))
    .filter((item) => item.line.length > 0)
    .map<CategorizedItem>((item) => ({
      category: defaultCategory,
      item: {
        id: `${input.normalizedPath}:${item.lineNumber}`,
        text: item.line,
        confidence: 0.6,
        relevanceScore: 0.6,
      },
    }));

  if (items.length === 0) {
    const warnings = ["malformed Markdown/TXT warning: no readable non-empty memory lines."];
    return { fixture: { warnings }, warnings };
  }

  return buildFixtureFromItems(items, input.limits);
}

interface CategorizedItem {
  readonly category: MemoryReadFixtureCategory;
  readonly item: MemoryReadFixtureItem;
}

function toCategorizedItem(value: unknown, fallbackCategory: MemoryReadFixtureCategory, fallbackId: string): CategorizedItem[] {
  if (!isRecord(value)) return [];
  const text = typeof value.text === "string"
    ? value.text
    : typeof value.proposedMemoryText === "string"
      ? value.proposedMemoryText
      : null;
  if (!text) return [];

  const rawType = typeof value.type === "string" ? value.type : fallbackCategory;
  const category = JSON_ITEM_TYPES.has(rawType as MemoryReadFixtureCategory)
    ? (rawType as MemoryReadFixtureCategory)
    : fallbackCategory;
  const id = typeof value.id === "string" ? value.id : fallbackId;

  return [
    {
      category,
      item: {
        id,
        text,
        confidence: typeof value.confidence === "number" ? value.confidence : 0.6,
        relevanceScore: typeof value.relevanceScore === "number" ? value.relevanceScore : 0.6,
      },
    },
  ];
}

function buildFixtureFromItems(
  items: readonly CategorizedItem[],
  limits: MemoryReadRuntimeLimits,
): { readonly fixture: MemoryReadViewModelFixture; readonly warnings: readonly string[] } {
  const warnings: string[] = [];
  const limitedItems = items.slice(0, limits.maxMemoryItems);
  if (items.length > limits.maxMemoryItems) {
    warnings.push("max item count warning: extra memory items were omitted.");
  }

  const fixture: MutableMemoryReadViewModelFixture = { warnings };
  for (const item of limitedItems) {
    const text = limitText(item.item.text, limits.maxTextLengthPerItem);
    if (text.wasTruncated) {
      warnings.push(`max text length per memory item warning: ${item.item.id} was truncated.`);
    }

    const fixtureItem: MemoryReadFixtureItem = {
      ...item.item,
      text: text.value,
    };

    const key = fixtureKeyFor(item.category);
    fixture[key] = [...(fixture[key] ?? []), fixtureItem] as never;
  }

  return { fixture, warnings };
}

type MutableMemoryReadViewModelFixture = {
  -readonly [Key in keyof MemoryReadViewModelFixture]: MemoryReadViewModelFixture[Key];
};

function fixtureKeyFor(category: MemoryReadFixtureCategory): keyof Pick<
  MemoryReadViewModelFixture,
  | "userPreferences"
  | "projectRules"
  | "characterFacts"
  | "worldFacts"
  | "writingStylePreferences"
  | "unresolvedContinuityNotes"
  | "recentAcceptedMemoryProposals"
  | "rejectedSkippedMemoryProposals"
> {
  switch (category) {
    case "user_preference":
      return "userPreferences";
    case "project_rule":
      return "projectRules";
    case "character_fact":
      return "characterFacts";
    case "world_fact":
      return "worldFacts";
    case "writing_style_preference":
      return "writingStylePreferences";
    case "unresolved_continuity_note":
      return "unresolvedContinuityNotes";
    case "recent_accepted_memory_proposal":
      return "recentAcceptedMemoryProposals";
    case "rejected_skipped_memory_proposal":
      return "rejectedSkippedMemoryProposals";
  }
}

function normalizeTextLine(line: string): string {
  return line.trim().replace(/^[-*]\s+/u, "").trim();
}

function limitText(text: string, maxLength: number): { readonly value: string; readonly wasTruncated: boolean } {
  if (text.length <= maxLength) {
    return { value: text, wasTruncated: false };
  }

  return { value: text.slice(0, Math.max(0, maxLength)), wasTruncated: true };
}

function sanitizeLimits(limits: Partial<MemoryReadRuntimeLimits> | undefined): MemoryReadRuntimeLimits {
  return {
    maxFileBytes: positiveIntegerWithinHardCap(
      limits?.maxFileBytes,
      DEFAULT_LIMITS.maxFileBytes,
      HARD_MAX_FILE_BYTES,
    ),
    maxMemoryItems: nonNegativeIntegerWithinHardCap(
      limits?.maxMemoryItems,
      DEFAULT_LIMITS.maxMemoryItems,
      HARD_MAX_MEMORY_ITEMS,
    ),
    maxTextLengthPerItem: nonNegativeIntegerWithinHardCap(
      limits?.maxTextLengthPerItem,
      DEFAULT_LIMITS.maxTextLengthPerItem,
      HARD_MAX_TEXT_LENGTH_PER_ITEM,
    ),
  };
}

function positiveIntegerWithinHardCap(value: number | undefined, fallback: number, hardCap: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return Math.min(value, hardCap);
}

function nonNegativeIntegerWithinHardCap(value: number | undefined, fallback: number, hardCap: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return fallback;
  }

  return Math.min(value, hardCap);
}

interface StableStatIdentity {
  readonly dev: number;
  readonly ino: number;
}

function stableStatIdentity(stat: Stats): StableStatIdentity | null {
  if (!Number.isSafeInteger(stat.dev) || !Number.isSafeInteger(stat.ino) || stat.ino <= 0) {
    return null;
  }

  return {
    dev: stat.dev,
    ino: stat.ino,
  };
}

function sameStableIdentity(left: StableStatIdentity, right: StableStatIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function blockedResult(input: {
  readonly normalizedPath: string;
  readonly blockingReasons: readonly string[];
  readonly warnings: readonly string[];
  readonly sourcePath: string | null;
  readonly didAttemptReadFile?: boolean;
}): MemoryReadRuntimeResult {
  return {
    ok: false,
    viewModel: safeViewModel(input.warnings),
    warnings: input.warnings,
    blockingReasons: input.blockingReasons,
    sourcePath: input.sourcePath,
    normalizedPath: input.normalizedPath,
    didReadFile: false,
    didAttemptReadFile: input.didAttemptReadFile ?? false,
    didWriteMemory: false,
    didInjectAutomatically: false,
  };
}

function failedReadResult(input: {
  readonly normalizedPath: string;
  readonly sourcePath: string;
  readonly warnings: readonly string[];
  readonly didAttemptReadFile: boolean;
}): MemoryReadRuntimeResult {
  return {
    ok: false,
    viewModel: safeViewModel(input.warnings),
    warnings: input.warnings,
    blockingReasons: [],
    sourcePath: input.sourcePath,
    normalizedPath: input.normalizedPath,
    didReadFile: false,
    didAttemptReadFile: input.didAttemptReadFile,
    didWriteMemory: false,
    didInjectAutomatically: false,
  };
}

function safeViewModel(warnings: readonly string[]): MemoryReadViewModel {
  return buildMemoryReadViewModel({ warnings });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
