import { describe, expect, it } from "vitest";

import { useNavigationStore } from "./navigationStore.js";

describe("navigationStore usage dialog state", () => {
  it("does not clear a precomputed usage read error when opening the usage dialog", () => {
    useNavigationStore.setState({
      usageOpen: false,
      usageError: "请先打开真实本地项目。",
      usageLoading: false,
      usageSummary: null,
    });

    useNavigationStore.getState().openUsage();

    expect(useNavigationStore.getState().usageOpen).toBe(true);
    expect(useNavigationStore.getState().usageError).toBe("请先打开真实本地项目。");
  });
});

describe("navigationStore 中间区跳转信号（出稿自动跳写作台）", () => {
  it("requestCenterView 置 pendingCenterView，clearPendingCenterView 清空（一次性消费）", () => {
    useNavigationStore.setState({ pendingCenterView: null });
    useNavigationStore.getState().requestCenterView("desk");
    expect(useNavigationStore.getState().pendingCenterView).toBe("desk");
    useNavigationStore.getState().clearPendingCenterView();
    expect(useNavigationStore.getState().pendingCenterView).toBeNull();
  });
});
