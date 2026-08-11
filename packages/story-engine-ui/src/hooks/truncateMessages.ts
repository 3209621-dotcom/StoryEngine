import type { ChapterMessage } from "../types.js";

/**
 * 块级「撤销到此」的对话截断：返回去掉 `messageId` 及其之后所有消息的新数组。
 * 找不到 id 时原样返回拷贝（防御：不误删整段历史）。纯函数、无副作用。
 */
export function truncateMessagesFrom(
  messages: readonly ChapterMessage[],
  messageId: string,
): ChapterMessage[] {
  const idx = messages.findIndex((m) => m.id === messageId);
  return idx < 0 ? [...messages] : messages.slice(0, idx);
}

/**
 * 撤销某 AI 回合时，决定从哪条消息开始截断：若紧邻该回合之前是用户提问，则连那条用户提问
 * 一起去掉（回到「没问过」的干净态，不留「你问了、AI 没回」的孤儿用户气泡）；否则从该回合本身起。
 * 纯函数。配合 truncateMessagesFrom 使用：`truncateMessagesFrom(msgs, undoCutId(msgs, 回合id))`。
 */
export function undoCutId(
  messages: readonly ChapterMessage[],
  assistantMessageId: string,
): string {
  const idx = messages.findIndex((m) => m.id === assistantMessageId);
  if (idx > 0 && messages[idx - 1]?.role === "user") return messages[idx - 1]!.id;
  return assistantMessageId;
}
