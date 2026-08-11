import { describe, it, expect } from "vitest";
import { bookCreationPromptText } from "./bookCreationPrompt.js";

describe("bookCreationPromptText", () => {
  it("是开书语气：引导说主角和世界，不是章节语气", () => {
    const t = bookCreationPromptText();
    expect(t).toContain("主角");
    expect(t).toContain("世界");
    expect(t).not.toContain("这章"); // 别用章节 idle 文案
  });
});
