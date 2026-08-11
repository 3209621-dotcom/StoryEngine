import { describe, expect, it } from "vitest";

import { NO_FACTS_RELATIONSHIP_SUMMARY, convertRelationshipsToMatrixUpdates } from "./generate-character-relationships.js";

describe("空事实失败文案（R2#2·铁律④诚实不误导）", () => {
  it("指对路：开书给具名角色登记关系走 foundation_write update_character_detail 写 relationshipToProtagonist", () => {
    expect(NO_FACTS_RELATIONSHIP_SUMMARY).toContain("update_character_detail");
    expect(NO_FACTS_RELATIONSHIP_SUMMARY).toContain("relationshipToProtagonist");
  });
});

describe("convertRelationshipsToMatrixUpdates → candidate updates", () => {
  it("把 GLM 人物转成 status:candidate 的 CharacterMatrixUpdate（id/firstSeenChapter 对）", () => {
    const updates = convertRelationshipsToMatrixUpdates(
      {
        characters: [{ name: "老赵", role: "债主" }],
        relationships: [{ from: "林远", to: "老赵", relationType: "债务", trust: "low" }],
      },
      47,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: "matrix-老赵",
      name: "老赵",
      status: "candidate",
      firstSeenChapter: 47,
      lastSeenChapter: 47,
    });
  });

  it("空人物 → 空 updates（上层据此 ok:false）", () => {
    expect(
      convertRelationshipsToMatrixUpdates({ characters: [], relationships: [] }, 1),
    ).toEqual([]);
  });

  it("relationToProtagonist 取自该人物与主角的关系（主角=第一个关系的 from）", () => {
    const updates = convertRelationshipsToMatrixUpdates(
      {
        characters: [
          { name: "老赵", role: "债主" },
          { name: "阿明", role: "工友" },
        ],
        relationships: [
          { from: "林远", to: "老赵", relationType: "债务", trust: "low" },
          { from: "林远", to: "阿明", relationType: "工友", trust: "high" },
        ],
      },
      5,
    );
    const zhao = updates.find((u) => u.name === "老赵");
    const ming = updates.find((u) => u.name === "阿明");
    expect(zhao?.relationToProtagonist).toBe("债务");
    expect(ming?.relationToProtagonist).toBe("工友");
  });

  it("人物若与主角无直接关系 → relationToProtagonist 省略（不编造）", () => {
    const updates = convertRelationshipsToMatrixUpdates(
      {
        characters: [{ name: "路人甲", role: "邻居" }],
        relationships: [],
      },
      3,
    );
    expect(updates[0]?.relationToProtagonist).toBeUndefined();
  });
});

