/**
 * 读项目的角色矩阵做厚结构（GET /api/matrix-enrichment）。由 generate_matrix_enrichment 工具落盘，
 * CharacterMatrixCodexPanel 据此填充叙事岗位（matrixOverrides，按 character.id）与关系账本厚字段
 * （relationshipExtras，按 relationshipKey）。还没做过厚 → 返回 null。
 *
 * 字段全 readonly optional，刻意对齐 CharacterMatrixCodexPanel 预留的两个可选厚 props，可直接透传。
 * 注意键：matrixOverrides 用 character.id；relationshipExtras 用 `${targetCharacterId||targetName}|${relationType}`。
 */

/** 角色总览的叙事岗位覆盖（一条），按 character.id 索引。 */
export interface MatrixOverride {
  /** 叙事岗位（创作功能位）。 */
  readonly narrativeRole?: string;
}

/** 关系账本厚字段（一条），按 relationshipKey 索引。 */
export interface RelationshipExtra {
  readonly pairWith?: string;
  readonly pairFrom?: string;
  readonly emotionalDebt?: string;
  readonly redline?: string;
  readonly nextTurn?: string;
}

export interface MatrixEnrichmentData {
  /** character.id → 叙事岗位覆盖。 */
  readonly matrixOverrides?: Readonly<Record<string, MatrixOverride>>;
  /** relationshipKey → 关系账本厚字段。 */
  readonly relationshipExtras?: Readonly<Record<string, RelationshipExtra>>;
  /** D·账本时效：本批做厚生成于第几章；面板与当前章比，远超则提示「可能已过期」。 */
  readonly generatedAtChapter?: number;
}

export async function fetchMatrixEnrichment(projectPath: string): Promise<MatrixEnrichmentData | null> {
  const res = await fetch(`/api/matrix-enrichment?project=${encodeURIComponent(projectPath)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { ok?: boolean; enrichment?: MatrixEnrichmentData | null };
  return body.ok && body.enrichment ? body.enrichment : null;
}
