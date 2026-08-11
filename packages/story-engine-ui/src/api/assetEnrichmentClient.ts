/**
 * 读项目的资产做厚结构（GET /api/asset-enrichment）。由 generate_asset_enrichment 工具落盘，
 * AssetCodexPanel 据此填充读者可见性 / 知情边界、持有人画像、连续性风险。还没做过厚 → 返回 null。
 *
 * 字段全 readonly optional，刻意对齐 AssetCodexPanel 预留的三个可选厚 props
 * （assetVisibility / ownerDescriptions / continuityRisks），可直接 spread/透传。
 */

export interface AssetEnrichmentData {
  /** 资产名 → 读者可见性 / 知情边界文案（如「读者可见」「仅主角知」「主角+某配角知」）。 */
  readonly assetVisibility?: Readonly<Record<string, string>>;
  /** 持有人名 → 一句话画像。 */
  readonly ownerDescriptions?: Readonly<Record<string, string>>;
  /** 连续性风险提示（写作前必看）。 */
  readonly continuityRisks?: readonly { readonly label?: string; readonly detail: string }[];
}

export async function fetchAssetEnrichment(projectPath: string): Promise<AssetEnrichmentData | null> {
  const res = await fetch(`/api/asset-enrichment?project=${encodeURIComponent(projectPath)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { ok?: boolean; enrichment?: AssetEnrichmentData | null };
  return body.ok && body.enrichment ? body.enrichment : null;
}
