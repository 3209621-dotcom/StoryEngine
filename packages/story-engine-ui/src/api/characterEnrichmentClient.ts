/**
 * 读项目的角色做厚结构（GET /api/character-enrichment）。由 generate_character_enrichment 工具落盘，
 * CharacterCodexPanel 据此填充三层人格 / 成长弧 / 情绪外露 / 日常锚点。还没做过厚 → 返回 null。
 *
 * byCharacter 按角色名索引，字段全 readonly optional，刻意对齐 CharacterCodexPanel 的
 * enrichment?: Readonly<Record<string, CharacterCodexEnrichment>>，可直接透传到 enrichment ?? fetched?.byCharacter。
 */

export interface CharacterEnrichmentEntryData {
  /** 内核人格（layer3.core）。 */
  readonly core?: string;
  /** 表层气质（layer3.surf）。 */
  readonly surface?: string;
  /** 社交伪装（layer3.mask）。 */
  readonly mask?: string;
  /** 内部缺失（drive3）。 */
  readonly innerLack?: string;
  /** 情绪外露（.voice）。 */
  readonly emotionalExposure?: string;
  /** 日常锚点（.char-row「日常锚点」）。 */
  readonly dailyAnchors?: readonly string[];
  /** 成长弧三步。 */
  readonly arcStart?: string;
  readonly arcSetback?: string;
  readonly arcCost?: string;
}

export interface CharacterEnrichmentData {
  /** 角色名 → 该角色的厚字段。 */
  readonly byCharacter?: Readonly<Record<string, CharacterEnrichmentEntryData>>;
}

export async function fetchCharacterEnrichment(projectPath: string): Promise<CharacterEnrichmentData | null> {
  const res = await fetch(`/api/character-enrichment?project=${encodeURIComponent(projectPath)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { ok?: boolean; enrichment?: CharacterEnrichmentData | null };
  return body.ok && body.enrichment ? body.enrichment : null;
}
