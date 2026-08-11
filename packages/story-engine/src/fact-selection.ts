/**
 * 按"本章仍有效 + 相关性"挑已确立事实喂正文，替代旧的 .slice(-20) 纯 recency 截断。
 * 根治长篇"早期硬设定被最近 N 条挤出蒸发"——早期事实只要仍有效、且与本章相关，就不会被挤掉。
 * 纯函数、确定性、题材中立：有效性只按章号机械判定（不读 text 语义）。
 * 相关性分级（洞#9 补齐）：在场角色名命中(4) > 本章方向 chapterGoal 文本重叠(2) > 含硬 token 数字/金额(1)，
 * 同级按近章。补 chapterGoal + 硬 token 后，不含人名的关键硬设定（遗产3亿/密道在城西）不再 relevance 恒 0 被挤出。
 */
import type { FactEntry } from "./types.js";

export interface EffectiveFactsInput {
  readonly facts: readonly FactEntry[];
  readonly chapter: number;
  /** 本章在场角色名（来自 selectedCharacterIds 对应角色）；提到的事实优先、不被 cap 挤出。 */
  readonly relevantNames?: readonly string[];
  /** 本章方向/目标文本；与之有 CJK 词重叠的事实（哪怕不含人名）优先，治"不含人名的硬设定蒸发"。 */
  readonly chapterGoal?: string;
  /** 进 prompt 的事实条数上限（避免长篇几百条全塞爆）。默认 20。 */
  readonly cap?: number;
}

export interface EffectiveFactsDiagnostics {
  readonly total: number;
  readonly valid: number;
  readonly superseded: number;
  readonly notYetEffective: number;
  readonly cappedOut: number;
}

export interface EffectiveFactsResult {
  /** 按重要性排序（相关性 → 近章）的事实串「第N章：text」；hardConstraints 取前 K 即取最重要的。 */
  readonly facts: readonly string[];
  readonly diagnostics: EffectiveFactsDiagnostics;
}

const DEFAULT_CAP = 20;

// 章目标里的结构性 2-gram（非内容词），不参与方向相关性匹配，避免"本章/继续"误命中一切。
const STRUCTURAL_GOAL_GRAMS = new Set(["本章", "这章", "这一", "一章", "下一", "继续", "章节", "推进"]);
// 硬 token：阿拉伯/全角数字 + 大额量词。强信号"金额/数字/编号"类硬事实，且极少出现在普通叙述词里。
const HARD_TOKEN_RE = /[0-9０-９]|[亿萬万]/u;

function effectiveFromChapter(fact: FactEntry): number {
  return typeof fact.effectiveFromChapter === "number" ? fact.effectiveFromChapter : fact.chapter;
}

/** 取连续 CJK 段内的 2-gram 集合（跨标点/数字不连），剔除结构性词。用于章目标的内容词相关性。 */
function cjkBigrams(text: string): Set<string> {
  const grams = new Set<string>();
  const runs = text.match(/[一-鿿㐀-䶿]+/gu) ?? [];
  for (const run of runs) {
    const chars = Array.from(run);
    for (let i = 0; i + 1 < chars.length; i += 1) {
      const gram = chars[i] + chars[i + 1];
      if (!STRUCTURAL_GOAL_GRAMS.has(gram)) grams.add(gram);
    }
  }
  return grams;
}

function sharesGoalGram(text: string, goalGrams: Set<string>): boolean {
  if (goalGrams.size === 0) return false;
  for (const gram of goalGrams) {
    if (text.includes(gram)) return true;
  }
  return false;
}

/** 事实在第 chapter 章是否仍有效（生效且未被取代）。无区间字段=从来源章起一直有效（向后兼容）。 */
export function isFactValidAtChapter(fact: FactEntry, chapter: number): boolean {
  if (chapter < effectiveFromChapter(fact)) return false;
  if (typeof fact.supersededByChapter === "number" && chapter >= fact.supersededByChapter) return false;
  return true;
}

export function selectEffectiveFacts(input: EffectiveFactsInput): EffectiveFactsResult {
  const cap = input.cap ?? DEFAULT_CAP;
  const relevantNames = (input.relevantNames ?? []).filter((name) => name.trim().length > 0);

  const nonEmpty = input.facts.filter(
    (fact) => fact && typeof fact.text === "string" && fact.text.trim().length > 0,
  );

  let superseded = 0;
  let notYetEffective = 0;
  const valid = nonEmpty.filter((fact) => {
    if (input.chapter < effectiveFromChapter(fact)) {
      notYetEffective += 1;
      return false;
    }
    if (typeof fact.supersededByChapter === "number" && input.chapter >= fact.supersededByChapter) {
      superseded += 1;
      return false;
    }
    return true;
  });

  const goalGrams = cjkBigrams(input.chapterGoal ?? "");
  const scored = valid
    .map((fact) => ({
      fact,
      // 分级：在场角色名(4) > 本章方向文本重叠(2) > 含硬 token 数字/金额(1)。
      score:
        (relevantNames.some((name) => fact.text.includes(name)) ? 4 : 0) +
        (sharesGoalGram(fact.text, goalGrams) ? 2 : 0) +
        (HARD_TOKEN_RE.test(fact.text) ? 1 : 0),
    }))
    // 相关性优先（早期但相关/重要的不被挤出），同级按近章优先
    .sort((a, b) => b.score - a.score || (b.fact.chapter ?? 0) - (a.fact.chapter ?? 0));

  const kept = scored.slice(0, cap);
  return {
    facts: kept.map((item) => `第${item.fact.chapter}章：${item.fact.text.trim()}`),
    diagnostics: {
      total: nonEmpty.length,
      valid: valid.length,
      superseded,
      notYetEffective,
      cappedOut: scored.length - kept.length,
    },
  };
}
