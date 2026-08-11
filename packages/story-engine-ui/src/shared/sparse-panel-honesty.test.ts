import { describe, expect, it } from "vitest";
import {
  filterPlaceholderUiValues,
  filterSystemStoryMeta,
  isAntiAiPrefixedRule,
  isPlaceholderUiValue,
  isSystemStoryMetaSentence,
  partitionAntiAiPrefixedRules,
  sanitizeBookStyleRuleLines,
  splitLongRuleValueForDisplay,
  SYSTEM_STORY_META_SENTENCES,
} from "./sparse-panel-honesty.js";

describe("sparse-panel-honesty · 占位不计真实条目", () => {
  it("识别「尚未配置…」占位槽", () => {
    expect(isPlaceholderUiValue("尚未配置随身物品")).toBe(true);
    expect(isPlaceholderUiValue("尚未配置当前地点")).toBe(true);
    expect(isPlaceholderUiValue("待配置")).toBe(true);
    expect(isPlaceholderUiValue("黑色双肩包")).toBe(false);
  });

  it("filterPlaceholderUiValues 丢掉占位、保留真条目", () => {
    expect(filterPlaceholderUiValues([
      "尚未配置随身物品",
      "旧铜哨",
      "尚未配置可用资产",
    ])).toEqual(["旧铜哨"]);
  });
});

describe("sparse-panel-honesty · 系统元话术", () => {
  it("常量起步就含审计那句", () => {
    expect(SYSTEM_STORY_META_SENTENCES).toContain("正式事实只能通过确认提交更新。");
  });

  it("识别裸句与「禁止提前揭开：」包装", () => {
    expect(isSystemStoryMetaSentence("正式事实只能通过确认提交更新。")).toBe(true);
    expect(isSystemStoryMetaSentence("禁止提前揭开：正式事实只能通过确认提交更新。")).toBe(true);
    expect(isSystemStoryMetaSentence("资源受集团控制")).toBe(false);
  });

  it("filterSystemStoryMeta 滤掉元话术", () => {
    expect(filterSystemStoryMeta([
      "正式事实只能通过确认提交更新。",
      "资源受集团控制",
      "禁止提前揭开：正式事实只能通过确认提交更新。",
    ])).toEqual(["资源受集团控制"]);
  });
});

describe("sparse-panel-honesty · 写作规则做厚清洗", () => {
  it("剥「反AI·」前缀、按句拆条、超长截断到 ≤40", () => {
    const cleaned = sanitizeBookStyleRuleLines([
      "反AI·鼓励角色内部感知驱动叙事：AI容易直接描述场景气氛，但本书应写角色此刻身体与念头如何推动下一步；另外再灌一大段无用的通用条款用来把字数撑得很长很长很长很长很长",
      "沉浸感官：落视觉嗅觉",
    ]);
    expect(cleaned.every((s) => s.length <= 40)).toBe(true);
    expect(cleaned.some((s) => s.includes("反AI"))).toBe(false);
    expect(cleaned.some((s) => s.includes("沉浸感官") || s.includes("落视觉嗅觉"))).toBe(true);
  });

  it("partitionAntiAiPrefixedRules 把反AI·条目拆到 antiAi", () => {
    const { kept, antiAi } = partitionAntiAiPrefixedRules([
      "沉浸",
      "反AI·禁排比抒情：别用排比堆字数",
      "状态感知",
    ]);
    expect(kept).toEqual(["沉浸", "状态感知"]);
    expect(antiAi).toHaveLength(1);
    expect(isAntiAiPrefixedRule(antiAi[0]!)).toBe(true);
  });

  it("splitLongRuleValueForDisplay：含分号或超 60 字拆成列表", () => {
    expect(splitLongRuleValueForDisplay("甲；乙；丙")).toEqual(["甲", "乙", "丙"]);
    expect(splitLongRuleValueForDisplay("短句")).toEqual(["短句"]);
  });
});
