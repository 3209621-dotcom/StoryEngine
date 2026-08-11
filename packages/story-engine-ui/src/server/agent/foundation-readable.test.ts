// @vitest-environment node
//
// foundation-readable 纯逻辑单测：把引擎资料结构转成「中文可复述」形态——
// 键换中文标签、已知英文枚举值换中文、丢内部噪音键，用户中文内容原样透传。
import { describe, expect, it } from "vitest";

import { localizeFoundationForReading, readinessLevelLabel } from "./foundation-readable.js";

describe("localizeFoundationForReading", () => {
  it("角色册条目：英文键换中文标签，中文值原样", () => {
    const out = localizeFoundationForReading({
      id: "char-ffe5af",
      name: "林远",
      role: "主角",
      identity: "刚毕业的大学生，家境贫寒",
      personalityBaseline: ["吃苦耐劳", "心思细"],
    }) as Record<string, unknown>;
    expect(out["名称"]).toBe("林远");
    expect(out["角色定位"]).toBe("主角");
    expect(out["身份"]).toBe("刚毕业的大学生，家境贫寒");
    expect(out["性格基线"]).toEqual(["吃苦耐劳", "心思细"]);
  });

  it("丢弃内部/技术键（version/canAiModify/跨引用 id 不复述给用户）", () => {
    const out = localizeFoundationForReading({
      characterId: "char-1",
      version: "v0",
      canAiModify: true,
      locationId: "loc-9", // 指向别的实体的 id 引用，slug 无复述价值
      name: "李慧",
    }) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(["名称"]);
    expect(out["名称"]).toBe("李慧");
  });

  it("实体自身的 id 保留为「资料编号」（agent 改名/删除要拿它当 targetId）", () => {
    const out = localizeFoundationForReading({ id: "char-ffe5af", name: "林远" }) as Record<string, unknown>;
    expect(out["资料编号"]).toBe("char-ffe5af");
    expect(Object.keys(out)).not.toContain("id");
  });

  it("已知英文枚举值换中文：trustLevel high→高、socialEnergy low→低", () => {
    const out = localizeFoundationForReading({ trustLevel: "high", socialEnergy: "low" }) as Record<string, unknown>;
    expect(out["信任度"]).toBe("高");
    expect(out["社交能量"]).toBe("低");
  });

  it("信任度是中文自由值时原样透传（不误伤）", () => {
    const out = localizeFoundationForReading({ trustLevel: "（留空待确认）" }) as Record<string, unknown>;
    expect(out["信任度"]).toBe("（留空待确认）");
  });

  it("资产：type/status 英文枚举换中文，容器键 assets→物品", () => {
    const out = localizeFoundationForReading({
      assets: [{ id: "a1", name: "青铜钥匙", type: "keyItem", status: "available", quantity: 1 }],
      containers: [],
    }) as Record<string, ReadonlyArray<Record<string, unknown>>>;
    const item = out["物品"][0];
    expect(item["名称"]).toBe("青铜钥匙");
    expect(item["类型"]).toBe("关键物品");
    expect(item["状态"]).toBe("可用");
    expect(item["数量"]).toBe(1);
    expect("id" in item).toBe(false);
  });

  it("地点：中文 type 不被资产枚举误伤，travel method walk→步行", () => {
    const out = localizeFoundationForReading({
      locations: [{
        id: "loc-hall",
        name: "中庭大厅",
        type: "室内",
        travelRules: [{ targetLocation: "门口", method: "walk", durationMinutes: 2 }],
      }],
    }) as Record<string, ReadonlyArray<Record<string, unknown>>>;
    const loc = out["地点"][0];
    expect(loc["类型"]).toBe("室内"); // 中文自由值，原样
    const rule = (loc["通行规则"] as ReadonlyArray<Record<string, unknown>>)[0];
    expect(rule["方式"]).toBe("步行");
    expect(rule["目标地点"]).toBe("门口");
  });

  it("嵌套对象（voice/arc）的子键也换中文", () => {
    const out = localizeFoundationForReading({
      name: "林远",
      voice: { style: "克制", avoidanceTopics: ["家境"] },
      arc: { startState: "隐忍", projectedDirection: "觉醒" },
    }) as Record<string, Record<string, unknown>>;
    expect(out["语感"]["风格"]).toBe("克制");
    expect(out["语感"]["回避话题"]).toEqual(["家境"]);
    expect(out["成长弧"]["起点状态"]).toBe("隐忍");
  });

  it("extraFields 用户自定义键原样保留（不相对照、不翻）", () => {
    const out = localizeFoundationForReading({
      name: "林远",
      extraFields: { 星座: "天蝎座", 口头禅: "算了" },
    }) as Record<string, Record<string, unknown>>;
    expect(out["自定义资料"]).toEqual({ 星座: "天蝎座", 口头禅: "算了" });
  });

  it("未知英文键原样透传（不崩、不静默吞），null/基础类型原样返回", () => {
    const out = localizeFoundationForReading({ name: "林远", futureField: "值" }) as Record<string, unknown>;
    expect(out["futureField"]).toBe("值"); // 漏配的新键不丢，只是没翻
    expect(localizeFoundationForReading(null)).toBeNull();
    expect(localizeFoundationForReading("纯字符串")).toBe("纯字符串");
    expect(localizeFoundationForReading(42)).toBe(42);
  });
});

describe("readinessLevelLabel", () => {
  it("就绪等级英文枚举换中文", () => {
    expect(readinessLevelLabel("ready")).toBe("达标");
    expect(readinessLevelLabel("warning")).toBe("有风险");
    expect(readinessLevelLabel("high_risk")).toBe("高风险");
    expect(readinessLevelLabel("未知值")).toBe("未知值"); // 兜底原样
  });
});
