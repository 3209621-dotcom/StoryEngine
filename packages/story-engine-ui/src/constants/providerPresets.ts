/**
 * Provider presets — pre-configured templates for common AI service providers.
 * Mirrors inkos ServiceListPage preset system, adapted for story-engine-ui.
 */

export type ProviderPresetGroup = "overseas" | "china" | "aggregator" | "local";

export interface ProviderPreset {
  readonly id: string;
  readonly label: string;
  readonly group: ProviderPresetGroup;
  readonly type: "openai-compatible" | "openai";
  readonly baseUrl: string;
  readonly apiKeyEnvSuggestion: string;
  readonly modelsHint?: string;
}

export const GROUP_LABELS: Record<ProviderPresetGroup, string> = {
  overseas: "海外原厂",
  china: "国产原厂",
  aggregator: "聚合 / 二手 API",
  local: "本地 / 自部署",
};

export const PROVIDER_PRESETS: ReadonlyArray<ProviderPreset> = [
  // ---- Overseas ----
  {
    id: "openai",
    label: "OpenAI",
    group: "overseas",
    type: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnvSuggestion: "OPENAI_API_KEY",
    modelsHint: "gpt-4o, gpt-4o-mini, o3-mini 等",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    group: "overseas",
    type: "openai-compatible",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeyEnvSuggestion: "ANTHROPIC_API_KEY",
    modelsHint: "需兼容网关。原生 Anthropic API 非 OpenAI 格式。",
  },
  {
    id: "google",
    label: "Google Gemini",
    group: "overseas",
    type: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnvSuggestion: "GEMINI_API_KEY",
    modelsHint: "gemini-2.5-flash, gemini-2.5-pro 等",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    group: "overseas",
    type: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    apiKeyEnvSuggestion: "XAI_API_KEY",
    modelsHint: "grok-4, grok-3 等",
  },
  {
    id: "azure-openai",
    label: "Azure OpenAI",
    group: "overseas",
    type: "openai-compatible",
    baseUrl: "https://RESOURCE.openai.azure.com/openai/v1",
    apiKeyEnvSuggestion: "AZURE_OPENAI_API_KEY",
    modelsHint: "填你的资源名替换 RESOURCE，模型用部署名",
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    group: "overseas",
    type: "openai-compatible",
    baseUrl: "https://router.huggingface.co/v1",
    apiKeyEnvSuggestion: "HF_API_KEY",
    modelsHint: "Kimi-K2, GLM-4.6, Qwen3 等开源模型推理",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    group: "overseas",
    type: "openai-compatible",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyEnvSuggestion: "CEREBRAS_API_KEY",
    modelsHint: "qwen3-coder-480b, llama-4 等（极快）",
  },
  {
    id: "together",
    label: "Together AI",
    group: "overseas",
    type: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    apiKeyEnvSuggestion: "TOGETHER_API_KEY",
    modelsHint: "DeepSeek, Qwen, Llama 等开源模型",
  },

  // ---- China ----
  {
    id: "deepseek",
    label: "DeepSeek",
    group: "china",
    type: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnvSuggestion: "DEEPSEEK_API_KEY",
    modelsHint: "deepseek-chat, deepseek-reasoner 等",
  },
  {
    id: "tongyi",
    label: "通义千问 (Alibaba)",
    group: "china",
    type: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnvSuggestion: "DASHSCOPE_API_KEY",
    modelsHint: "qwen-plus, qwen-max, qwen-turbo 等",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    group: "china",
    type: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnvSuggestion: "ZHIPU_API_KEY",
    modelsHint: "glm-4-plus, glm-4-flash 等",
  },
  {
    id: "moonshot",
    label: "Moonshot (月之暗面)",
    group: "china",
    type: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKeyEnvSuggestion: "MOONSHOT_API_KEY",
    modelsHint: "moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k",
  },
  {
    id: "baidu",
    label: "百度文心",
    group: "china",
    type: "openai-compatible",
    baseUrl: "https://qianfan.baidubce.com/v2",
    apiKeyEnvSuggestion: "BAIDU_API_KEY",
    modelsHint: "需兼容网关。原生千帆 API 非 OpenAI 格式。",
  },
  {
    id: "minimax",
    label: "MiniMax",
    group: "china",
    type: "openai-compatible",
    baseUrl: "https://api.minimax.chat/v1",
    apiKeyEnvSuggestion: "MINIMAX_API_KEY",
    modelsHint: "abab6.5s-chat, abab7-chat-preview 等",
  },
  {
    id: "volcengine",
    label: "火山方舟 (豆包)",
    group: "china",
    type: "openai-compatible",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKeyEnvSuggestion: "ARK_API_KEY",
    modelsHint: "doubao-1-5-pro, doubao-1-5-lite 等（推理接入点 ID）",
  },
  {
    id: "stepfun",
    label: "阶跃星辰 StepFun",
    group: "china",
    type: "openai-compatible",
    baseUrl: "https://api.stepfun.com/v1",
    apiKeyEnvSuggestion: "STEPFUN_API_KEY",
    modelsHint: "step-1, step-2-mini, step-2-16k 等",
  },
  {
    id: "lingyiwanwu",
    label: "零一万物 01.AI",
    group: "china",
    type: "openai-compatible",
    baseUrl: "https://api.lingyiwanwu.com/v1",
    apiKeyEnvSuggestion: "LINGYI_API_KEY",
    modelsHint: "yi-lightning, yi-large 等",
  },
  {
    id: "xunfei",
    label: "讯飞星火",
    group: "china",
    type: "openai-compatible",
    baseUrl: "https://spark-api-open.xf-yun.com/v1",
    apiKeyEnvSuggestion: "SPARK_API_KEY",
    modelsHint: "spark-max, spark-pro, spark-lite 等",
  },
  {
    id: "zhipu-coding-plan",
    label: "智谱 Coding Plan",
    group: "china",
    type: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnvSuggestion: "ZHIPU_CODING_PLAN_API_KEY",
    modelsHint: "glm-4.6, glm-4.5, glm-4-flash 等（编程套餐）",
  },
  {
    id: "baichuan",
    label: "百川智能",
    group: "china",
    type: "openai-compatible",
    baseUrl: "https://api.baichuan-ai.com/v1",
    apiKeyEnvSuggestion: "BAICHUAN_API_KEY",
    modelsHint: "Baichuan4-Turbo 等",
  },
  {
    id: "hunyuan",
    label: "腾讯混元",
    group: "china",
    type: "openai-compatible",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    apiKeyEnvSuggestion: "HUNYUAN_API_KEY",
    modelsHint: "hunyuan-turbos, hunyuan-large 等",
  },

  // ---- Coding Plan / 订阅套餐 ----
  {
    id: "opencode-go",
    label: "OpenCode Go",
    group: "china",
    type: "openai-compatible",
    // 官方文档：Go 订阅走 /zen/go/v1（api.opencode.ai 是幻觉域名，任何路径都回 200+纯文本 Not Found）
    baseUrl: "https://opencode.ai/zen/go/v1",
    apiKeyEnvSuggestion: "OPENCODE_GO_API_KEY",
    modelsHint: "deepseek-v4-pro, glm-5.2, kimi-k3 等（订阅制，开源模型）",
  },
  {
    id: "opencode-zen",
    label: "OpenCode Zen",
    group: "aggregator",
    type: "openai-compatible",
    baseUrl: "https://opencode.ai/zen/v1",
    apiKeyEnvSuggestion: "OPENCODE_ZEN_API_KEY",
    modelsHint: "按量付费聚合；GPT 系列走 Responses API、本应用暂不支持，请选 deepseek/glm/kimi 等",
  },

  // ---- Aggregator ----
  {
    id: "siliconflow",
    label: "SiliconFlow (硅基流动)",
    group: "aggregator",
    type: "openai-compatible",
    baseUrl: "https://api.siliconflow.cn/v1",
    apiKeyEnvSuggestion: "SILICONFLOW_API_KEY",
    modelsHint: "DeepSeek-V3, Qwen2.5, Llama 等大量开源模型",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    group: "aggregator",
    type: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnvSuggestion: "OPENROUTER_API_KEY",
    modelsHint: "几乎所有模型的聚合网关",
  },
  {
    id: "groq",
    label: "Groq",
    group: "aggregator",
    type: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnvSuggestion: "GROQ_API_KEY",
    modelsHint: "llama-3.3-70b, mixtral-8x7b 等（极快推理）",
  },
  {
    id: "302ai",
    label: "302.AI",
    group: "aggregator",
    type: "openai-compatible",
    baseUrl: "https://api.302.ai/v1",
    apiKeyEnvSuggestion: "TRE02_API_KEY",
    modelsHint: "聚合多家大模型 API",
  },

  // ---- Local ----
  {
    id: "ollama",
    label: "Ollama（本地）",
    group: "local",
    type: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    apiKeyEnvSuggestion: "",
    modelsHint: "无需 API Key。本地运行 llama3, qwen2.5, mistral 等。",
  },
  {
    id: "lmstudio",
    label: "LM Studio（本地）",
    group: "local",
    type: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    apiKeyEnvSuggestion: "",
    modelsHint: "无需 API Key。本地加载 GGUF 模型。",
  },
  {
    id: "vllm",
    label: "vLLM（自部署）",
    group: "local",
    type: "openai-compatible",
    baseUrl: "http://localhost:8000/v1",
    apiKeyEnvSuggestion: "",
    modelsHint: "自部署 OpenAI 兼容服务。",
  },
];
