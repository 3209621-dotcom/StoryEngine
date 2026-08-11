import { describe, expect, it } from "vitest";
import type { ModelProfileSummary } from "../api/types.js";
import {
  buildModelSettingsConfig,
  buildTaskAssignmentsPayload,
  parseTaskViewState,
  taskProfileId,
} from "./ModelSettingsDialogLogic.js";

describe("buildTaskAssignmentsPayload 思考与模型旋钮独立", () => {
  it("纯关思考、没选模型的任务也进 payload（无 profileId），治静默丢弃", () => {
    const tasks = { fastDraft: "prov|gpt" }; // 只有 fastDraft 选了模型
    const thinking = { fastDraft: false, triage: false }; // triage 只关了思考、没选模型
    const payload = buildTaskAssignmentsPayload(tasks, thinking);
    expect(payload.fastDraft).toEqual({ profileId: taskProfileId("prov", "gpt"), thinking: false });
    expect(payload.triage).toEqual({ thinking: false }); // 无 profileId 但思考保住
  });

  it("thinking 未列的任务默认开", () => {
    const payload = buildTaskAssignmentsPayload({ repair: "prov|m" }, {});
    expect(payload.repair).toEqual({ profileId: taskProfileId("prov", "m"), thinking: true });
  });
});

describe("parseTaskViewState 反推面板状态", () => {
  it("profileId 映射回 provider|model；缺 profileId 的任务保留 thinking、tasks 留空", () => {
    const profiles: ModelProfileSummary[] = [{ id: "prov_gpt", provider: "prov", model: "gpt" }];
    const view = { fastDraft: { profileId: "prov_gpt", thinking: false }, triage: { thinking: false } };
    const { tasks, thinking } = parseTaskViewState(view, profiles);
    expect(tasks.fastDraft).toBe("prov|gpt");
    expect(tasks.triage).toBeUndefined(); // 无 profileId → tasks 留空（行显示「分配模型」）
    expect(thinking.fastDraft).toBe(false);
    expect(thinking.triage).toBe(false); // thinking 仍保住
  });
});

describe("buildModelSettingsConfig 保留对话记忆上限", () => {
  it("写入 chatHistoryBudgetTokens 供 PUT 全链落盘", () => {
    const config = buildModelSettingsConfig(
      [{ id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_API_KEY", apiKeyStatus: "present" }],
      { fastDraft: "deepseek|deepseek-chat" },
      { chatHistoryBudgetTokens: 300_000 },
    );
    expect(config.chatHistoryBudgetTokens).toBe(300_000);
  });
});
