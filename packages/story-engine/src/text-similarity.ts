/**
 * 中文文本 bigram 相似度工具——供线索去重 (B2-2) 与 overview 聚类 (B2-3) 复用。
 * 纯函数、确定性、题材中立、不调 LLM。
 */

/**
 * 从文本中提取 CJK 连续字符段的所有相邻二元组（bigrams）。
 * 返回 Set<string>，每个元素是两个汉字组成的字符串。
 */
export function cjkBigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (const run of text.match(/[一-鿿㐀-䶿]+/gu) ?? []) {
    const chars = Array.from(run);
    for (let i = 0; i + 1 < chars.length; i += 1) {
      grams.add(chars[i] + chars[i + 1]);
    }
  }
  return grams;
}

/**
 * Jaccard 相似度：|A ∩ B| / |A ∪ B|。
 * 任意一方 bigram 集为空时返回 0（防除零）。
 */
export function bigramSimilarity(a: string, b: string): number {
  const ga = cjkBigrams(a);
  const gb = cjkBigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;

  let intersection = 0;
  for (const g of ga) {
    if (gb.has(g)) intersection += 1;
  }
  const union = ga.size + gb.size - intersection;
  return intersection / union;
}

