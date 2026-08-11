import type { ModelInfoItem, ModelProfileSummary, ModelSettingsLoadResult, TaskAssignmentView } from "../api/types.js";
import { PROVIDER_PRESETS } from "../constants/providerPresets.js";
import type { WizardServicePreset } from "../constants/wizardPresets.js";
import { TASK_LABELS, TASK_SUGGEST_THINKING, type SavedProvider } from "./ModelSettingsDialogTypes.js";

/** 任务模型档案 id：与 model-settings.json 的 profile id 同一套，旁路 task-assignments 也用它。 */
export function taskProfileId(provId: string, model: string): string {
  return `${provId}_${model}`.replace(/[^\w-]/g, "_");
}

/** 连通测试失败信息人话化：把 HTTP/网络底层报错翻成用户能行动的提示。 */
export function formatHumanTestError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|authentication|api key|invalid|unauthorized/i.test(message)) {
    return "密钥无效或已过期。请检查后重试，或到服务商控制台重新创建密钥。";
  }
  if (/timeout|超时|aborted/i.test(message)) {
    return "连接超时。请检查网络，或确认接口地址是否正确后再重试。";
  }
  if (/ENOTFOUND|ECONNREFUSED|无法连接|Failed to fetch|NetworkError/i.test(message)) {
    return "连不上该 AI 服务。请检查接口地址与网络后重试。";
  }
  if (/404|not found/i.test(message)) {
    return "接口地址可能不对（常见需以 /v1 结尾）。请修正后再试。";
  }
  const cleaned = message.replace(/\s+/g, " ").trim();
  return `测试未通过：${cleaned.slice(0, 160)}${cleaned.length > 160 ? "…" : ""}`;
}

/** 从 raw JSON 文本抽出对话记忆上限；缺省/非法返回 null。 */
export function parseChatHistoryBudgetTokens(rawText: string | undefined | null): number | null {
  if (!rawText?.trim()) return null;
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = (parsed as Record<string, unknown>).chatHistoryBudgetTokens;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  } catch {
    return null;
  }
}

/** 连通测试返回的模型列表里，优先取推荐模型，否则取第一项。 */
export function pickRecommendedModelId(
  models: readonly ModelInfoItem[],
  recommendedModel: string,
): string | null {
  if (models.length === 0) return null;
  const want = recommendedModel.trim();
  if (want && models.some((m) => m.id === want)) return want;
  return models[0]?.id ?? null;
}

/**
 * 向导成功后的推荐配置：单服务 + 全任务指向同一推荐模型 + 思考按软建议。
 */
export function buildWizardRecommendedState(
  preset: WizardServicePreset,
  baseUrl: string,
  modelId: string,
): {
  readonly providers: readonly SavedProvider[];
  readonly tasks: Record<string, string>;
  readonly thinking: Record<string, boolean>;
} {
  const providerId = preset.id === "custom" ? "custom" : preset.id;
  const provider: SavedProvider = {
    id: providerId,
    label: preset.label,
    baseUrl: baseUrl.trim(),
    apiKeyEnv: preset.apiKeyEnv,
    apiKeyStatus: "present",
  };
  const tasks: Record<string, string> = {};
  const thinking: Record<string, boolean> = {};
  for (const key of Object.keys(TASK_LABELS)) {
    tasks[key] = `${providerId}|${modelId}`;
    thinking[key] = TASK_SUGGEST_THINKING[key] ?? true;
  }
  return { providers: [provider], tasks, thinking };
}

export interface ParsedModelSettings {
  readonly tasks: Record<string, string>;
  readonly providers: readonly SavedProvider[];
  readonly providerModels: Record<string, readonly ModelInfoItem[]>;
}

export function parseModelSettings(result: ModelSettingsLoadResult | null | undefined): ParsedModelSettings {
  const summary = result?.summary;
  const taskProfiles = summary?.taskProfiles as Record<string, string> | undefined;
  const profiles = summary?.profiles ?? [];
  const providers = Array.isArray(summary?.providers) ? summary.providers : [];

  return {
    tasks: parseTaskAssignments(taskProfiles, profiles),
    providers: parseSavedProviders(providers),
    providerModels: parseProviderModels(profiles),
  };
}

function parseTaskAssignments(
  taskProfiles: Record<string, string> | undefined,
  profiles: readonly ModelProfileSummary[],
): Record<string, string> {
  const savedTasks: Record<string, string> = {};
  if (!taskProfiles) return savedTasks;

  for (const [taskKey, profileId] of Object.entries(taskProfiles)) {
    const profile = profiles.find((p) => p?.id === profileId);
    if (profile?.provider && profile.model) {
      savedTasks[taskKey] = `${profile.provider}|${profile.model}`;
    }
  }
  return savedTasks;
}

function parseSavedProviders(
  providers: ModelSettingsLoadResult["summary"]["providers"],
): readonly SavedProvider[] {
  return providers
    .filter((p): p is NonNullable<typeof p> => p != null && typeof p.id === "string")
    .map((p) => ({
      id: p.id,
      label: typeof p.label === "string" ? p.label : p.id,
      baseUrl: typeof p.baseUrl === "string" ? p.baseUrl : "",
      apiKeyEnv: typeof p.apiKeyEnv === "string" ? p.apiKeyEnv : "",
      apiKeyStatus: ["present", "missing", "not_required"].includes(p.apiKeyStatus as string)
        ? (p.apiKeyStatus as "present" | "missing" | "not_required")
        : "missing",
    }));
}

