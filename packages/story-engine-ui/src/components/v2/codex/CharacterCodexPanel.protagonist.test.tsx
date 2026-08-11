// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CharacterCodexPanel from "./CharacterCodexPanel.js";
import type { StateOverviewCharacterMatrix, StateOverviewCharacterMatrixItem } from "../../../api/types.js";
import type { AssetSummary, LocationStatus, ProtagonistStatus, SidebarData } from "../../../types.js";

const charItem = (over: Partial<StateOverviewCharacterMatrixItem>): StateOverviewCharacterMatrixItem => ({
  id: "c1",
  name: "未命名",
  role: "配角",
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

const assets: AssetSummary = {
  carriedItems: [], availableAssets: [], unavailableAssets: [], resources: [],
  properties: [], containers: [], plotCriticalItems: [], assetRules: [],
};
const location: LocationStatus = {
  currentLocation: "", transitionStatus: "unknown", floors: [], rooms: [],
  entrances: [], exits: [], resources: [], fixedFacts: [], risks: [],
  nearbyLocations: [], travelRules: [],
};
const sidebar: SidebarData = {
  storySettings: [], writingRules: [], characters: [], locations: [],
  assets: [], hooks: [], arcGoals: [],
};
const protagonist: ProtagonistStatus = {
  name: "林远", identity: "刚毕业的大学生", currentGoal: "查清身世",
  physicalState: [], mentalState: [], resourceState: [], currentSituation: "",
  boundaries: [], cannotDo: [], speechSamples: [],
};

// 真主角林远：role 是「叙事岗位」长描述、不含「主角」二字；extraFields 既有做厚结构化字段(内核人格)又有真·自定义字段(星座)。
// 配角沈砚：role 描述里含「作为主角的竞争对手」——旧 /主角/ 正则会误判它为主角。
const matrix: StateOverviewCharacterMatrix = {
  available: true,
  characters: [
    charItem({
      id: "p", name: "林远",
      role: "故事核心视点与主线推动者：欲望与选择构成情节引擎，是全书悬念的第一承载点。",
      identity: "刚毕业的大学生",
      extraFields: { 内核人格: "一个被欲望冲昏头脑的青年", 星座: "天蝎座" },
    }),
    charItem({
      id: "x", name: "沈砚",
      role: "商业劲敌：作为主角的主要竞争对手，不断施压。",
    }),
  ],
  relationships: [],
  riskReminders: [],
};

function renderPanel() {
  return render(
    <CharacterCodexPanel
      assets={assets}
      characterMatrix={matrix}
      location={location}
      protagonist={protagonist}
      sidebar={sidebar}
    />,
  );
}

describe("CharacterCodexPanel · 主角识别与自定义字段去重", () => {
  it("主角按名字定 lead（不被职能描述含「主角」二字的配角抢走）", () => {
    const { container } = renderPanel();
    const leads = container.querySelectorAll(".char.lead");
    expect(leads.length).toBe(1);
    expect(leads[0]?.querySelector("h3")?.textContent).toBe("林远");
  });

  it("主角职能 tag 显短标签「主角」，不把整段叙事岗位塞进 tag", () => {
    const { container } = renderPanel();
    const leadTag = container.querySelector(".char.lead .char-id .tag");
    expect(leadTag?.textContent).toBe("主角");
    expect(leadTag?.textContent ?? "").not.toContain("枢纽");
    expect(leadTag?.textContent ?? "").not.toContain("情节引擎");
  });

  it("配角职能 tag 取冒号前短标签「商业劲敌」", () => {
    const { container } = renderPanel();
    const cards = [...container.querySelectorAll(".char")];
    const shen = cards.find((c) => c.querySelector("h3")?.textContent === "沈砚");
    expect(shen?.querySelector(".char-id .tag")?.textContent).toBe("商业劲敌");
  });

  it("自定义字段剔除做厚已占的中文键(内核人格)、只留真·自定义(星座)，结构化段仍展示内核人格一次", () => {
    const { container } = renderPanel();
    const lead = container.querySelector(".char.lead")!;
    const cust = lead.querySelector(".cust-fields");
    expect(cust).toBeTruthy();
    // 内核人格不再作为「自定义字段」重复出现
    expect(cust?.textContent ?? "").not.toContain("内核人格");
    // 真·自定义字段「星座」仍在
    expect(cust?.textContent ?? "").toContain("星座");
    expect(cust?.textContent ?? "").toContain("天蝎座");
    // 结构化三层人格里仍展示内核人格内容(来自 extraFields 兜底)一次
    expect(lead.querySelector(".ly.core")?.textContent ?? "").toContain("一个被欲望冲昏头脑的青年");
  });
});
