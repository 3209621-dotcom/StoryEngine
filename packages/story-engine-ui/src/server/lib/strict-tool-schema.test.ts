// @vitest-environment node
//
// Kimi/Moonshot 的「MFJS（Moonshot Flavored JSON Schema）」铁律（2026-06-28 真机踩坑 + 官方文档）：
// 1) 每个 schema 节点都必须显式带 `type`（有 enum 也不能省）→ 否则 "type is not defined" 拒整批工具。
// 2) 不支持 minimum/maximum/minLength/pattern/format 等校验关键字（与 Gemini 类似）。
// toMfjsCompliant 把任意 JSON Schema 改造成合规：剥不支持关键字 + 补全 type；只对 Kimi/Moonshot 启用。
import { describe, expect, it } from "vitest";

import { modelNeedsMfjs, toMfjsCompliant } from "./strict-tool-schema.js";

describe("modelNeedsMfjs", () => {
  it("Kimi/Moonshot 系 → true", () => {
    expect(modelNeedsMfjs("kimi-k2.6")).toBe(true);
    expect(modelNeedsMfjs("kimi-k2.7-code")).toBe(true);
    expect(modelNeedsMfjs("moonshot-v1-8k")).toBe(true);
    expect(modelNeedsMfjs("Moonshot-Kimi")).toBe(true);
  });
  it("其它模型 / 空 → false（不动它们的 schema）", () => {
    expect(modelNeedsMfjs("glm-4.6")).toBe(false);
    expect(modelNeedsMfjs("mimo-v2.5")).toBe(false);
    expect(modelNeedsMfjs("qwen3.7-plus")).toBe(false);
    expect(modelNeedsMfjs("")).toBe(false);
    expect(modelNeedsMfjs(undefined)).toBe(false);
  });
});

describe("toMfjsCompliant·补全 type", () => {
  it("enum-only → 按取值推断补 type", () => {
    expect(toMfjsCompliant({ enum: ["a", "b"] })).toEqual({ type: "string", enum: ["a", "b"] });
    expect(toMfjsCompliant({ enum: [1, 2, 3] })).toEqual({ type: "number", enum: [1, 2, 3] });
    expect(toMfjsCompliant({ enum: [true, false] })).toEqual({ type: "boolean", enum: [true, false] });
    expect(toMfjsCompliant({ enum: ["a", 1] })).toEqual({ type: "string", enum: ["a", 1] });
  });
  it("const-only → 按值推断补 type", () => {
    expect(toMfjsCompliant({ const: "full" })).toEqual({ type: "string", const: "full" });
  });
  it("已有 type → type 原样（关键字仍会被剥）", () => {
    expect(toMfjsCompliant({ type: "string", enum: ["a"] })).toEqual({ type: "string", enum: ["a"] });
  });
  it("有 properties 无 type → 补 object 并递归", () => {
    const out = toMfjsCompliant({ properties: { k: { enum: ["x"] } } }) as Record<string, unknown>;
    expect(out.type).toBe("object");
    expect((out.properties as Record<string, unknown>).k).toEqual({ type: "string", enum: ["x"] });
  });
  it("有 items 无 type → 补 array 并递归", () => {
    const out = toMfjsCompliant({ items: { enum: ["x"] } }) as Record<string, unknown>;
    expect(out.type).toBe("array");
    expect(out.items).toEqual({ type: "string", enum: ["x"] });
  });
  it("纯 typeless 叶子（z.unknown→{} / 只有 description）→ 兜底 string", () => {
    expect(toMfjsCompliant({})).toEqual({ type: "string" });
    expect(toMfjsCompliant({ description: "随便填" })).toEqual({ type: "string", description: "随便填" });
  });
  it("anyOf：父不补 type，分支递归补全", () => {
    const out = toMfjsCompliant({ anyOf: [{ enum: ["a"] }, { properties: { x: {} } }] }) as Record<string, unknown>;
    expect("type" in out).toBe(false);
    const branches = out.anyOf as Record<string, unknown>[];
    expect(branches[0]).toEqual({ type: "string", enum: ["a"] });
    expect((branches[1] as { type: string }).type).toBe("object");
  });

  it("anyOf 节点带孤立的顶层 enum（coerceEnum+可空的真实形态）→ 剥掉顶层 enum，保留 description+anyOf", () => {
    // 真实 read_foundation.kind：顶层 enum 没 type + type 在 anyOf 分支里 → Moonshot 报 "type is not defined"
    const out = toMfjsCompliant({
      enum: ["character", "asset"],
      description: "想读哪类",
      anyOf: [{ enum: ["character", "asset"], type: "string" }, { type: "null" }],
    }) as Record<string, unknown>;
    expect("enum" in out).toBe(false);   // 顶层孤立 enum 被剥
    expect("type" in out).toBe(false);   // 父节点不带 type
    expect(out.description).toBe("想读哪类");
    expect((out.anyOf as { type: string }[])[0].type).toBe("string");
  });

  it("anyOf 节点带孤立的顶层 const → 同样剥掉", () => {
    const out = toMfjsCompliant({ const: "full", anyOf: [{ const: "full", type: "string" }, { type: "null" }] }) as Record<string, unknown>;
    expect("const" in out).toBe(false);
  });

  it("anyOf 节点：父子重复的结构关键字（additionalProperties/propertyNames/required/type）全从父节点剥掉，只留 anyOf+description（真实 foundation_write.after 形态）", () => {
    const out = toMfjsCompliant({
      type: "object",
      additionalProperties: false,
      propertyNames: { type: "string" },
      required: [],
      description: "写入内容",
      anyOf: [
        { type: "object", additionalProperties: false, propertyNames: { type: "string" } },
        { type: "null" },
      ],
    }) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(["anyOf", "description"]); // 父节点只剩这俩
    expect((out.anyOf as { type: string }[])[1].type).toBe("null");    // 分支保留
  });
});

