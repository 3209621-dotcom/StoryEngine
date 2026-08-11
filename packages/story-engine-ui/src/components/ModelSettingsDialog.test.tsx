// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import ModelSettingsDialog from "./ModelSettingsDialog.js";

const fetchModelSettings = vi.fn();
const saveModelSettings = vi.fn();
const testModelConnection = vi.fn();

vi.mock("../api/client.js", () => ({
  fetchModelSettings: (...args: unknown[]) => fetchModelSettings(...args),
  saveModelSettings: (...args: unknown[]) => saveModelSettings(...args),
  testModelConnection: (...args: unknown[]) => testModelConnection(...args),
}));

vi.mock("./DisplaySettingsSection.js", () => ({
  DisplaySettingsSection: () => <div data-testid="display-settings" />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  fetchModelSettings.mockReset();
  saveModelSettings.mockReset();
  testModelConnection.mockReset();
});

describe("ModelSettingsDialog 表面切换", () => {
  it("无任何已配置 AI 服务时默认向导态", async () => {
    fetchModelSettings.mockResolvedValue({
      result: {
        passed: false,
        available: false,
        status: "missing",
        configPath: "/tmp/x",
        summary: {
          available: false,
          status: "missing",
          configPath: "/tmp/x",
          providers: [],
          profiles: [],
          taskProfiles: {},
          issueCount: 0,
          highRiskIssueCount: 0,
        },
        issues: [],
      },
      rawText: "{}",
      taskAssignments: {},
    });

    render(<ModelSettingsDialog open onCancel={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByLabelText("AI 设置向导")).toBeTruthy();
    });
    expect(screen.getByText("开始使用 AI")).toBeTruthy();
    expect(screen.queryByText("当前 AI 服务")).toBeNull();
  });

  it("已配置服务时进入简单视图", async () => {
    fetchModelSettings.mockResolvedValue({
      result: {
        passed: true,
        available: true,
        status: "loaded",
        configPath: "/tmp/x",
        summary: {
          available: true,
          status: "loaded",
          configPath: "/tmp/x",
          providers: [{
            id: "deepseek",
            label: "DeepSeek",
            type: "openai-compatible",
            baseUrl: "https://api.deepseek.com/v1",
            apiKeyEnv: "DEEPSEEK_API_KEY",
            apiKeyStatus: "present",
          }],
          profiles: [{ id: "deepseek_deepseek-chat", provider: "deepseek", model: "deepseek-chat" }],
          taskProfiles: { fastDraft: "deepseek_deepseek-chat" },
          issueCount: 0,
          highRiskIssueCount: 0,
        },
        issues: [],
      },
      rawText: '{"chatHistoryBudgetTokens":96000}',
      taskAssignments: {
        fastDraft: { profileId: "deepseek_deepseek-chat", thinking: false },
      },
    });
    testModelConnection.mockResolvedValue({ providerId: "deepseek", models: [{ id: "deepseek-chat" }], elapsedMs: 10 });

    render(<ModelSettingsDialog open onCancel={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByLabelText("当前 AI 服务")).toBeTruthy();
    });
    expect(screen.getByText("DeepSeek")).toBeTruthy();
    expect(screen.queryByLabelText("AI 设置向导")).toBeNull();
  });
});
