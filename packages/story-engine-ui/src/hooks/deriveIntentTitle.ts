/**
 * 把用户原话压成一行「意图标题」，用作 AI 动作块块头第一行。
 * 取首行、裁到 24 字，超出加省略号；空串回退 "AI 交互"。
 */
export function deriveIntentTitle(userText: string): string {
  const firstLine = userText.trim().split("\n")[0]?.trim() ?? "";
  if (!firstLine) return "AI 交互";
  return firstLine.length > 24 ? `${firstLine.slice(0, 24)}…` : firstLine;
}
