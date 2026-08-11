import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// 只 mock codex 壳与 Home（不引用 classic 壳，使本测试能活过 Task 3 删除）。
import { vi } from "vitest";
vi.mock("./codex/WritingWorkspaceCodex.js", () => ({
  default: () => <div data-testid="codex-shell" />,
}));
vi.mock("./HomeLanding.js", () => ({
  default: () => <div data-testid="home-landing" />,
}));

import ImmersiveAppShell from "./ImmersiveAppShell.js";

describe("ImmersiveAppShell", () => {
  it("workspace 模式：带 ?classic 也只渲染 codex 壳（无 classic 回退）", () => {
    window.history.pushState({}, "", "/?classic");
    const { getByTestId } = render(
      // 空 props：codex 壳被 mock，不读真实字段。
      <ImmersiveAppShell mode="workspace" workspace={{} as never} />,
    );
    expect(getByTestId("codex-shell")).toBeTruthy();
  });

  it("home 模式：渲染 HomeLanding", () => {
    window.history.pushState({}, "", "/");
    const { getByTestId } = render(
      <ImmersiveAppShell mode="home" home={{} as never} />,
    );
    expect(getByTestId("home-landing")).toBeTruthy();
  });
});
