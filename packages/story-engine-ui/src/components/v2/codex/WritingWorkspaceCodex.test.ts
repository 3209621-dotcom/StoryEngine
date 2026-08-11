/**
 * WritingWorkspaceCodex — B5-3 轻量测试
 *
 * WritingWorkspaceCodex 本身依赖 localStorage / zustand store / 多个子面板，
 * 完整 DOM 渲染在 jsdom 下需大量 mock，成本过高。
 * 按 B5-3 brief 说明：「退而加一个断言 CATS 含 hooks 项的轻量测试 + 靠 build/typecheck 兜底」。
 *
 * 策略：WritingWorkspaceCodex.tsx 暴露 __CATS_FOR_TEST 命名导出，
 * 本测试直接断言 CATS 数组第 7 项为 hooks 类目。
 * build/typecheck（check-import-boundary + tsc + vite）兜底 JSX 渲染链路类型正确性。
 */

import { describe, it, expect } from "vitest";
import { __CATS_FOR_TEST } from "./WritingWorkspaceCodex.js";

describe("B5-3 CATS 数组含「伏笔线索」与「时间线」类目", () => {
  it("CATS 共 8 项", () => {
    expect(__CATS_FOR_TEST).toHaveLength(8);
  });

  it("含 hooks 类目，glyph / title / sub 与规格一致", () => {
    const hooksCat = __CATS_FOR_TEST.find((c) => c.id === "hooks");
    expect(hooksCat).toBeDefined();
    expect(hooksCat?.glyph).toBe("❖");
    expect(hooksCat?.title).toBe("伏笔线索");
    expect(hooksCat?.sub).toBe("未回收 / 已回收");
  });

  it("含 timeline 类目，glyph / title / sub 与规格一致", () => {
    const timelineCat = __CATS_FOR_TEST.find((c) => c.id === "timeline");
    expect(timelineCat).toBeDefined();
    expect(timelineCat?.glyph).toBe("▤");
    expect(timelineCat?.title).toBe("时间线");
    expect(timelineCat?.sub).toBe("近期 · 中段 · 远期");
  });

  it("timeline 是 CATS 的最后一项（append 不插队）", () => {
    const last = __CATS_FOR_TEST[__CATS_FOR_TEST.length - 1];
    expect(last?.id).toBe("timeline");
  });
});
