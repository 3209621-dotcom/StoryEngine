import { describe, expect, it } from "vitest";
import { lastAssistantNextStepPrompt } from "./nextStepChoices.js";
import type { ChapterMessage } from "../../../types.js";

function msg(partial: Partial<ChapterMessage> & Pick<ChapterMessage, "id" | "role">): ChapterMessage {
  return { content: "", ...partial } as ChapterMessage;
}

describe("lastAssistantNextStepPrompt（下一步选项卡只来自 agent 提议）", () => {
  it("取最近 assistant 消息的提议，recommended→primary", () => {
    const messages = [
      msg({ id: "u1", role: "user" }),
      msg({ id: "a1", role: "assistant", nextStepPrompt: {
        question: "这章入库了，接下来？",
        choices: [
          { label: "先补地点和资产", intent: "帮我把地点和资产补上", recommended: true },
          { label: "开始写第二章", intent: "开始写第二章" },
        ],
      } }),
    ];
    const p = lastAssistantNextStepPrompt(messages);
    expect(p?.question).toBe("这章入库了，接下来？");
    expect(p?.choices[0]).toEqual({ label: "先补地点和资产", intent: "帮我把地点和资产补上", primary: true });
    expect(p?.choices[1]).toEqual({ label: "开始写第二章", intent: "开始写第二章" });
  });

  it("最近 assistant 消息没提议 → null（不出选项卡，不翻更老的消息）", () => {
    const messages = [
      msg({ id: "a0", role: "assistant", nextStepPrompt: { question: "旧的", choices: [{ label: "x", intent: "x" }] } }),
      msg({ id: "u1", role: "user" }),
      msg({ id: "a1", role: "assistant", content: "好的。" }), // 最近一条无提议
    ];
    expect(lastAssistantNextStepPrompt(messages)).toBeNull();
  });

  it("没有 assistant 消息 → null", () => {
    expect(lastAssistantNextStepPrompt([msg({ id: "u1", role: "user" })])).toBeNull();
    expect(lastAssistantNextStepPrompt([])).toBeNull();
  });
});
