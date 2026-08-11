import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderList } from "./ProviderList.js";
import type { ProviderListProps } from "./ModelSettingsDialogTypes.js";

afterEach(() => cleanup());

describe("ProviderList destructive confirmation", () => {
  it("does not delete a provider on the first delete click", () => {
    const onDeleteProvider = vi.fn();
    renderProviderList({ onDeleteProvider });

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(onDeleteProvider).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "删除 AI 服务配置？" })).toHaveTextContent("不会删除故事项目");
  });

  it("cancels provider deletion without calling the delete callback", () => {
    const onDeleteProvider = vi.fn();
    renderProviderList({ onDeleteProvider });

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onDeleteProvider).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "删除 AI 服务配置？" })).toBeNull();
  });

  it("only deletes the provider after explicit confirmation", () => {
    const onDeleteProvider = vi.fn();
    renderProviderList({ onDeleteProvider });

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除 AI 服务" }));

    expect(onDeleteProvider).toHaveBeenCalledWith("provider-a");
    expect(onDeleteProvider).toHaveBeenCalledTimes(1);
  });

  it("closes provider deletion confirmation with Escape", () => {
    const onDeleteProvider = vi.fn();
    renderProviderList({ onDeleteProvider });

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "删除 AI 服务配置？" }), { key: "Escape" });

    expect(onDeleteProvider).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "删除 AI 服务配置？" })).toBeNull();
  });
});

function renderProviderList(overrides: Partial<ProviderListProps> = {}) {
  const props: ProviderListProps = {
    savedProviders: [{
      id: "provider-a",
      label: "测试服务商",
      baseUrl: "https://example.test/v1",
      apiKeyEnv: "TEST_API_KEY",
      apiKeyStatus: "present",
    }],
    providerModels: {},
    providerErrors: {},
    expandedProviderId: "provider-a",
    showProviderForm: false,
    onAddProvider: vi.fn(),
    onToggleProvider: vi.fn(),
    onEditProvider: vi.fn(),
    onRefreshProvider: vi.fn(),
    onDeleteProvider: vi.fn(),
    onAssignAll: vi.fn(),
    ...overrides,
  };
  return render(<ProviderList {...props} />);
}
