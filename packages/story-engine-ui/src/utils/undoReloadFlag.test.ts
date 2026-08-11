import { afterEach, describe, expect, it } from "vitest";
import { consumeUndoReloadPreferSession, markUndoReloadPreferSession } from "./undoReloadFlag.js";

afterEach(() => window.sessionStorage.clear());

describe("undoReloadFlag 一次性「撤销 reload 优先 session」标记（H5）", () => {
  it("mark 后 consume 一次返回 true，并清除（再 consume 为 false）", () => {
    markUndoReloadPreferSession();
    expect(consumeUndoReloadPreferSession()).toBe(true);
    // 一次性：第二次 consume 已被清除。
    expect(consumeUndoReloadPreferSession()).toBe(false);
  });

  it("未 mark 时 consume 返回 false（正常开书不受影响）", () => {
    expect(consumeUndoReloadPreferSession()).toBe(false);
  });
});
