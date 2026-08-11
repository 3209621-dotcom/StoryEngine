import { describe, expect, it } from "vitest";
import { IME_CONFIRM_GUARD_MS, shouldSendOnEnterKey, type EnterKeyDecisionInput } from "./imeEnterGuard.js";

function input(overrides: Partial<EnterKeyDecisionInput> = {}): EnterKeyDecisionInput {
  return {
    key: "Enter",
    shiftKey: false,
    isComposing: false,
    keyCode: 13,
    composing: false,
    msSinceCompositionEnd: Number.POSITIVE_INFINITY,
    ...overrides,
  };
}

describe("shouldSendOnEnterKey", () => {
  it("普通回车（无合成）→ 发送", () => {
    expect(shouldSendOnEnterKey(input())).toBe(true);
  });

  it("非 Enter 键 → 不发送", () => {
    expect(shouldSendOnEnterKey(input({ key: "a" }))).toBe(false);
  });

  it("Shift+Enter（换行）→ 不发送", () => {
    expect(shouldSendOnEnterKey(input({ shiftKey: true }))).toBe(false);
  });

  it("合成进行中 isComposing=true → 不发送", () => {
    expect(shouldSendOnEnterKey(input({ isComposing: true }))).toBe(false);
  });

  it("IME 处理键 keyCode=229 → 不发送（真实 Chrome 合成期 keydown 多为 229）", () => {
    expect(shouldSendOnEnterKey(input({ keyCode: 229 }))).toBe(false);
  });

  it("composing ref 为真（合成中兜底）→ 不发送", () => {
    expect(shouldSendOnEnterKey(input({ composing: true }))).toBe(false);
  });

  it("紧跟 compositionend 的『确认回车』(窗口内) → 不发送（治泄漏：isComposing 已 false 也挡）", () => {
    expect(shouldSendOnEnterKey(input({ msSinceCompositionEnd: 5 }))).toBe(false);
    expect(shouldSendOnEnterKey(input({ msSinceCompositionEnd: IME_CONFIRM_GUARD_MS - 1 }))).toBe(false);
  });

  it("合成结束后用户随后真正按的发送回车（已过窗口）→ 发送", () => {
    expect(shouldSendOnEnterKey(input({ msSinceCompositionEnd: 200 }))).toBe(true);
  });
});
