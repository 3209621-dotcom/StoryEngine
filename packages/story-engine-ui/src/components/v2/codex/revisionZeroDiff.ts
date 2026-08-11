/**
 * 修订预览零差异判定（P0-3）——前后 trim 相等即视为无需修改。
 */
export function isRevisionZeroDiff(beforeText: string, afterText: string): boolean {
  return `${beforeText}`.trim() === `${afterText}`.trim();
}
