import type { ArcGoalsContext, StoryContinuityContext, StoryThreadsContext } from "./context-gateway.js";

export interface ContinuityQualityIssue {
  readonly severity: "info" | "warning" | "error";
  readonly type: string;
  readonly message: string;
}

export interface ContinuityQualityReport {
  readonly passed: boolean;
  readonly score: number;
  readonly issues: readonly ContinuityQualityIssue[];
  readonly matched: {
    readonly events: readonly string[];
    readonly leads: readonly string[];
    readonly locations: readonly string[];
    readonly characters: readonly string[];
    readonly conflicts: readonly string[];
    readonly discoveries: readonly string[];
  };
}

export interface CheckDraftContinuityInput {
  readonly draftContent: string;
  readonly continuity: StoryContinuityContext;
  readonly storyThreads?: StoryThreadsContext;
  readonly arcGoals?: ArcGoalsContext;
  readonly chapter: number;
}

const RESTART_PHRASES = [
  "多年以后",
  "初入组织",
  "第一次来到",
  "他从未想过",
  "故事开始",
  "这一日是他第一次",
];

const KEYWORD_HINTS = [
  "账房",
  "后墙",
  "异常响动",
  "黑影",
  "暗号",
  "账本",
  "信物",
  "禁区",
  "明日",
  "失踪",
  "封条",
  "园圃",
  "库房",
  "外院",
  "内院",
  "后院",
  "克扣",
  "威胁",
  "黑幕",
  "残页",
  "线索",
];

export function checkDraftContinuity(input: CheckDraftContinuityInput): ContinuityQualityReport {
  const continuity = input.continuity;
  const storyThreads = input.storyThreads;
  const arcGoals = input.arcGoals;
  if (isContinuityEmpty(continuity)
    && !hasOpenStoryThreads(storyThreads)
    && !hasActiveArcGoals(arcGoals)) {
    return {
      passed: true,
      score: 1,
      issues: [],
      matched: emptyMatched(),
    };
  }

  const draft = normalizeText(input.draftContent);
  const matchedThreadLeads = storyThreads ? matchByThreadTitles(draft, storyThreads.openLeads) : [];
  const matchedThreadIntents = storyThreads ? matchByThreadTitles(draft, storyThreads.openIntents) : [];
  const matchedArcGoals = arcGoals ? matchByArcGoalTitles(draft, arcGoals.activeGoals) : [];
  const matched = {
    events: matchRecentEvents(draft, continuity.recentEvents),
    leads: unique([...matchByKeywords(draft, continuity.openLeads), ...matchedThreadLeads]),
    locations: matchByLiteral(draft, continuity.recentLocations),
    characters: matchByLiteral(draft, continuity.recentCharacters),
    conflicts: matchByKeywords(draft, continuity.activeConflicts),
    discoveries: matchByKeywords(draft, continuity.discoveries),
  };
  const issues: ContinuityQualityIssue[] = [];

  if (continuity.recentCharacters.length > 0 && matched.characters.length === 0) {
    issues.push({
      severity: "warning",
      type: "recent_characters_not_referenced",
      message: "Draft does not mention any recent continuity character.",
    });
  }
  if (continuity.recentLocations.length > 0 && matched.locations.length === 0) {
    issues.push({
      severity: "warning",
      type: "recent_locations_not_referenced",
      message: "Draft does not mention any recent continuity location.",
    });
  }
  if (continuity.openLeads.length > 0 && matched.leads.length === 0) {
    issues.push({
      severity: "warning",
      type: "open_leads_not_referenced",
      message: "Draft does not appear to continue any open continuity lead.",
    });
  }
  if (storyThreads !== undefined) {
    if (storyThreads.openLeads.length > 0 && matchedThreadLeads.length === 0) {
      issues.push({
        severity: "warning",
        type: "open_threads_not_referenced",
        message: "Draft does not appear to reference any open story lead thread.",
      });
    }
    if (storyThreads.openIntents.length > 0 && matchedThreadIntents.length === 0) {
      issues.push({
        severity: "warning",
        type: "open_intents_not_referenced",
        message: "Draft does not appear to reference any open character intent thread.",
      });
    }
  }
  if (arcGoals !== undefined && arcGoals.activeGoals.length > 0 && matchedArcGoals.length === 0) {
    issues.push({
      severity: "warning",
      type: "arc_goals_not_referenced",
      message: "Draft does not appear to reference any active arc goal.",
    });
  }
  if (hasRepeatedParagraphRisk(input.draftContent)) {
    issues.push({
      severity: "warning",
      type: "possible_repeated_paragraph",
      message: "Draft contains repeated sentences or highly similar adjacent paragraphs.",
    });
  }
  if (hasHomogeneousLoopRepetition(input.draftContent)) {
    issues.push({
      severity: "warning",
      type: "possible_homogeneous_loop_repetition",
      message: "Draft appears to cycle the same cluster of actions across paragraphs without introducing new content.",
    });
  }
  if (continuity.recentEvents.length > 0 && matched.events.length === 0) {
    issues.push({
      severity: "warning",
      type: "recent_events_not_referenced",
      message: "Draft does not lightly reference recent story events.",
    });
  }
  if (looksLikeRestart(draft)
    && matched.leads.length === 0
    && matched.locations.length === 0
    && matched.characters.length === 0) {
    issues.push({
      severity: "warning",
      type: "possible_restart",
      message: `Chapter ${input.chapter} may be restarting instead of continuing recent context.`,
    });
  }

  const score = calculateScore(
    continuity,
    matched,
    storyThreads,
    matchedThreadLeads,
    matchedThreadIntents,
    arcGoals,
    matchedArcGoals,
  );
  return {
    passed: !issues.some((issue) => issue.severity === "error"),
    score,
    issues,
    matched,
  };
}

