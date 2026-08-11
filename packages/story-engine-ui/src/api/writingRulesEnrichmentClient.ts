/**
 * 读项目的写作规则做厚结构（GET /api/writing-rules-enrichment）。由 generate_writing_rules_enrichment
 * 工具落盘，WritingRulesCodexPanel 据此填充风格特征指纹（fingerprints）与反 AI 写作规则（antiRules）。
 * 还没做过厚 → 返回 null。
 *
 * 字段全 readonly optional，刻意对齐 WritingRulesCodexPanel 预留的两个可选厚 props
 * （fingerprints / antiRules），可直接透传。
 */

/** 风格特征指纹条（本书风格可识别度，value 0–100）。 */
export interface StyleFingerprintData {
  readonly label: string;
  readonly value: number;
}

/** 反 AI 写作规则（审稿检查项）。 */
export interface AntiAiRuleData {
  readonly name: string;
  readonly desc: string;
  readonly type: "forbidden" | "risk" | "encourage";
  readonly severity: "high" | "medium" | "low";
}

export interface WritingRulesEnrichmentData {
  /** 风格特征指纹（书级数组）。 */
  readonly fingerprints?: readonly StyleFingerprintData[];
  /** 反 AI 写作规则（书级数组）。 */
  readonly antiRules?: readonly AntiAiRuleData[];
}

export async function fetchWritingRulesEnrichment(projectPath: string): Promise<WritingRulesEnrichmentData | null> {
  const res = await fetch(`/api/writing-rules-enrichment?project=${encodeURIComponent(projectPath)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { ok?: boolean; enrichment?: WritingRulesEnrichmentData | null };
  return body.ok && body.enrichment ? body.enrichment : null;
}
