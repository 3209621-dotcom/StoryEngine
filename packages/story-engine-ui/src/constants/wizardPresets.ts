/**
 * 新用户三步向导用的精简 AI 服务预置。
 * baseUrl 一律官方公开地址；禁止把用户私人中转写进代码。
 */

export interface WizardServicePreset {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
  /** 推荐模型 id；连通测试成功后优先选用（列表里有则用之，否则退回列表第一项）。 */
  readonly recommendedModel: string;
  /** 「怎么拿密钥？」说明（可含官网路径提示）。 */
  readonly keyHelp: string;
  /** 是否需要用户自填接口地址（自定义 OpenAI 兼容）。 */
  readonly requiresBaseUrl: boolean;
}

export const WIZARD_SERVICE_PRESETS: readonly WizardServicePreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    recommendedModel: "deepseek-chat",
    keyHelp: "打开 platform.deepseek.com → API Keys → 创建并复制密钥。",
    requiresBaseUrl: false,
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnv: "ZHIPU_API_KEY",
    recommendedModel: "glm-4-flash",
    keyHelp: "打开 open.bigmodel.cn → API Keys → 创建并复制密钥。",
    requiresBaseUrl: false,
  },
  {
    id: "moonshot",
    label: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKeyEnv: "MOONSHOT_API_KEY",
    recommendedModel: "moonshot-v1-auto",
    keyHelp: "打开 platform.moonshot.cn → API Key 管理 → 创建并复制密钥。",
    requiresBaseUrl: false,
  },
  {
    id: "custom",
    label: "OpenAI 兼容（自定义）",
    baseUrl: "",
    apiKeyEnv: "STORY_ENGINE_API_KEY",
    recommendedModel: "",
    keyHelp: "向你的服务商索取 API Key；接口地址需兼容 OpenAI `/v1` 格式。",
    requiresBaseUrl: true,
  },
] as const;

/** 对话记忆上限预设（tokens）。 */
export const CHAT_MEMORY_PRESETS = [
  { id: "short", label: "短", tokens: 48_000 },
  { id: "standard", label: "标准", tokens: 96_000 },
  { id: "longform", label: "长篇", tokens: 300_000 },
] as const;

export type ChatMemoryPresetId = (typeof CHAT_MEMORY_PRESETS)[number]["id"];
