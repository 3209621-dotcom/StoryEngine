/**
 * 读项目的厚版世界观结构（GET /api/worldbuilding）。由 generate_worldbuilding 工具落盘，
 * WorldbuildingCodexPanel 据此渲染卡片/关系网。还没生成过 → 返回 null。
 */

export interface WorldbuildingData {
  readonly overview: {
    readonly oneLine: string;
    readonly tone: string;
    readonly coreConflict: string;
    // 厚版概要明细（旧数据无则缺，前端降级）。
    readonly worldName?: string;
    readonly genreBase?: string;
    readonly era?: string;
    readonly coreTheme?: string;
    readonly toneTags?: readonly string[];
    readonly worldSentence?: string;
  };
  readonly worldRules?: {
    readonly realityStability?: string;
    readonly supernaturalVisibility?: string;
    readonly truthAccessibility?: string;
    readonly narrativeLimit?: string;
  };
  readonly socialStructure: readonly string[];
  /** 世界观自定义额外字段（破例⑦展示；来自 world/state.json 的 extraFields，经引擎正典兜底带入）。 */
  readonly extraFields?: Readonly<Record<string, string | readonly string[]>>;
  readonly rules: readonly { readonly name: string; readonly detail: string }[];
  readonly factions?: readonly {
    readonly name: string;
    readonly stance: string;
    readonly longTermGoal: string;
    readonly fear: string;
    readonly narrativeValue: string;
  }[];
  readonly forces: readonly {
    readonly name: string;
    readonly type: string;
    readonly resources: string;
    readonly objective: string;
    readonly pressure: string;
    readonly hiddenObjective?: string;
  }[];
  readonly specialElements?: readonly {
    readonly name: string;
    readonly type: string;
    readonly effect: string;
    readonly cost: string;
    readonly controller: string;
    readonly plotValue: string;
  }[];
  readonly locations: readonly {
    readonly name: string;
    readonly type?: string;
    readonly function: string;
    readonly risk?: string;
  }[];
  readonly relations: readonly { readonly from: string; readonly to: string; readonly relation: string; readonly stability?: string }[];
  readonly conflictSources: readonly string[];
  readonly storyEntries: readonly { readonly title: string; readonly hook: string }[];
  readonly storyBinding?: {
    readonly activeForces?: readonly string[];
    readonly coreLocations?: readonly string[];
    readonly usedElements?: readonly string[];
    readonly conflictTypes?: readonly string[];
    readonly forbidden?: readonly string[];
    readonly toneSupport?: readonly string[];
  };
}

export async function fetchWorldbuilding(projectPath: string): Promise<WorldbuildingData | null> {
  const res = await fetch(`/api/worldbuilding?project=${encodeURIComponent(projectPath)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { ok?: boolean; worldbuilding?: WorldbuildingData | null };
  return body.ok && body.worldbuilding ? body.worldbuilding : null;
}
