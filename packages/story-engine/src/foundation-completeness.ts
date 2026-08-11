import {
  readAssetLedger,
  readCharacterBible,
  readLocationBible,
  readStoryBible,
  readWorldBible,
  readWritingRules,
} from "./project-store.js";

export interface FoundationCompletenessReport {
  readonly passed: boolean;
  readonly readinessLevel: "ready" | "warning" | "high_risk";
  readonly missingItems: readonly string[];
  readonly suggestions: readonly string[];
}

export async function checkFoundationCompleteness(projectDir: string): Promise<FoundationCompletenessReport> {
  const [storyBible, writingRules, characterBible, worldBible, locationBible, assetLedger] = await Promise.all([
    readStoryBible(projectDir),
    readWritingRules(projectDir),
    readCharacterBible(projectDir),
    readWorldBible(projectDir),
    readLocationBible(projectDir),
    readAssetLedger(projectDir),
  ]);
  const missing: string[] = [];
  const protagonist = characterBible?.characters.find((character) => character.role === "主角" || character.role === "protagonist")
    ?? characterBible?.characters[0];
  const initialLocation = locationBible?.locations[0];

  if (!protagonist?.age) missing.push("主角年龄");
  if (!protagonist?.identity && !protagonist?.role) missing.push("主角身份");
  if (!protagonist?.desire && !protagonist?.longTermDesire) missing.push("主角目标");
  if ((protagonist?.behaviorBoundaries ?? []).length === 0) missing.push("主角边界");
  if (!protagonist?.speechStyle && (protagonist?.speechSamples ?? []).length === 0) missing.push("主角说话风格样本");
  if ((protagonist?.knowledgeKnown ?? []).length === 0 || (protagonist?.knowledgeUnknown ?? []).length === 0) missing.push("主角知道/不知道");
  if (!initialLocation?.spatialStructure || ((initialLocation.spatialStructure.floors ?? []).length === 0 && (initialLocation.spatialStructure.rooms ?? []).length === 0)) missing.push("初始地点空间结构");
  if ((initialLocation?.travelRules ?? []).length === 0) missing.push("初始地点移动规则");
  if (assetLedger.assets.length === 0) missing.push("资产账本");
  if ((storyBible?.protectedSecrets ?? []).length === 0 && (storyBible?.coreMysteries ?? []).length === 0) missing.push("禁止提前揭开");
  if (!storyBible?.firstChapterSetup?.goal) missing.push("第一章方向");
  if (!writingRules?.narrativePerspective || writingRules.proseStyle.length === 0) missing.push("写作规则");
  if ((worldBible?.rules ?? []).length === 0 || (storyBible?.centralConflicts ?? []).length === 0) missing.push("世界核心规则和冲突来源");

  const readinessLevel = missing.length === 0 ? "ready" : missing.length <= 3 ? "warning" : "high_risk";
  return {
    passed: missing.length === 0,
    readinessLevel,
    missingItems: missing,
    suggestions: missing.map((item) => `建议补充：${item}`),
  };
}
