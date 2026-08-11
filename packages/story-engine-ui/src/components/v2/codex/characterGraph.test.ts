import { describe, expect, it } from "vitest";
import { buildCharacterGraphModel, type GraphCharacterInput, type GraphRelationshipInput } from "./characterGraph.js";

const chars: GraphCharacterInput[] = [
  { id: "p", name: "林远", role: "主角" },
  { id: "a", name: "周伯庸", role: "财务负责人" },
  { id: "b", name: "林晚舟", role: "配角" },
];

describe("buildCharacterGraphModel", () => {
  it("主角居中、其余环绕；节点数 = 角色数", () => {
    const m = buildCharacterGraphModel(chars, []);
    expect(m.nodes).toHaveLength(3);
    const pro = m.nodes.find((n) => n.id === "p");
    expect(pro?.isProtagonist).toBe(true);
    expect(pro?.x).toBe(m.width / 2);
    expect(pro?.y).toBe(m.height / 2);
    // 非主角不在正中
    expect(m.nodes.filter((n) => n.x === m.width / 2 && n.y === m.height / 2)).toHaveLength(1);
  });

  it("关系按 targetName 解析端点：主角→目标，信任度配色映射", () => {
    const rels: GraphRelationshipInput[] = [
      { targetName: "周伯庸", relationType: "雇佣", trustLevel: "high" },
      { targetName: "林晚舟", relationType: "敌对", trustLevel: "low" },
    ];
    const m = buildCharacterGraphModel(chars, rels);
    expect(m.edges).toHaveLength(2);
    expect(m.edges[0]).toMatchObject({ trustClass: "trust-high", label: "雇佣" });
    expect(m.edges[1]).toMatchObject({ trustClass: "trust-low", label: "敌对" });
    // 起点都是主角中心
    expect(m.edges[0].x1).toBe(m.width / 2);
  });

  it("按 targetCharacterId 也能解析；缺信任度→trust-mid；label 回落 attitude", () => {
    const m = buildCharacterGraphModel(chars, [{ targetCharacterId: "a", attitude: "提防" }]);
    expect(m.edges).toHaveLength(1);
    expect(m.edges[0]).toMatchObject({ trustClass: "trust-mid", label: "提防" });
  });

  it("pairFrom 覆盖起点为指定角色", () => {
    const m = buildCharacterGraphModel(chars, [{ pairFrom: "周伯庸", targetName: "林晚舟", relationType: "旧识" }]);
    const a = m.nodes.find((n) => n.id === "a")!;
    expect(m.edges[0].x1).toBe(a.x);
    expect(m.edges[0].y1).toBe(a.y);
  });

  it("目标解析不到 / 自指 → 跳过该连线，不崩", () => {
    const m = buildCharacterGraphModel(chars, [
      { targetName: "查无此人" },          // 解析不到
      { pairFrom: "林远", targetName: "林远" }, // 自指（同一点）
    ]);
    expect(m.edges).toHaveLength(0);
  });

  it("label 超 6 字截断", () => {
    const m = buildCharacterGraphModel(chars, [{ targetName: "周伯庸", relationType: "非常复杂纠缠的关系" }]);
    expect(m.edges[0].label.length).toBeLessThanOrEqual(6);
  });

  it("protagonistName 指定时按名字定主角，不被描述里含「主角」二字的配角骗", () => {
    // 真主角林远的职能段是「叙事岗位」长描述、不含「主角」二字；配角沈砚的描述里含「作为主角的竞争对手」。
    const tricky: GraphCharacterInput[] = [
      { id: "p", name: "林远", role: "故事核心视点与主线推动者：欲望与选择构成情节引擎" },
      { id: "x", name: "沈砚", role: "商业劲敌：作为主角的主要竞争对手，不断施压" },
    ];
    const m = buildCharacterGraphModel(tricky, [], undefined, "林远");
    const pros = m.nodes.filter((n) => n.isProtagonist);
    expect(pros).toHaveLength(1);
    expect(pros[0]?.id).toBe("p");
    // 林远居中
    const pro = m.nodes.find((n) => n.id === "p");
    expect(pro?.x).toBe(m.width / 2);
    expect(pro?.y).toBe(m.height / 2);
  });
});
