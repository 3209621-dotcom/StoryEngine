// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CharacterMatrixCodexPanel from "./CharacterMatrixCodexPanel.js";
import type { StateOverviewCharacterMatrix, StateOverviewCharacterMatrixItem } from "../../../api/types.js";

const item = (over: Partial<StateOverviewCharacterMatrixItem>): StateOverviewCharacterMatrixItem => ({
  id: "c1",
  name: "苏晴",
  role: "主要盟友",
  appearanceAnchors: [],
  relationshipDynamics: [],
  behaviorBoundaries: [],
  cannotDo: [],
  cannotReveal: [],
  speechSamples: [],
  knownFacts: [],
  unknownTruths: [],
  protectedSecrets: [],
  forbiddenReveals: [],
  carriedAssets: [],
  ownedAssets: [],
  plotCriticalAssets: [],
  relationships: [],
  riskReminders: [],
  ...over,
});

const matrix: StateOverviewCharacterMatrix = {
  available: true,
  characters: [
    item({
      id: "p1",
      name: "林越",
      role: "主角",
      currentGoal: "找回失踪的妹妹",
      knownFacts: ["公司账目被人动过"],
      unknownTruths: ["真正的内鬼是合伙人"],
    }),
    item({
      id: "c1",
      name: "苏晴",
      role: "主要盟友",
      currentGoal: "保护证据不被销毁",
      knownFacts: ["林越在查账目"],
      unknownTruths: ["林越怀疑合伙人"],
    }),
  ],
  relationships: [
    {
      targetCharacterId: "c1",
      targetName: "苏晴",
      relationType: "盟友",
      attitude: "信任",
      trustLevel: "high",
      trustPercent: 85,
      lastChangedChapter: 3,
    },
  ],
  riskReminders: [],
};

describe("CharacterMatrixCodexPanel · 精简版(对标 inkos)", () => {
  it("主角卡列出当前/已知/未知，并把全部 relationships 渲成「对象 · 类型 · 第N章」", () => {
    const { container } = render(<CharacterMatrixCodexPanel matrix={matrix} />);
    const text = container.textContent ?? "";
    expect(text).toContain("找回失踪的妹妹"); // 当前 = currentGoal
    expect(text).toContain("公司账目被人动过"); // 已知 = knownFacts
    expect(text).toContain("真正的内鬼是合伙人"); // 未知 = unknownTruths
    expect(text).toContain("苏晴 · 盟友 · 第 3 章"); // 关系行（主角→目标）
  });

  it("非主角卡把「主角→自己」的关系渲成「主角名 · 类型 · 第N章」", () => {
    const { container } = render(<CharacterMatrixCodexPanel matrix={matrix} />);
    expect(container.textContent ?? "").toContain("林越 · 盟友 · 第 3 章");
  });

  it("主角卡视觉高亮（.matrix-char-card.pro）", () => {
    const { container } = render(<CharacterMatrixCodexPanel matrix={matrix} />);
    const pro = container.querySelectorAll(".matrix-char-card.pro");
    expect(pro.length).toBe(1);
    expect(pro[0]?.textContent ?? "").toContain("林越");
  });

  it("不再渲染职能列 / 信任度百分比 / 账本时效提示等冗余", () => {
    const { container } = render(
      <CharacterMatrixCodexPanel matrix={matrix} projectPath="x" currentChapter={20} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("职能");
    expect(text).not.toContain("85%"); // 旧关系账本的信任度进度条
    expect(text).not.toContain("自动跟进刷新"); // 旧账本时效提示
    expect(text).not.toContain("关系红线"); // 旧关系账本字段
    expect(text).not.toContain("情感债"); // 旧关系账本字段
  });

  it("关系网仍渲染（CharacterForceGraph）", () => {
    const { container } = render(<CharacterMatrixCodexPanel matrix={matrix} />);
    expect(container.querySelector(".graph-wrap")).toBeTruthy();
  });

  it("protagonistName 指定时按名字高亮主角，不被职能描述含「主角」二字的配角骗", () => {
    // 真主角林远的 role 是叙事岗位长描述（不含「主角」字样）；配角沈砚的描述里含「作为主角的竞争对手」。
    const tricky: StateOverviewCharacterMatrix = {
      available: true,
      characters: [
        item({ id: "p", name: "林远", role: "故事核心视点与主线推动者：欲望构成情节引擎", currentGoal: "查清身世" }),
        item({ id: "x", name: "沈砚", role: "商业劲敌：作为主角的主要竞争对手", currentGoal: "打压对手" }),
      ],
      relationships: [
        { targetCharacterId: "x", targetName: "沈砚", relationType: "对手", attitude: "敌对", trustLevel: "low", trustPercent: 25, lastChangedChapter: 5 },
      ],
      riskReminders: [],
    };
    const { container } = render(<CharacterMatrixCodexPanel matrix={tricky} protagonistName="林远" />);
    const pro = container.querySelectorAll(".matrix-char-card.pro");
    expect(pro.length).toBe(1);
    // 高亮的那张卡名字是林远（沈砚虽出现在主角的关系行里，但不该是被高亮的那张卡）。
    expect(pro[0]?.querySelector(".mcc-name")?.textContent).toBe("林远");
  });

  it("characters 为空时显空态", () => {
    const empty: StateOverviewCharacterMatrix = {
      available: true,
      characters: [],
      relationships: [],
      riskReminders: [],
    };
    const { container } = render(<CharacterMatrixCodexPanel matrix={empty} />);
    expect(container.textContent ?? "").toContain("还没有角色关系");
  });
});
