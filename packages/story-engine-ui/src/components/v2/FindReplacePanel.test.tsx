import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FindReplacePanel from "./FindReplacePanel.js";

afterEach(() => cleanup());

function renderPanel(overrides: Partial<Parameters<typeof FindReplacePanel>[0]> = {}) {
  const handlers = {
    onQueryChange: vi.fn(),
    onReplaceChange: vi.fn(),
    onToggleCase: vi.fn(),
    onFindPrev: vi.fn(),
    onFindNext: vi.fn(),
    onReplaceCurrent: vi.fn(),
    onReplaceAll: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <FindReplacePanel
      query="风"
      replaceText="雪"
      caseSensitive={false}
      matchInfo={{ current: 1, total: 3 }}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("FindReplacePanel", () => {
  it("shows the current/total match count", () => {
    renderPanel();
    expect(screen.getByText("1/3")).toBeDefined();
  });

  it("shows 无匹配 when there is a query but no match", () => {
    renderPanel({ matchInfo: { current: 0, total: 0 } });
    expect(screen.getByText("无匹配")).toBeDefined();
  });

  it("shows 「N 处」 before navigating (current=0 but matches exist), not 0/N", () => {
    renderPanel({ matchInfo: { current: 0, total: 3 } });
    expect(screen.getByText("3 处")).toBeDefined();
    expect(screen.queryByText("0/3")).toBeNull();
  });

  it("Enter finds next, Shift+Enter finds prev, Esc closes", () => {
    const h = renderPanel();
    const input = screen.getByLabelText("查找");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.onFindNext).toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(h.onFindPrev).toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(h.onClose).toHaveBeenCalled();
  });

  it("wires 替换 / 全部替换 buttons", () => {
    const h = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "替换" }));
    expect(h.onReplaceCurrent).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "全部替换" }));
    expect(h.onReplaceAll).toHaveBeenCalled();
  });

  it("disables nav + replace-all when there are no matches", () => {
    renderPanel({ matchInfo: { current: 0, total: 0 } });
    expect(screen.getByRole("button", { name: "下一个" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "全部替换" })).toBeDisabled();
  });
});
