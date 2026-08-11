// @vitest-environment node
//
// 请求侧模型无关·R7：思考开关「翻译表」。内部只有一个「思考 开/关」总开关，
// 发请求前翻译成每个模型自己的方言（OpenRouter/LiteLLM/Vercel AI SDK 的通用做法）。
// - GLM/MiMo：thinking:{type:enabled|disabled}
// - Qwen：enable_thinking 布尔；**非流式调用强制 false**（Qwen3 非流式不关思考会 400，实测铁律）
// - 认不出的模型：整键不发（换任何模型都不因这个参数报错）
// 注：发对方言 ≠ 模型一定听——glm-5/5.2/MiMo 关得掉，glm-4.6/4.7 无视照思考。那是模型脾气，非本层职责。
import { describe, expect, it } from "vitest";

import { resolveThinkingDialect, thinkingRequestParams } from "./model-capabilities.js";

describe("resolveThinkingDialect（按 model id 判方言，前缀匹配，大小写不敏感）", () => {
  it("glm*/mimo*/longcat* → glm 方言", () => {
    expect(resolveThinkingDialect("glm-4.6")).toBe("glm");
    expect(resolveThinkingDialect("GLM-5.2")).toBe("glm");
    expect(resolveThinkingDialect("mimo-v2.5")).toBe("glm");
    // 美团 LongCat-2.0（林远自用网关）真机实测：认 thinking:{type:"disabled"}（GLM 方言）、不认 enable_thinking。
    expect(resolveThinkingDialect("LongCat-2.0")).toBe("glm");
    expect(resolveThinkingDialect("longcat-flash")).toBe("glm");
    // DeepSeek V4 flash/pro（林远自用网关）真机实测：认 thinking:{type:"disabled"}（reasoning 归 0）。
    expect(resolveThinkingDialect("deepseek-v4-flash")).toBe("glm");
    expect(resolveThinkingDialect("deepseek-v4-pro")).toBe("glm");
    // 豆包 doubao-seed-2.0（经中转 47.104.186.114:3000）探针实测：不发→reasoning 405字；发 thinking:{type:"disabled"}→归 0。
    expect(resolveThinkingDialect("doubao-seed-2.0-pro")).toBe("glm");
    expect(resolveThinkingDialect("Doubao-Seed-1.6")).toBe("glm");
  });

  it("qwen*/qwq* → qwen 方言", () => {
    expect(resolveThinkingDialect("qwen3-235b")).toBe("qwen");
    expect(resolveThinkingDialect("Qwen3.5-9B")).toBe("qwen");
    expect(resolveThinkingDialect("qwq-32b")).toBe("qwen");
  });

  it("认不出的模型 → none（kimi/deepseek/gpt/空/undefined）", () => {
    expect(resolveThinkingDialect("kimi-k2.6")).toBe("none");
    expect(resolveThinkingDialect("moonshot-v1-8k")).toBe("none");
    expect(resolveThinkingDialect("deepseek-reasoner")).toBe("none");
    expect(resolveThinkingDialect("gpt-5")).toBe("none");
    expect(resolveThinkingDialect("")).toBe("none");
    expect(resolveThinkingDialect(undefined)).toBe("none");
  });
});

describe("thinkingRequestParams（把总开关翻成各家方言）", () => {
  it("glm 方言：thinking:{type}，开/关都显式发（流式与否无关）", () => {
    expect(thinkingRequestParams({ dialect: "glm", thinking: true, stream: true })).toEqual({ thinking: { type: "enabled" } });
    expect(thinkingRequestParams({ dialect: "glm", thinking: false, stream: true })).toEqual({ thinking: { type: "disabled" } });
    expect(thinkingRequestParams({ dialect: "glm", thinking: true, stream: false })).toEqual({ thinking: { type: "enabled" } });
    expect(thinkingRequestParams({ dialect: "glm", thinking: false, stream: false })).toEqual({ thinking: { type: "disabled" } });
  });

  it("qwen 方言（流式）：enable_thinking 跟随总开关", () => {
    expect(thinkingRequestParams({ dialect: "qwen", thinking: true, stream: true })).toEqual({ enable_thinking: true });
    expect(thinkingRequestParams({ dialect: "qwen", thinking: false, stream: true })).toEqual({ enable_thinking: false });
  });

  it("qwen 方言（非流式）：强制 enable_thinking:false——即便用户要开（Qwen3 非流式不关会 400）", () => {
    expect(thinkingRequestParams({ dialect: "qwen", thinking: true, stream: false })).toEqual({ enable_thinking: false });
    expect(thinkingRequestParams({ dialect: "qwen", thinking: false, stream: false })).toEqual({ enable_thinking: false });
  });

  it("none 方言：整键不发（开关均 → {}）", () => {
    expect(thinkingRequestParams({ dialect: "none", thinking: true, stream: true })).toEqual({});
    expect(thinkingRequestParams({ dialect: "none", thinking: false, stream: false })).toEqual({});
  });
});
