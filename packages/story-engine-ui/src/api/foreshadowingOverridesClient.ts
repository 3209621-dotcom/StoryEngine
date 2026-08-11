/**
 * 读项目的伏笔大小覆盖表（GET /api/foreshadowing-overrides）。
 * 由 set_foreshadowing_importance 工具落盘。
 * 文件不存在（从未覆盖过）或请求失败 → 返回 {}（不抛错）。
 *
 * 用法：
 *   const overrides = await fetchForeshadowingOverrides(projectPath);
 *   const shownSize = overrides[item.id] ?? item.size;  // 引擎派生 size 兜底
 */

export type ForeshadowingImportance = "major" | "minor";
export type ForeshadowingOverrides = Record<string, ForeshadowingImportance>;

export async function fetchForeshadowingOverrides(
  projectPath: string,
): Promise<ForeshadowingOverrides> {
  try {
    const res = await fetch(`/api/foreshadowing-overrides?project=${encodeURIComponent(projectPath)}`);
    if (!res.ok) return {};
    const body = (await res.json()) as { ok?: boolean; overrides?: ForeshadowingOverrides };
    return body.ok && body.overrides ? body.overrides : {};
  } catch {
    return {};
  }
}
