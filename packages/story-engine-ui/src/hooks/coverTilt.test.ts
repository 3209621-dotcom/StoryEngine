import { describe, it, expect } from "vitest";

import { coverTiltTransform } from "./coverTilt.js";

function rotateY(t: string): number {
  return Number(t.match(/rotateY\((-?[\d.]+)deg\)/u)![1]);
}
function rotateX(t: string): number {
  return Number(t.match(/rotateX\((-?[\d.]+)deg\)/u)![1]);
}

describe("coverTiltTransform", () => {
  it("中心 → 无倾斜、仅抬起放大", () => {
    const t = coverTiltTransform(0.5, 0.5);
    expect(t).toContain("rotateX(0.00deg)");
    expect(t).toContain("rotateY(0.00deg)");
    expect(t).toContain("translateY(-6px)");
    expect(t).toContain("scale(1.04)");
  });

  it("右上角 → 朝光标倾斜：rotateY 正（右偏）、rotateX 正（顶部抬头），且 clamp 在 ±10deg 内", () => {
    const t = coverTiltTransform(1, 0); // 右上
    // 光标在右侧 → 绕 Y 轴正向转（右边后退、朝光标）
    expect(rotateY(t)).toBeGreaterThan(0);
    // 光标在顶部 → rotateX 取负后为正，封面顶部朝光标抬头
    expect(rotateX(t)).toBeGreaterThan(0);
    expect(Math.abs(rotateY(t))).toBeLessThanOrEqual(10);
    expect(Math.abs(rotateX(t))).toBeLessThanOrEqual(10);
  });

  it("左下角 → 符号相反（rotateY 负、rotateX 负），仍在 ±10deg 内", () => {
    const t = coverTiltTransform(0, 1); // 左下
    expect(rotateY(t)).toBeLessThan(0);
    expect(rotateX(t)).toBeLessThan(0);
    expect(Math.abs(rotateY(t))).toBeLessThanOrEqual(10);
    expect(Math.abs(rotateX(t))).toBeLessThanOrEqual(10);
  });

  it("越界输入被 clamp（不产生超大角度）", () => {
    const t = coverTiltTransform(5, -5);
    expect(Math.abs(rotateY(t))).toBeLessThanOrEqual(10);
    expect(Math.abs(rotateX(t))).toBeLessThanOrEqual(10);
  });
});
