export interface PostChapterChangePlan {
  readonly characterChanges: readonly ChangePlanItem[];
  readonly locationChanges: readonly ChangePlanItem[];
  readonly assetChanges: readonly ChangePlanItem[];
  readonly knowledgeChanges: readonly ChangePlanItem[];
  readonly relationshipChanges: readonly ChangePlanItem[];
}

export interface ChangePlanItem {
  readonly targetId: string;
  readonly changeType: string;
  readonly before?: string;
  readonly after: string;
  readonly evidence: string;
  readonly requiresUserConfirm: true;
}

export function buildPostChapterChangePlan(input: {
  readonly draftBody: string;
  readonly knownCharacterIds?: readonly string[];
  readonly knownLocationIds?: readonly string[];
  readonly knownAssetIds?: readonly string[];
}): PostChapterChangePlan {
  const body = input.draftBody;
  return {
    characterChanges: findEvidence(body, ["疲惫", "受伤", "紧张", "脱水"]).map((evidence) => change("protagonist", "character_state_observed", evidence)),
    locationChanges: (input.knownLocationIds ?? []).flatMap((id) => body.includes(id) ? [change(id, "location_state_observed", id)] : []),
    assetChanges: (input.knownAssetIds ?? []).flatMap((id) => body.includes(id) ? [change(id, "asset_state_observed", id)] : []),
    knowledgeChanges: findEvidence(body, ["知道", "意识到", "确认", "发现"]).map((evidence) => change("protagonist", "knowledge_observed", evidence)),
    relationshipChanges: findEvidence(body, ["相信", "怀疑", "敌意", "合作"]).map((evidence) => change("relationship", "relationship_observed", evidence)),
  };
}

function change(targetId: string, changeType: string, evidence: string): ChangePlanItem {
  return {
    targetId,
    changeType,
    after: "待用户确认后写入正式状态",
    evidence,
    requiresUserConfirm: true,
  };
}

function findEvidence(body: string, keywords: readonly string[]): readonly string[] {
  const sentences = body.split(/[。！？!?；;\n]/u).map((item) => item.trim()).filter(Boolean);
  return sentences.filter((sentence) => keywords.some((keyword) => sentence.includes(keyword))).slice(0, 6);
}
