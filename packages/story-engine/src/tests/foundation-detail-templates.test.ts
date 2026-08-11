import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFoundationCompleteness } from "../foundation-completeness.js";
import { createStoryProject, toSafeCharacterId } from "../project-store.js";
import { buildPostChapterChangePlan } from "../post-chapter-change-plan.js";

describe("Foundation Detail Templates V0", () => {
  it("detects missing detail templates before writing", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-engine-foundation-detail-"));
    const { projectDir } = await createStoryProject({
      rootDir,
      title: "模板缺失测试",
      genre: "urban",
      premise: "普通人进入城市英灵体系。",
      mainCharacterName: "林序",
    });

    const report = await checkFoundationCompleteness(projectDir);

    expect(report.passed).toBe(false);
    expect(report.readinessLevel).toBe("high_risk");
    expect(report.missingItems).toEqual(expect.arrayContaining([
      "主角年龄",
      "主角说话风格样本",
      "初始地点空间结构",
      "资产账本",
    ]));
  });

  it("passes when character, location, asset, and reveal details are present", async () => {
    const projectDir = await createDetailedProject();

    const report = await checkFoundationCompleteness(projectDir);

    expect(report).toMatchObject({
      passed: true,
      readinessLevel: "ready",
      missingItems: [],
    });
  });

  it("builds a post-chapter change plan without writing formal state", () => {
    const plan = buildPostChapterChangePlan({
      draftBody: "林序发现申请表发热。他开始怀疑财团窗口，但只是确认手机仍然欠费。",
      knownAssetIds: ["asset-half-form", "asset-phone"],
    });

    expect(plan.knowledgeChanges[0]).toMatchObject({
      targetId: "protagonist",
      requiresUserConfirm: true,
    });
    expect(plan.assetChanges).toEqual([]);
  });
});

async function createDetailedProject(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "story-engine-foundation-ready-"));
  const { projectDir } = await createStoryProject({
    rootDir,
    title: "海天魂钢",
    genre: "都市英灵",
    premise: "林序在毕业失败当天第一次接触魂钢异常反应。",
    mainCharacterName: "林序",
  });
  const characterId = toSafeCharacterId("林序");
  await Promise.all([
    writeJson(projectDir, "story/bible.json", {
      version: "v0",
      projectLogline: "林序在毕业失败当天第一次接触魂钢异常反应。",
      premise: "林序在毕业失败当天第一次接触魂钢异常反应。",
      genre: "都市英灵",
      subgenres: [],
      readerPromise: "普通人从底层起步，逐步看懂魂钢城市规则。",
      longFormGoals: ["查清魂钢申请异常"],
      centralConflicts: ["财团垄断魂钢申请渠道"],
      coreMysteries: ["魂钢真实来源"],
      forbiddenChanges: ["不要让主角突然开挂"],
      canonFacts: [],
      openQuestions: [],
      protectedSecrets: ["魂钢真实来源"],
      setupAssets: { initialAssets: ["欠费手机"], keyItems: ["半张魂钢申请表"], resourceLimits: ["手机欠费"] },
      firstChapterSetup: { goal: "毕业失败当天第一次接触魂钢异常反应", openingScene: "海天市旧城区创业孵化楼" },
    }),
    writeJson(projectDir, "story/writing-rules.json", {
      version: "v0",
      narrativePerspective: "第三人称有限视角",
      proseStyle: ["克制"],
      chapterLength: { targetWords: 1800 },
      genreRequirements: [],
      suspenseRules: [],
      payoffRules: [],
      reversalRules: [],
      readerExperienceRules: ["普通人稳步确认规则"],
      forbiddenContent: ["不要提前揭开魂钢真实来源"],
      doNotDo: ["不要开挂"],
    }),
    writeJson(projectDir, "story/character-bible.json", {
      version: "v0",
      characters: [{
        id: characterId,
        name: "林序",
        role: "主角",
        age: "22岁",
        identity: "普通毕业生",
        desire: "拿到公平觉醒机会",
        behaviorBoundaries: ["不能突然开挂"],
        knowledgeKnown: ["魂钢影响阶层"],
        knowledgeUnknown: ["魂钢真实来源"],
        speechStyle: "克制，先问规则。",
        speechSamples: ["规则写在哪儿？"],
      }],
    }),
    writeJson(projectDir, "story/world-bible.json", {
      version: "v0",
      rules: ["创业魂钢决定城市阶层"],
      factions: [],
      powerOrSurvivalSystems: ["创业魂钢"],
      historyFacts: [],
      socialOrder: ["财团掌握申请渠道"],
    }),
    writeJson(projectDir, "story/location-bible.json", {
      version: "v0",
      locations: [{
        id: "loc-incubator",
        name: "海天市旧城区创业孵化楼",
        type: "opening",
        spatialStructure: { floors: ["1楼大厅", "2楼申请窗口"], rooms: ["申请窗口"], entrances: ["正门"], exits: ["楼梯间"] },
        knownFeatures: ["老旧办公楼"],
        risks: ["检测设备受财团监控"],
        resources: ["公共查询终端"],
        travelRules: [{ targetLocation: "旧城区公交站", method: "walk", durationMinutes: 6 }],
      }],
    }),
    writeJson(projectDir, "story/assets.json", {
      version: "v0",
      assets: [{ id: "asset-phone", name: "欠费手机", type: "keyItem", ownerCharacterId: characterId, carriedByCharacterId: characterId, status: "locked", isPlotCritical: true, canAiModify: false }],
      containers: [],
    }),
  ]);
  return projectDir;
}

async function writeJson(projectDir: string, relativePath: string, value: unknown): Promise<void> {
  await writeFile(join(projectDir, relativePath), `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
