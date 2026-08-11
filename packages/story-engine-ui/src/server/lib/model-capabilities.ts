/**
 * 模型能力·思考开关「翻译表」（请求侧模型无关·R7）。
 *
 * 产品方向是「通用 agent·模型无关」。各家「开/关思考」的请求参数方言不同——此前我们对**每个模型**都写死
 * 智谱 GLM 专有的 `thinking:{type:"enabled"|"disabled"}`，Kimi/Qwen 等不认 → 每条请求 400。
 *
 * 行业通用做法（OpenRouter 的 `reasoning` / LiteLLM 的 `reasoning_effort` / Vercel AI SDK 的 `providerOptions`）：
 * 内部只留一个「思考 开/关」总开关，发请求前**翻译成每个模型自己的那句话**。这里就是那张翻译表。
 *
 * 关键事实（2026-06-28 真机实测，见 scratchpad 探针）：
 * - **方言按模型，不按 provider**：同一中转上 MiMo 认 `thinking:{type}`、Kimi 不认；只能看 model id。
 * - **LongCat（美团）认 GLM 方言**（2026-07-01 真机实测 LongCat-2.0：`thinking:{type:"disabled"}`→思考归 0；
 *   `enable_thinking:false` 无效照样思考；`reasoning_effort` 报 500）。故 longcat* 归 glm 方言。
 * - **DeepSeek V4 flash/pro 认 GLM 方言**（2026-07-01 真机实测 deepseek-v4-flash：`thinking:{type:"disabled"}`→reasoning
 *   归 0；`enable_thinking:false` 无效）。只归 `deepseek-v4*`（实测过的）；deepseek-reasoner/chat 不动（纯推理/无思考，未验证）。
 * - **豆包（doubao-seed-2.0）认 GLM 方言**（2026-07-01 探针实测 doubao-seed-2.0-pro 经中转 47.104.186.114:3000：
 *   不发参数→reasoning_content 405字/reasoning_tokens 328；发 `thinking:{type:"disabled"}`→reasoning 归 0、耗时降 3 倍。
 *   中转正常透传该参数）。归 `doubao*`。
 * - **发对方言 ≠ 模型一定听**：glm-5/glm-5.2/MiMo 关思考真生效（思考→0~60 字），但 glm-4.6/glm-4.7 **无视**
 *   `disabled`、照样思考 1600~2200 字。能不能关是模型自己的脾气，本层只负责「把对的开关发对模型」。
 * - **Qwen 非流式铁律**：Qwen3 非流式调用必须 `enable_thinking:false`，否则 400（即便不发、模型默认带思考也会 400）。
 * - **默认安全**：认不出的模型整键不发，换任何模型都不因这个参数报错。
 */

/** 思考开关方言。none = 该模型没有（我们已知的）参数级思考开关，整键不发。 */
export type ThinkingDialect = "glm" | "qwen" | "none";

/** 按 model id 判定思考开关方言（内置前缀白名单，大小写不敏感）。认不出 → none（不发→绝不报错）。 */
export function resolveThinkingDialect(modelId: string | undefined): ThinkingDialect {
  const id = (modelId ?? "").trim().toLowerCase();
  if (!id) return "none";
  if (/^(?:glm|mimo|longcat|deepseek-v4|doubao)/u.test(id)) return "glm";
  if (/^(?:qwen|qwq)/u.test(id)) return "qwen";
  return "none";
}

/**
 * 把「思考 开/关」总开关翻译成请求体里该模型认的参数片段（展开进 body）。
 * - **glm**：`{ thinking: { type: "enabled" | "disabled" } }`，开关都显式发（GLM 部分模型默认开思考，必须显式关）。
 * - **qwen**：`{ enable_thinking: boolean }`；**非流式强制 false**——Qwen3 非流式不关思考直接 400，写作（非流式）正好要关。
 * - **none**：`{}`（整键省略）。
 */
export function thinkingRequestParams(opts: {
  readonly dialect: ThinkingDialect;
  readonly thinking: boolean;
  readonly stream: boolean;
}): Record<string, unknown> {
  switch (opts.dialect) {
    case "glm":
      return { thinking: { type: opts.thinking ? "enabled" : "disabled" } };
    case "qwen":
      return { enable_thinking: opts.stream ? opts.thinking : false };
    case "none":
    default:
      return {};
  }
}
