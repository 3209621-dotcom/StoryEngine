import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./workspaceStore.js";
import type { ChapterMessage } from "../types.js";

const msgs: ChapterMessage[] = [
  { id: "u1", role: "user", content: "你好" },
  { id: "a1", role: "assistant", content: "在的" },
];

beforeEach(() => {
  useWorkspaceStore.getState().updateWorkspace({ messages: msgs });
  // 复位备份
  if (useWorkspaceStore.getState().clearedChatBackup) useWorkspaceStore.getState().undoClearChat();
});

describe("workspace clearChat / undoClearChat", () => {
  it("清空：messages 置空，并备份原对话以供撤销", () => {
    useWorkspaceStore.getState().clearChat();
    expect(useWorkspaceStore.getState().workspace.messages).toEqual([]);
    expect(useWorkspaceStore.getState().clearedChatBackup).toEqual(msgs);
  });

  it("撤销：恢复刚才清空的对话，备份清掉", () => {
    useWorkspaceStore.getState().clearChat();
    useWorkspaceStore.getState().undoClearChat();
    expect(useWorkspaceStore.getState().workspace.messages).toEqual(msgs);
    expect(useWorkspaceStore.getState().clearedChatBackup).toBeNull();
  });

  it("已经是空对话 → 清空是 no-op，不产生可撤销备份", () => {
    useWorkspaceStore.getState().updateWorkspace({ messages: [] });
    useWorkspaceStore.getState().clearChat();
    expect(useWorkspaceStore.getState().clearedChatBackup).toBeNull();
  });

  it("清空后继续对话（append）→ 撤销入口消失（备份清掉）", () => {
    useWorkspaceStore.getState().clearChat();
    expect(useWorkspaceStore.getState().clearedChatBackup).not.toBeNull();
    useWorkspaceStore.getState().appendMessage({ id: "u2", role: "user", content: "继续" });
    expect(useWorkspaceStore.getState().clearedChatBackup).toBeNull();
  });
});
