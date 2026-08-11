export type MemoryReadFixtureCategory =
  | "user_preference"
  | "project_rule"
  | "character_fact"
  | "world_fact"
  | "writing_style_preference"
  | "unresolved_continuity_note"
  | "recent_accepted_memory_proposal"
  | "rejected_skipped_memory_proposal";

export interface MemoryReadFixtureItem {
  readonly id: string;
  readonly text: string;
  readonly confidence?: number;
  readonly relevanceScore?: number;
}

export interface MemoryReadViewModelFixture {
  readonly userPreferences?: readonly MemoryReadFixtureItem[];
  readonly projectRules?: readonly MemoryReadFixtureItem[];
  readonly characterFacts?: readonly MemoryReadFixtureItem[];
  readonly worldFacts?: readonly MemoryReadFixtureItem[];
  readonly writingStylePreferences?: readonly MemoryReadFixtureItem[];
  readonly unresolvedContinuityNotes?: readonly MemoryReadFixtureItem[];
  readonly recentAcceptedMemoryProposals?: readonly MemoryReadFixtureItem[];
  readonly rejectedSkippedMemoryProposals?: readonly MemoryReadFixtureItem[];
  readonly readFailed?: boolean;
  readonly failureMessage?: string;
  readonly warnings?: readonly string[];
  readonly lastUpdated?: string;
}

export interface MemoryReadViewModelItem {
  readonly id: string;
  readonly sourceId: string;
  readonly type: MemoryReadFixtureCategory;
  readonly text: string;
  readonly confidence: number;
  readonly relevanceScore: number;
  readonly readOnly: true;
  readonly canWrite: false;
  readonly canInjectAutomatically: false;
}

export interface MemoryReadViewModel {
  readonly summary: string;
  readonly relevantMemories: readonly MemoryReadViewModelItem[];
  readonly warnings: readonly string[];
  readonly sourceIds: readonly string[];
  readonly confidence: number;
  readonly relevanceScore: number;
  readonly lastUpdated: string | null;
  readonly readOnly: true;
  readonly canWrite: false;
  readonly canInjectAutomatically: false;
}

const CATEGORY_ORDER: readonly {
  readonly key: keyof Pick<
    MemoryReadViewModelFixture,
    | "unresolvedContinuityNotes"
    | "userPreferences"
    | "recentAcceptedMemoryProposals"
    | "writingStylePreferences"
    | "projectRules"
    | "rejectedSkippedMemoryProposals"
    | "characterFacts"
    | "worldFacts"
  >;
  readonly type: MemoryReadFixtureCategory;
}[] = [
  { key: "unresolvedContinuityNotes", type: "unresolved_continuity_note" },
  { key: "userPreferences", type: "user_preference" },
  { key: "recentAcceptedMemoryProposals", type: "recent_accepted_memory_proposal" },
  { key: "writingStylePreferences", type: "writing_style_preference" },
  { key: "projectRules", type: "project_rule" },
  { key: "rejectedSkippedMemoryProposals", type: "rejected_skipped_memory_proposal" },
  { key: "characterFacts", type: "character_fact" },
  { key: "worldFacts", type: "world_fact" },
];

function clampScore(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(3));
}

function toViewModelItem(type: MemoryReadFixtureCategory, item: MemoryReadFixtureItem): MemoryReadViewModelItem {
  return {
    id: item.id,
    sourceId: item.id,
    type,
    text: item.text,
    confidence: clampScore(item.confidence),
    relevanceScore: clampScore(item.relevanceScore),
    readOnly: true,
    canWrite: false,
    canInjectAutomatically: false,
  };
}

export function buildMemoryReadViewModel(fixture: MemoryReadViewModelFixture): MemoryReadViewModel {
  const relevantMemories = CATEGORY_ORDER.flatMap(({ key, type }) =>
    (fixture[key] ?? []).map((item) => toViewModelItem(type, item)),
  );

  const warnings = [
    ...(fixture.warnings ?? []),
    ...(fixture.readFailed
    ? [
        `Memory read failed: ${fixture.failureMessage ?? "unknown reason"}`,
        "Memory read failure cannot block Markdown apply.",
      ]
    : []),
  ];

  return {
    summary:
      relevantMemories.length === 0
        ? "暂无可用只读记忆上下文。"
        : `已汇总 ${relevantMemories.length} 条只读记忆上下文。`,
    relevantMemories,
    warnings,
    sourceIds: relevantMemories.map((memory) => memory.sourceId),
    confidence: average(relevantMemories.map((memory) => memory.confidence)),
    relevanceScore: average(relevantMemories.map((memory) => memory.relevanceScore)),
    lastUpdated: fixture.lastUpdated ?? null,
    readOnly: true,
    canWrite: false,
    canInjectAutomatically: false,
  };
}
