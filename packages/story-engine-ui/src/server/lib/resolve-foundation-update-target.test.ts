import { describe, expect, it } from "vitest";
import { resolveFoundationUpdateTargetId, type FoundationKnownEntities } from "./project-io.js";

const oneChar: FoundationKnownEntities = {
  characters: [{ id: "char-guoxu", name: "林远" }],
  locations: [],
  assets: [],
};
const twoChars: FoundationKnownEntities = {
  characters: [{ id: "char-guoxu", name: "林远" }, { id: "char-lin", name: "林晚" }],
  locations: [],
  assets: [],
};

describe("resolveFoundationUpdateTargetId", () => {
  it("模型给了显式 targetId → 原样采用", () => {
    expect(resolveFoundationUpdateTargetId({
      actionType: "update_character_detail",
      targetId: "char-explicit",
      knownEntities: oneChar,
    })).toBe("char-explicit");
  });

  it("没给 targetId 但 targetName 命中已知角色 → 按名解析", () => {
    expect(resolveFoundationUpdateTargetId({
      actionType: "update_character_detail",
      targetName: "林远",
      knownEntities: twoChars,
    })).toBe("char-guoxu");
  });

  it("没 targetId 也没名字、全书只有一个角色 → 兜底落到唯一角色（治『没能找到对应角色』吓人失败）", () => {
    expect(resolveFoundationUpdateTargetId({
      actionType: "update_character_detail",
      knownEntities: oneChar,
    })).toBe("char-guoxu");
  });

  it("没 targetId 没名字、有多个角色（歧义）→ 不兜底，返回 undefined（让引擎诚实跳过，绝不赌着写错卡）", () => {
    expect(resolveFoundationUpdateTargetId({
      actionType: "update_character_detail",
      knownEntities: twoChars,
    })).toBeUndefined();
  });

  it("名字给了但不匹配任何角色、且多个角色 → undefined（疑似另一个/新角色，诚实跳过）", () => {
    expect(resolveFoundationUpdateTargetId({
      actionType: "update_character_detail",
      targetName: "女主",
      knownEntities: twoChars,
    })).toBeUndefined();
  });

  it("名字给了但不匹配、即使全书只有一个角色 → 也不兜底（给了名字=指别人，绝不写到主角身上）", () => {
    expect(resolveFoundationUpdateTargetId({
      actionType: "update_character_detail",
      targetName: "不存在的人",
      knownEntities: oneChar,
    })).toBeUndefined();
  });

  it("唯一地点 / 唯一资产 的更新同样兜底", () => {
    const known: FoundationKnownEntities = {
      characters: [],
      locations: [{ id: "loc-1", name: "出租屋" }],
      assets: [{ id: "asset-1", name: "旧手机" }],
    };
    expect(resolveFoundationUpdateTargetId({ actionType: "update_location_detail", knownEntities: known })).toBe("loc-1");
    expect(resolveFoundationUpdateTargetId({ actionType: "update_asset_status", knownEntities: known })).toBe("asset-1");
  });

  it("create_character / delete 等非更新类 → 不兜底（避免把新建/删除误投到唯一实体）", () => {
    expect(resolveFoundationUpdateTargetId({ actionType: "create_character", knownEntities: oneChar })).toBeUndefined();
    expect(resolveFoundationUpdateTargetId({ actionType: "delete_foundation_entry", knownEntities: oneChar })).toBeUndefined();
  });

  it("空书（一个实体都没有）→ undefined", () => {
    expect(resolveFoundationUpdateTargetId({
      actionType: "update_character_detail",
      knownEntities: { characters: [], locations: [], assets: [] },
    })).toBeUndefined();
  });
});
