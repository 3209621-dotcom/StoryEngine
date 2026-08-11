// @vitest-environment jsdom
/**
 * R4a：连续失败时第 2 次自动重试 delay 应为 4s（退避），不是每次都 2s。
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetAutosaveControlForTest,
  scheduleAutosave,
} from "../../../utils/autosaveControl.js";
import { SaveStatusPill } from "./SaveStatusPill.js";

describe("SaveStatusPill 退避重试（R4a）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetAutosaveControlForTest();
  });
  afterEach(() => {
    cleanup();
    __resetAutosaveControlForTest();
    vi.useRealTimers();
  });

  it("连续失败时第 2 次自动重试 delay 是 4s 而非 2s", async () => {
    const onRetry = vi.fn(() => {
      void scheduleAutosave("ch1", async () => {
        throw new Error("仍失败");
      });
    });

    render(<SaveStatusPill onRetry={onRetry} />);

    await act(async () => {
      await scheduleAutosave("ch1", async () => {
        throw new Error("首次失败");
      });
    });

    // 第 1 次自动重试：2s
    expect(onRetry).toHaveBeenCalledTimes(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(onRetry).toHaveBeenCalledTimes(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onRetry).toHaveBeenCalledTimes(1);

    // 等重试写盘失败落定（微任务）
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // 第 2 次应等 4s（若 bug 会在 2s 就触发）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});
