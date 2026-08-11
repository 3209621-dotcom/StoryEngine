/**
 * 严格 provider 的工具 schema 补全（请求侧模型无关·R8）。
 *
 * Kimi/Moonshot 用「MFJS（Moonshot Flavored JSON Schema）」——比标准 JSON Schema 严，两条会拒整批工具：
 * 1. **每个节点都必须显式带 `type`**：标准里有 `enum` 可省 type，Kimi 不许 → "At path '...': type is not defined"。
 * 2. **不支持一堆校验关键字**（minimum/maximum/minLength/pattern/format… 与 Gemini 类似）：`z.number().int().positive()`
 *    生成的 `exclusiveMinimum/maximum`、`z.string().min()` 的 `minLength` 等都会被拒。
 * （2026-06-28 用户真机：is_byok 直连真 Moonshot 时触发；hub 自营 kimi 与 GLM/MiMo 都不计较，故只在 Kimi/Moonshot 启用。）
 *
 * 修法与 kimi-cli / opencode 一致：**发请求前把工具 schema 改造成 MFJS 合规**——补全 type + 剥掉不支持的校验关键字。
 * 运行时的 zod 校验不受影响（这些只影响发给模型的 schema，不影响我们自己的入参校验），故剥关键字是安全的。
 */

/** MFJS 不支持、需从发出的 schema 里剥掉的校验关键字（运行时 zod 仍照常校验）。 */
const MFJS_UNSUPPORTED_KEYWORDS = new Set([
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "pattern", "format",
  "minItems", "maxItems", "uniqueItems", "minContains", "maxContains",
  "minProperties", "maxProperties",
]);

/** 该 model id 是否需要 MFJS 改造（Kimi/Moonshot 系；前缀/子串不敏感）。 */
export function modelNeedsMfjs(modelId: string | undefined): boolean {
  return /kimi|moonshot/iu.test(modelId ?? "");
}

function inferTypeFromValues(values: readonly unknown[]): "string" | "number" | "boolean" {
  if (values.length > 0 && values.every((v) => typeof v === "number")) return "number";
  if (values.length > 0 && values.every((v) => typeof v === "boolean")) return "boolean";
  return "string"; // 全字符串 / 混合 / 空 → string（与文档兜底一致）
}

/** 递归把一个 JSON Schema 节点改造成 MFJS 合规：剥掉不支持关键字 + 补全缺失的 type。非对象（null/原始值）原样返回。 */
export function toMfjsCompliant(node: unknown): unknown {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  const n: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (!MFJS_UNSUPPORTED_KEYWORDS.has(k)) n[k] = v; // 剥掉不支持的校验关键字
  }

  // 递归子结构（无论父节点是否已有 type）。
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(n[key])) n[key] = (n[key] as unknown[]).map(toMfjsCompliant);
  }
  if (n.properties && typeof n.properties === "object" && !Array.isArray(n.properties)) {
    const props = n.properties as Record<string, unknown>;
    n.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, toMfjsCompliant(v)]));
  }
  if (n.items !== undefined) n.items = Array.isArray(n.items) ? n.items.map(toMfjsCompliant) : toMfjsCompliant(n.items);
  if (n.additionalProperties && typeof n.additionalProperties === "object") {
    n.additionalProperties = toMfjsCompliant(n.additionalProperties);
  }

  // 组合节点（anyOf/oneOf/allOf）：MFJS 要求结构只在分支里、父节点不得与分支重复定义关键字。
  // coerceEnum/coerceJsonObject + 可空经 AI SDK 转换后，父节点会孤立地挂着 enum/const/type 或与分支重复的
  // additionalProperties/propertyNames/required/properties 等 → Moonshot 报 "type is not defined" 或 "conflicting keywords"。
  // 修法：组合节点只保留 anyOf/oneOf/allOf + description/title，其余结构关键字一律剥掉（分支里已带、语义不丢）。
  if (Array.isArray(n.anyOf) || Array.isArray(n.oneOf) || Array.isArray(n.allOf)) {
    const KEEP = new Set(["anyOf", "oneOf", "allOf", "description", "title", "$schema"]);
    for (const k of Object.keys(n)) if (!KEEP.has(k)) delete n[k];
    return n;
  }
  // 已有 type、或 $ref → 不补父 type。
  if ("type" in n || "$ref" in n) return n;

  if (Array.isArray(n.enum)) { n.type = inferTypeFromValues(n.enum as unknown[]); return n; }
  if ("const" in n) { n.type = inferTypeFromValues([n.const]); return n; }
  if (n.properties !== undefined || n.additionalProperties !== undefined || n.required !== undefined) { n.type = "object"; return n; }
  if (n.items !== undefined) { n.type = "array"; return n; }
  n.type = "string"; // 纯 typeless 叶子（如 z.unknown→{}）兜底
  return n;
}

/** 把出站请求体里的 `tools[].function.parameters` 全部改造成 MFJS 合规（返回新对象）。无 tools 时原样返回。 */
export function sanitizeRequestToolSchemas(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.tools)) return body;
  const tools = (body.tools as unknown[]).map((tool) => {
    if (!tool || typeof tool !== "object") return tool;
    const t = tool as { function?: { parameters?: unknown } };
    if (!t.function || typeof t.function !== "object" || t.function.parameters === undefined) return tool;
    return { ...t, function: { ...t.function, parameters: toMfjsCompliant(t.function.parameters) } };
  });
  return { ...body, tools };
}
