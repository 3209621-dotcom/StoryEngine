import { describe, it, expect } from "vitest";
import { deriveIntentTitle } from "./deriveIntentTitle";

describe("deriveIntentTitle", () => {
  it("短句原样", () => expect(deriveIntentTitle("把第3段改冷峻")).toBe("把第3段改冷峻"));
  it("超长裁断加省略号", () => expect(deriveIntentTitle("a".repeat(30))).toBe(`${"a".repeat(24)}…`));
  it("取首行", () => expect(deriveIntentTitle("第一行\n第二行")).toBe("第一行"));
  it("空串回退", () => expect(deriveIntentTitle("   ")).toBe("AI 交互"));
});