describe("toMfjsCompliant·剥掉 MFJS 不支持的校验关键字", () => {
  it("number：剥 minimum/maximum/exclusiveMinimum/multipleOf，保留 type/description", () => {
    expect(toMfjsCompliant({ type: "integer", exclusiveMinimum: 0, maximum: 9007199254740991, description: "章号" }))
      .toEqual({ type: "integer", description: "章号" });
    expect(toMfjsCompliant({ type: "integer", minimum: 0, multipleOf: 1 })).toEqual({ type: "integer" });
  });
  it("string：剥 minLength/maxLength/pattern/format", () => {
    expect(toMfjsCompliant({ type: "string", minLength: 1, maxLength: 99, pattern: "^x", format: "email" }))
      .toEqual({ type: "string" });
  });
  it("array/object 尺寸关键字也剥", () => {
    expect(toMfjsCompliant({ type: "array", items: { type: "string" }, minItems: 1, maxItems: 5, uniqueItems: true }))
      .toEqual({ type: "array", items: { type: "string" } });
  });
  it("深层嵌套里的关键字也剥（properties→number bounds）", () => {
    const out = toMfjsCompliant({ type: "object", properties: { n: { type: "integer", minimum: 0, maximum: 10 } } }) as Record<string, unknown>;
    expect((out.properties as Record<string, { type: string }>).n).toEqual({ type: "integer" });
  });
});

describe("toMfjsCompliant·边界", () => {
  it("非对象输入原样返回，不抛", () => {
    expect(toMfjsCompliant(null)).toBe(null);
    expect(toMfjsCompliant("x")).toBe("x");
  });
  it("additionalProperties 对象递归、布尔原样", () => {
    expect((toMfjsCompliant({ type: "object", additionalProperties: { enum: ["a"] } }) as Record<string, unknown>).additionalProperties)
      .toEqual({ type: "string", enum: ["a"] });
    expect((toMfjsCompliant({ type: "object", additionalProperties: false }) as Record<string, unknown>).additionalProperties)
      .toBe(false);
  });
});
