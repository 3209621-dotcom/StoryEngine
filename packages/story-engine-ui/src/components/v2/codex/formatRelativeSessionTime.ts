/**
 * P2-18：历史会话相对时间（纯函数）。
 */
export function formatRelativeSessionTime(
  iso: string | undefined,
  nowMs: number = Date.now(),
): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.max(0, Math.round((nowMs - then) / 1000));
  if (diffSec < 60) return "刚刚";
  const mins = Math.round(diffSec / 60);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(then).toLocaleDateString("zh-CN");
}
