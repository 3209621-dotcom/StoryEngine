import type { StateOverviewWorldBibleSummary } from "./types.js";
import type { WorldbuildingData } from "./worldbuildingClient.js";
import { filterSystemStoryMeta } from "../shared/sparse-panel-honesty.js";

/**
 * worldbuildingFromWorldBible —— 引擎正典世界观 summary → 面板 WorldbuildingData 的兜底映射。
 * 仅当加厚层（.story-engine-ui/worldbuilding.json）为空时被 WorldbuildingCodexPanel 当 fallbackData 用，
 * 让"用户聊天提交进 world-bible.json 的世界观"在没跑过 generate_worldbuilding 时也能在面板显示。
 * 引擎 summary 无的厚字段（worldRules/factions/specialElements/storyBinding/relations/storyEntries/locations）
 * 一律留空，由面板现有 has()/length>0 守卫自动隐藏——绝不造假。
 * 系统元话术（如「正式事实只能通过确认提交更新」）在此过滤，老书不迁移也干净。
 */
export function worldbuildingFromWorldBible(
  s?: StateOverviewWorldBibleSummary,
): WorldbuildingData | null {
  if (!s?.available) return null;

  const keyRules = filterSystemStoryMeta(s.keyRules ?? []);
  const fixedFacts = filterSystemStoryMeta(s.fixedFacts ?? []);
  const socialOrder = filterSystemStoryMeta(s.socialOrder ?? []);
  const keyFactions = (s.keyFactions ?? []).filter((v) => typeof v === "string" && v.trim());
  const conflictSources = filterSystemStoryMeta(s.conflictSources ?? []);
  const forbiddenRuleBreaks = filterSystemStoryMeta(s.forbiddenRuleBreaks ?? []);

  const empty =
    keyRules.length === 0 &&
    socialOrder.length === 0 &&
    keyFactions.length === 0 &&
    conflictSources.length === 0 &&
    fixedFacts.length === 0;
  if (empty) return null;

  const rules = [
    ...keyRules.map((r, i) => ({ name: `规则 ${i + 1}`, detail: r })),
    ...fixedFacts.map((f) => ({ name: "固定事实", detail: f })),
  ];

  return {
    overview: {
      oneLine: keyRules[0] ?? fixedFacts[0] ?? "（来自引擎正典的世界观）",
      tone: "",
      coreConflict: conflictSources[0] ?? "",
    },
    rules,
    socialStructure: socialOrder,
    ...(s.extraFields ? { extraFields: s.extraFields } : {}),
    forces: keyFactions.map((name) => ({
      name,
      type: "",
      resources: "",
      objective: "",
      pressure: "",
    })),
    conflictSources: [...conflictSources, ...forbiddenRuleBreaks],
    relations: [],
    storyEntries: [],
    locations: [],
  };
}
