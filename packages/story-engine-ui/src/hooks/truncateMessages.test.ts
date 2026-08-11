import { describe, it, expect } from "vitest";
import { truncateMessagesFrom, undoCutId } from "./truncateMessages.js";

const M = (id: string) => ({ id, role: "assistant" as const, content: "" });
const R = (id: string, role: "user" | "assistant" | "system") => ({ id, role, content: "" });

describe("truncateMessagesFrom", () => {
  it("去掉目标及其后，保留之前", () => {
    expect(truncateMessagesFrom([M("a"), M("b"), M("c")], "b").map((m) => m.id)).toEqual(["a"]);
  });
  it("找不到 id → 原样返回拷贝", () => {
    expect(truncateMessagesFrom([M("a")], "x").map((m) => m.id)).toEqual(["a"]);
  });
  it("返回的是新数组，不改原数组", () => {
    const original = [M("a"), M("b")];
    const result = truncateMessagesFrom(original, "b");
    expect(result).not.toBe(original);
    expect(original.map((m) => m.id)).toEqual(["a", "b"]);
  });
  it("目标是首条 → 全部去掉", () => {
    expect(truncateMessagesFrom([M("a"), M("b")], "a")).toEqual([]);
  });
});

describe("undoCutId", () => {
  it("回合前是用户提问 → 连用户提问一起截掉（不留孤儿用户气泡）", () => {
    const msgs = [R("u0", "user"), R("a0", "assistant"), R("u1", "user"), R("a1", "assistant")];
    expect(undoCutId(msgs, "a1")).toBe("u1");
    expect(truncateMessagesFrom(msgs, undoCutId(msgs, "a1")).map((m) => m.id)).toEqual(["u0", "a0"]);
  });
  it("回合前不是用户消息 → 从回合本身截", () => {
    const msgs = [R("s0", "system"), R("a0", "assistant")];
    expect(undoCutId(msgs, "a0")).toBe("a0");
  });
  it("回合是首条 → 从自身截（无越界）", () => {
    const msgs = [R("a0", "assistant"), R("a1", "assistant")];
    expect(undoCutId(msgs, "a0")).toBe("a0");
  });
});
