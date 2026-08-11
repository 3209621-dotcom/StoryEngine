import { describe, it, expect } from "vitest";
import { resolveInitialReduceMotion } from "./motionStore";

describe("resolveInitialReduceMotion", () => {
  it("localStorage 存 'true' → true（用户手动开过，覆盖系统）", () => {
    expect(resolveInitialReduceMotion({ stored: "true", systemReduced: false })).toBe(true);
  });
  it("localStorage 存 'false' → false（用户手动关过，即使系统要减也尊重用户）", () => {
    expect(resolveInitialReduceMotion({ stored: "false", systemReduced: true })).toBe(false);
  });
  it("无存值 → 跟随系统 prefers-reduced-motion", () => {
    expect(resolveInitialReduceMotion({ stored: null, systemReduced: true })).toBe(true);
    expect(resolveInitialReduceMotion({ stored: null, systemReduced: false })).toBe(false);
  });
});
