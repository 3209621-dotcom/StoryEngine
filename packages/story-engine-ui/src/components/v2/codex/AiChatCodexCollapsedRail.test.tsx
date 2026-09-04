// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CollapsedAiRail } from "./AiChatCodex.js";

describe("CollapsedAiRail 折叠栏", () => {
  afterEach(() => cleanup());

  it("点击「AI 助手」按钮只触发一次展开（此前 aside+button 双 handler 冒泡两次取反=零，点击等于没点）", () => {
    const onToggleRight = vi.fn();
    render(<CollapsedAiRail onToggleRight={onToggleRight} />);

    fireEvent.click(screen.getByRole("button", { name: /AI 助手/ }));
    expect(onToggleRight).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("AI 助手"));
    expect(onToggleRight).toHaveBeenCalledTimes(2);
  });
});