function parseProviderModels(
  profiles: readonly ModelProfileSummary[],
): Record<string, readonly ModelInfoItem[]> {
  const modelsByProvider: Record<string, ModelInfoItem[]> = {};
  for (const profile of profiles) {
    if (!profile?.provider || !profile.model) continue;
    if (!modelsByProvider[profile.provider]) modelsByProvider[profile.provider] = [];
    if (!modelsByProvider[profile.provider].some((m) => m.id === profile.model)) {
      modelsByProvider[profile.provider].push({ id: profile.model, name: profile.model });
    }
  }
  return modelsByProvider;
}

export function buildModelSettingsConfig(
  savedProviders: readonly SavedProvider[],
  tasks: Record<string, string>,
  options?: { readonly chatHistoryBudgetTokens?: number | null },
): Record<string, unknown> {
  const providerMap: Record<string, unknown> = {};
  const seenProviders = new Set<string>();

  for (const prov of savedProviders) {
    const preset = PROVIDER_PRESETS.find((p) => p.id === prov.id);
    providerMap[prov.id] = {
      id: prov.id,
      label: prov.label,
      type: preset?.type ?? "openai-compatible",
      baseUrl: prov.baseUrl,
      apiKeyEnv: prov.apiKeyEnv || preset?.apiKeyEnvSuggestion || undefined,
    };
    seenProviders.add(prov.id);
  }

  for (const val of Object.values(tasks)) {
    if (!val) continue;
    const [provId] = val.split("|");
    if (!provId || seenProviders.has(provId)) continue;
    seenProviders.add(provId);
    const preset = PROVIDER_PRESETS.find((p) => p.id === provId);
    if (preset) {
      providerMap[preset.id] = {
        id: preset.id,
        label: preset.label,
        type: preset.type,
        baseUrl: preset.baseUrl,
        apiKeyEnv: preset.apiKeyEnvSuggestion || undefined,
      };
    }
  }

  const profileMap: Record<string, unknown> = {};
  const finalTasks: Record<string, string> = {};
  for (const [key, val] of Object.entries(tasks)) {
    if (!val) continue;
    const [provId, model] = val.split("|");
    if (!provId || !model) continue;
    const profId = taskProfileId(provId, model);
    if (!profileMap[profId]) {
      profileMap[profId] = {
        id: profId,
        label: model,
        provider: provId,
        model,
        temperature: 0.7,
        maxTokens: 4096,
        timeoutMs: 60000,
        retries: 2,
        stream: true,
      };
    }
    finalTasks[key] = profId;
  }

  const defaultProvider = seenProviders.size > 0 ? [...seenProviders][0] : undefined;
  const budget = options?.chatHistoryBudgetTokens;
  return {
    version: 1,
    providers: providerMap,
    profiles: profileMap,
    taskProfiles: finalTasks,
    ...(defaultProvider ? { defaultProvider } : {}),
    ...(typeof budget === "number" && budget > 0 ? { chatHistoryBudgetTokens: budget } : {}),
  };
}

/**
 * 从 tasks（task→"provider|model"）+ thinking（task→bool）构造旁路 taskAssignments 载荷（task→{profileId?,thinking}）。
 * 遍历 tasks ∪ thinking 全部 key——**思考与模型两个旋钮独立**：没显式选模型、只关思考的任务也必须落盘
 * （治审查 important：纯切思考被静默丢弃）。有选模型才带 profileId（与 buildModelSettingsConfig 的 taskProfileId 同一套）。
 */
export function buildTaskAssignmentsPayload(
  tasks: Record<string, string>,
  thinking: Record<string, boolean>,
): TaskAssignmentView {
  const out: Record<string, { profileId?: string; thinking: boolean }> = {};
  const keys = new Set([...Object.keys(tasks), ...Object.keys(thinking)]);
  for (const task of keys) {
    const entry: { profileId?: string; thinking: boolean } = { thinking: thinking[task] ?? true };
    const val = tasks[task];
    if (val) {
      const [provId, model] = val.split("|");
      if (provId && model) entry.profileId = taskProfileId(provId, model);
    }
    out[task] = entry;
  }
  return out;
}

/**
 * 从 GET 返回的 taskAssignments 视图（task→{profileId,thinking}）+ profiles 反推面板状态：
 * tasks（task→"provider|model"，profileId 映射回 provider/model）与 thinking（task→bool）。
 * 视图缺失 → 返回空（调用方回退引擎 taskProfiles 解析、thinking 走默认开）。
 */
export function parseTaskViewState(
  taskAssignments: TaskAssignmentView | undefined,
  profiles: readonly ModelProfileSummary[],
): { tasks: Record<string, string>; thinking: Record<string, boolean> } {
  const tasks: Record<string, string> = {};
  const thinking: Record<string, boolean> = {};
  if (!taskAssignments) return { tasks, thinking };
  for (const [task, entry] of Object.entries(taskAssignments)) {
    thinking[task] = entry.thinking;
    const profile = profiles.find((p) => p?.id === entry.profileId);
    if (profile?.provider && profile.model) {
      tasks[task] = `${profile.provider}|${profile.model}`;
    }
  }
  return { tasks, thinking };
}