function matchByThreadTitles(
  draft: string,
  threads: StoryThreadsContext["openLeads"] | StoryThreadsContext["openIntents"],
): readonly string[] {
  return threads
    .filter((thread) => {
      const referenceText = joinReferenceText([thread.title, thread.nextActionHint, ...thread.evidence]);
      if (requiresReferenceCalibration(referenceText)) return matchesCalibratedReference(draft, referenceText);
      const keywords = keywordsFor(thread.title);
      return keywords.some((keyword) => draft.includes(keyword));
    })
    .map((thread) => thread.title);
}

function matchByArcGoalTitles(
  draft: string,
  goals: ArcGoalsContext["activeGoals"],
): readonly string[] {
  return goals
    .filter((goal) => {
      const referenceText = joinReferenceText([goal.title, goal.nextActionHint, ...goal.evidence]);
      if (requiresReferenceCalibration(referenceText)) return matchesCalibratedReference(draft, referenceText);
      const keywords = [...keywordsFor(goal.title), ...goal.evidence.flatMap(keywordsFor)];
      return keywords.some((keyword) => draft.includes(keyword));
    })
    .map((goal) => goal.title);
}

function matchRecentEvents(draft: string, values: readonly string[]): readonly string[] {
  return values.filter((value) => (
    matchByKeywords(draft, [value]).length > 0 || matchesRecentEventProgress(draft, value)
  ));
}

function joinReferenceText(values: readonly (string | undefined)[]): string {
  return values.filter((value): value is string => value !== undefined).join(" ");
}

function requiresReferenceCalibration(referenceText: string): boolean {
  return /水源|水箱|取水|饮用水|药店|药品|绷带|抗生素|急救|地下车库|车库通道|安全路线|搜索地下车库/u.test(referenceText);
}

function matchesCalibratedReference(draft: string, referenceText: string): boolean {
  if (referencesWaterObjective(referenceText) && draftAdvancesWaterObjective(draft)) return true;
  if (referencesMedicineObjective(referenceText) && draftAdvancesMedicineObjective(draft)) return true;
  if (referencesGarageObjective(referenceText) && draftAdvancesGarageObjective(draft)) return true;
  return false;
}

function referencesWaterObjective(referenceText: string): boolean {
  return /水源|水箱|取水|饮用水|稳定水源/u.test(referenceText);
}

function draftAdvancesWaterObjective(draft: string): boolean {
  if (/没有(?:出门|检查水箱|取水|接水)|没(?:有)?检查水箱/u.test(draft)) return false;
  return /(?:找水|取水|接水|储水|检查水箱|确认水源|水箱里还有水|水箱.{0,12}(?:还有水|接水|取水|检查|阀门|水流|存水)|(?:水流|阀门).{0,12}水箱)/u.test(draft);
}

