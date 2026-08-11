/**
 * 读项目的地点做厚结构（GET /api/location-enrichment）。由 generate_location_enrichment 工具落盘，
 * LocationCodexPanel 据此填充表面印象 / 进入限制 / 离开代价 / 关联势力 / 状态标签。还没做过厚 → 返回 null。
 *
 * keying：服务端落盘成 byLocation:Record<地点名, 厚字段>（按地点名稳定生成）。面板 fetch 回这个 Record 后
 * 按 location.locations 的顺序映射成 LocationThickFields 数组，喂现有按下标对齐的渲染逻辑——既稳定按名字、
 * 又对上面板的数组下标。字段刻意对齐 LocationCodexPanel 的 LocationThickFields（全可选 readonly）。
 */

/** 单个地点的厚字段（对齐 LocationCodexPanel 的 LocationThickFields）。 */
export interface LocationThickFieldsData {
  readonly surfaceImpression?: string;
  readonly entryRestriction?: string;
  readonly exitCost?: string;
  readonly associatedForces?: string;
  readonly statusTag?: string;
  readonly statusTone?: "warn" | "danger" | "neutral";
}

export interface LocationEnrichmentData {
  /** 地点名 → 厚字段。面板按 location.locations 顺序映射成数组。 */
  readonly byLocation?: Readonly<Record<string, LocationThickFieldsData>>;
}

export async function fetchLocationEnrichment(projectPath: string): Promise<LocationEnrichmentData | null> {
  const res = await fetch(`/api/location-enrichment?project=${encodeURIComponent(projectPath)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { ok?: boolean; enrichment?: LocationEnrichmentData | null };
  return body.ok && body.enrichment ? body.enrichment : null;
}
