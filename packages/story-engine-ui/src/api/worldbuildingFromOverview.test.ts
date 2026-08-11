import { describe, it, expect } from "vitest";
import { worldbuildingFromWorldBible } from "./worldbuildingFromOverview.js";
import type { StateOverviewWorldBibleSummary } from "./types.js";

const engine: StateOverviewWorldBibleSummary = {
  available: true,
  ruleCount: 6,
  factionCount: 2,
  systemCount: 1,
  keyRules: ["资源受集团控制", "越界者被清除"],
  keyFactions: ["郭氏集团", "监管会"],
  resourceRules: ["核心资源稀缺"],
  authorityRules: ["集团董事会"],
  socialOrder: ["顶层：林远", "底层：打工人"],
  conflictSources: ["继承权之争"],
  fixedFacts: ["林远是千亿富豪"],
  protectedSecrets: [],
  publicFacts: [],
  hiddenFacts: [],
  forbiddenRuleBreaks: [],
};

describe("worldbuildingFromWorldBible", () => {
  it("把 available 的引擎世界观 summary 映射成 WorldbuildingData", () => {
    const w = worldbuildingFromWorldBible(engine);
    expect(w).not.toBeNull();
    expect(w!.rules.map((r) => r.detail)).toContain("资源受集团控制");
    expect(w!.rules.some((r) => r.name === "固定事实" && r.detail === "林远是千亿富豪")).toBe(true);
    expect(w!.socialStructure).toContain("顶层：林远");
    expect(w!.forces.map((f) => f.name)).toContain("郭氏集团");
    expect(w!.conflictSources).toContain("继承权之争");
    expect(w!.overview.oneLine.length).toBeGreaterThan(0);
  });

  it("available:false 时返回 null", () => {
    expect(worldbuildingFromWorldBible({ ...engine, available: false })).toBeNull();
  });

  it("所有来源数组皆空时返回 null（不造假）", () => {
    expect(
      worldbuildingFromWorldBible({
        available: true,
        ruleCount: 0,
        factionCount: 0,
        systemCount: 0,
        keyRules: [],
        keyFactions: [],
        socialOrder: [],
        conflictSources: [],
        fixedFacts: [],
      }),
    ).toBeNull();
  });

  it("undefined 输入返回 null", () => {
    expect(worldbuildingFromWorldBible(undefined)).toBeNull();
  });

  it("仅含系统元话术法则时返回 null（不当故事法则）", () => {
    expect(
      worldbuildingFromWorldBible({
        available: true,
        ruleCount: 1,
        factionCount: 0,
        systemCount: 0,
        keyRules: ["正式事实只能通过确认提交更新。"],
        keyFactions: [],
        socialOrder: [],
        conflictSources: [],
        fixedFacts: [],
      }),
    ).toBeNull();
  });

  it("混有真实法则时过滤掉系统元话术", () => {
    const w = worldbuildingFromWorldBible({
      ...engine,
      keyRules: ["正式事实只能通过确认提交更新。", "资源受集团控制"],
    });
    expect(w).not.toBeNull();
    expect(w!.rules.map((r) => r.detail)).toEqual(["资源受集团控制", "林远是千亿富豪"]);
    expect(w!.overview.oneLine).toBe("资源受集团控制");
  });
});