function referencesMedicineObjective(referenceText: string): boolean {
  return /药店|药品|绷带|抗生素|急救/u.test(referenceText);
}

function draftAdvancesMedicineObjective(draft: string): boolean {
  if (/药店.{0,12}(?:招牌|背景)|没有(?:过去|去药店)|没去药店/u.test(draft)) return false;
  return /(?:去|进|进入|前往|搜索|搜|确认|检查).{0,12}药店/u.test(draft)
    || /(?:弄到|拿到|获取|带回|找到|找).{0,12}(?:药品|绷带|抗生素|急救包)/u.test(draft)
    || /药店.{0,24}(?:药品|绷带|抗生素|急救包|剩什么|被搜|没锁|卷帘门)/u.test(draft);
}

function referencesGarageObjective(referenceText: string): boolean {
  return /地下车库|车库通道|安全路线|搜索地下车库/u.test(referenceText);
}

function draftAdvancesGarageObjective(draft: string): boolean {
  if (/地下车库.{0,18}(?:入口|在楼下).{0,18}(?:没有下去|没下去|只在门口)|没有(?:进入|搜索|下到)地下车库/u.test(draft)) return false;
  return /(?:进入|走进|踏进|下到|搜索|探索|调查).{0,12}地下车库/u.test(draft)
    || /地下车库.{0,24}(?:通道|出口|安全路线|水箱|深处|响动|调查|搜索|脚印|储藏室)/u.test(draft)
    || /车库深处.{0,16}(?:响动|声音|拖行声)/u.test(draft);
}

function matchesRecentEventProgress(draft: string, eventText: string): boolean {
  if (referencesDoorThreat(eventText) && draftAdvancesDoorThreat(draft)) return true;
  if (referencesCorpseStainClue(eventText) && draftAdvancesCorpseStainClue(draft)) return true;
  return false;
}

function referencesDoorThreat(eventText: string): boolean {
  return /门外|脚步声|楼道|刮墙|指甲|危机/u.test(eventText);
}

function draftAdvancesDoorThreat(draft: string): boolean {
  return /(?:脚步声|门外|楼道|指甲|刮墙).{0,24}(?:没有继续|没有离开|传来|响起|刮过|停在门口|走廊尽头|危机)/u.test(draft);
}

function referencesCorpseStainClue(eventText: string): boolean {
  return /尸体|污渍|血迹|拖过|拖行|受伤/u.test(eventText);
}

function draftAdvancesCorpseStainClue(draft: string): boolean {
  if (/(?:想起|回忆).{0,12}(?:尸体|血迹|污渍).{0,24}(?:念头压下|发呆|不再想|没再管)/u.test(draft)) return false;
  const hasClueObject = /尸体|污渍|血迹|暗色|拖行|拖过/u.test(draft);
  const hasProgress = /车库深处.{0,16}(?:响动|声音|拖行声)|(?:继续|开始|决定).{0,12}(?:调查|查看|搜索)|(?:推开|进入|走进).{0,12}(?:门|地下车库|车库)|(?:发现|看见).{0,16}(?:新|又|痕迹|脚印|尸体|污渍)/u.test(draft);
  return hasClueObject && hasProgress;
}

function isContinuityEmpty(continuity: StoryContinuityContext): boolean {
  return continuity.recentEvents.length === 0
    && continuity.openLeads.length === 0
    && continuity.activeConflicts.length === 0
    && continuity.discoveries.length === 0
    && continuity.recentLocations.length === 0
    && continuity.recentCharacters.length === 0;
}

function hasOpenStoryThreads(storyThreads: StoryThreadsContext | undefined): boolean {
  return storyThreads !== undefined
    && (storyThreads.openLeads.length > 0 || storyThreads.openIntents.length > 0);
}

function hasActiveArcGoals(arcGoals: ArcGoalsContext | undefined): boolean {
  return arcGoals !== undefined && arcGoals.activeGoals.length > 0;
}

function matchByLiteral(draft: string, values: readonly string[]): readonly string[] {
  return values.filter((value) => {
    const candidates = literalCandidates(value);
    return candidates.some((candidate) => draft.includes(candidate));
  });
}

function literalCandidates(value: string): readonly string[] {
  return unique([value, ...value.split(/[\/／|｜,，、]/u)]
    .map((part) => normalizeText(part))
    .filter((part) => part.length > 0));
}

