/**
 * 桌面 server 端口持久化：纯解析，无 electron 依赖（可 node -e 演练）。
 *
 * why：localStorage 按 origin（host:port）隔离，端口漂移=书架/主题等前端持久化全清零；
 * 固定端口换取跨重启的 origin 稳定。仍仅回环 + request-guard 把关，可发现性提升可接受。
 */

/**
 * 解析 server-port.json 原始内容，返回合法端口或 null。
 * 合法：1024–65535 的整数。
 */
export function readStoredPort(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    const port = parsed?.port;
    if (typeof port !== "number" || !Number.isInteger(port)) return null;
    if (port < 1024 || port > 65535) return null;
    return port;
  } catch {
    return null;
  }
}