function matchByKeywords(draft: string, values: readonly string[]): readonly string[] {
  return values.filter((value) => {
    const keywords = keywordsFor(value);
    return keywords.some((keyword) => draft.includes(keyword));
  });
}

function keywordsFor(value: string): readonly string[] {
  const normalized = normalizeText(value);
  const hinted = KEYWORD_HINTS.filter((keyword) => normalized.includes(keyword));
  const clauses = normalized
    .split(/[，。！？!?；;、\s]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 12);
  return unique([...hinted, ...clauses]);
}

function calculateScore(
  continuity: StoryContinuityContext,
  matched: ContinuityQualityReport["matched"],
  storyThreads: StoryThreadsContext | undefined,
  matchedThreadLeads: readonly string[],
  matchedThreadIntents: readonly string[],
  arcGoals: ArcGoalsContext | undefined,
  matchedArcGoals: readonly string[],
): number {
  const checks = [
    ...(continuity.recentEvents.length > 0 ? [matched.events.length > 0] : []),
    ...(continuity.openLeads.length > 0 ? [matched.leads.length > 0] : []),
    ...(continuity.recentLocations.length > 0 ? [matched.locations.length > 0] : []),
    ...(continuity.recentCharacters.length > 0 ? [matched.characters.length > 0] : []),
    ...(continuity.activeConflicts.length > 0 ? [matched.conflicts.length > 0] : []),
    ...(continuity.discoveries.length > 0 ? [matched.discoveries.length > 0] : []),
    ...(storyThreads && storyThreads.openLeads.length > 0 ? [matchedThreadLeads.length > 0] : []),
    ...(storyThreads && storyThreads.openIntents.length > 0 ? [matchedThreadIntents.length > 0] : []),
    ...(arcGoals && arcGoals.activeGoals.length > 0 ? [matchedArcGoals.length > 0] : []),
  ];
  if (checks.length === 0) return 1;
  return Number((checks.filter(Boolean).length / checks.length).toFixed(2));
}

function looksLikeRestart(draft: string): boolean {
  return RESTART_PHRASES.some((phrase) => draft.includes(phrase));
}

function hasRepeatedParagraphRisk(content: string): boolean {
  const sentences = content
    .split(/(?<=[。！？!?；;])|\n+/u)
    .map((sentence) => normalizeText(sentence))
    .filter((sentence) => sentence.length >= 10);
  for (let index = 1; index < sentences.length; index += 1) {
    if (sentences[index] === sentences[index - 1]) return true;
  }
  const paragraphs = content
    .split(/\n{2,}/u)
    .map((paragraph) => normalizeText(paragraph))
    .filter((paragraph) => paragraph.length >= 18);
  for (let index = 1; index < paragraphs.length; index += 1) {
    if (jaccardSimilarity(keywordsFor(paragraphs[index]!), keywordsFor(paragraphs[index - 1]!)) >= 0.82) return true;
  }
  return false;
}

// Genre-neutral homogeneous-loop detector: flags a draft that keeps cycling the
// same small cluster of actions/objects across several paragraphs without
// introducing new narrative content. Works purely from paragraph keyword overlap,
// so it does not depend on any specific genre vocabulary.
function hasHomogeneousLoopRepetition(content: string): boolean {
  const paragraphs = content
    .split(/\n{2,}/u)
    .map((paragraph) => normalizeText(paragraph))
    .filter((paragraph) => paragraph.length >= 12);
  if (paragraphs.length < 2) return false;
  let similarPairs = 0;
  for (let index = 1; index < paragraphs.length; index += 1) {
    if (jaccardSimilarity(keywordsFor(paragraphs[index]!), keywordsFor(paragraphs[index - 1]!)) >= 0.6) {
      similarPairs += 1;
    }
  }
  // A single near-duplicate adjacent pair already signals the same homogeneous
  // loop; more pairs strengthen the signal.
  return similarPairs >= 1;
}

function jaccardSimilarity(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let overlap = 0;
  for (const keyword of leftSet) {
    if (rightSet.has(keyword)) overlap += 1;
  }
  return overlap / new Set([...leftSet, ...rightSet]).size;
}

function emptyMatched(): ContinuityQualityReport["matched"] {
  return {
    events: [],
    leads: [],
    locations: [],
    characters: [],
    conflicts: [],
    discoveries: [],
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, "");
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter(Boolean))];
}
