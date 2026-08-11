import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildWriterContext,
  type ArcGoalsContext,
  type StoryContinuityContext,
  type StoryThreadsContext,
} from "../context-gateway.js";
import { checkDraftContinuity } from "../continuity-quality-check.js";
import { createStoryProject } from "../project-store.js";

describe("Reference Matching Calibration V1 Regression", () => {
  it("keeps targeted stable false positives fixed", () => {
    const fixtures = [
      {
        id: "ch8-open-thread-garage-water",
        warningType: "open_threads_not_referenced",
        input: {
          draftContent: "林澈进入地下车库后一路摸到北墙，终于看见消防水箱。他蹲下来检查阀门，确认水箱里还有水，开始接水。",
          continuity: emptyContinuity(),
          storyThreads: fixtureStoryThreads({
            openLeads: [leadThread("lead-garage-water", "地下车库通道与水源", ["水箱在地下车库北墙，可能有饮用水。"])],
          }),
          chapter: 8,
        },
      },
      {
        id: "ch6-arc-emergency-medicine",
        warningType: "arc_goals_not_referenced",
        input: {
          draftContent: "林澈说自己要去药店，先弄到药品和绷带，再找机会带回抗生素。",
          continuity: emptyContinuity(),
          arcGoals: fixtureArcGoals({
            activeGoals: [arcGoal("arc-medicine", "获取急救药品", ["药店里可能还有抗生素和绷带。"])],
          }),
          chapter: 6,
        },
      },
      {
        id: "ch7-arc-garage-search",
        warningType: "arc_goals_not_referenced",
        input: {
          draftContent: "林澈放轻脚步踏进地下车库，准备搜索地下车库的出口和安全路线。",
          continuity: emptyContinuity(),
          arcGoals: fixtureArcGoals({
            activeGoals: [arcGoal("arc-garage", "搜索地下车库", ["地下车库可能有通往街背后的出口。"])],
          }),
          chapter: 7,
        },
      },
      {
        id: "ch2-recent-door-threat",
        warningType: "recent_events_not_referenced",
        input: {
          draftContent: "脚步声没有继续，也没有离开。片刻后，门外又响起指甲刮过墙面的声音，从楼道尽头慢慢拖过去。",
          continuity: {
            ...emptyContinuity(),
            recentEvents: ["门外异常脚步停在楼道里，林澈不敢开门。"],
            recentCharacters: ["林澈"],
          },
          chapter: 2,
        },
      },
      {
        id: "ch8-recent-corpse-stain-garage-sound",
        warningType: "recent_events_not_referenced",
        input: {
          draftContent: "他想起楼道上那滩暗色污渍和单元门上的尸体。就在他准备离开时，车库深处忽然传来一声响动，他举起打火机继续调查。",
          continuity: {
            ...emptyContinuity(),
            recentEvents: ["楼道尸体和暗色污渍说明有人拖过受伤的东西。"],
            recentCharacters: ["林澈"],
          },
          chapter: 8,
        },
      },
    ];

    for (const fixture of fixtures) {
      const report = checkDraftContinuity(fixture.input);
      expect(
        report.issues.some((issue) => issue.type === fixture.warningType),
        fixture.id,
      ).toBe(false);
    }
  });

  it("keeps counter fixtures safe", () => {
    const fixtures = [
      {
        id: "counter-water-mention-only",
        warningType: "open_threads_not_referenced",
        input: {
          draftContent: "林澈看了一眼桌上的水，没有出门，也没有检查水箱，只是把杯子放回原处。",
          continuity: emptyContinuity(),
          storyThreads: fixtureStoryThreads({
            openLeads: [leadThread("lead-water", "找到稳定水源", ["检查水箱并取水。"])],
          }),
          chapter: 8,
        },
      },
      {
        id: "counter-pharmacy-background-only",
        warningType: "open_threads_not_referenced",
        input: {
          draftContent: "窗外街角能看见药店的招牌，但林澈没有过去，只是关上窗帘。",
          continuity: emptyContinuity(),
          storyThreads: fixtureStoryThreads({
            openLeads: [leadThread("lead-pharmacy", "去药店找药", ["进入药店获取药品。"])],
          }),
          chapter: 8,
        },
      },
      {
        id: "counter-garage-location-only",
        warningType: "open_threads_not_referenced",
        input: {
          draftContent: "地下车库入口在楼下，但他今天没有下去，只在门口停了几秒。",
          continuity: emptyContinuity(),
          storyThreads: fixtureStoryThreads({
            openLeads: [leadThread("lead-garage", "搜索地下车库", ["搜索地下车库出口和安全路线。"])],
          }),
          chapter: 8,
        },
      },
      {
        id: "counter-corpse-memory-only",
        warningType: "recent_events_not_referenced",
        input: {
          draftContent: "他忽然想起那具尸体和血迹，随后把念头压下，继续坐在屋里发呆。",
          continuity: {
            ...emptyContinuity(),
            recentEvents: ["楼道尸体和血迹需要继续调查。"],
            recentCharacters: ["林澈"],
          },
          chapter: 8,
        },
      },
    ];

    for (const fixture of fixtures) {
      const report = checkDraftContinuity(fixture.input);
      expect(
        report.issues.some((issue) => issue.type === fixture.warningType),
        fixture.id,
      ).toBe(true);
    }
  });

  it("never emits an apocalypse_progression section for cultivation context boundaries", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-engine-xianxia-boundary-"));
    const { projectDir } = await createStoryProject({
      rootDir,
      title: "Cultivation Boundary Fixture",
      genre: "修仙",
      premise: "林远在外院园圃查账册线索。",
      mainCharacterName: "林远",
    });
    const context = await buildWriterContext({
      projectDir,
      chapter: 2,
      chapterGoal: "继续查库房账册。",
    });

    expect(context.sections.some((section) => section.name === "apocalypse_progression")).toBe(false);
  });
});

function emptyContinuity(): StoryContinuityContext {
  return {
    recentEvents: [],
    openLeads: [],
    activeConflicts: [],
    discoveries: [],
    recentLocations: [],
    recentCharacters: [],
    carryForwardInstruction: "暂无前情承接要求。",
  };
}

function fixtureStoryThreads(input: Partial<StoryThreadsContext>): StoryThreadsContext {
  return {
    openLeads: [],
    openIntents: [],
    recentlyTouchedThreads: [],
    staleThreadWarnings: [],
    threadCarryForwardInstruction: "",
    ...input,
  };
}

function fixtureArcGoals(input: Partial<ArcGoalsContext>): ArcGoalsContext {
  return {
    activeGoals: [],
    recentlyTouchedGoals: [],
    staleGoalWarnings: [],
    arcCarryForwardInstruction: "",
    ...input,
  };
}

function leadThread(id: string, title: string, evidence: readonly string[]): StoryThreadsContext["openLeads"][number] {
  return {
    id,
    type: "lead",
    title,
    status: "open",
    lastTouchedChapter: 7,
    evidence,
    relatedLocations: [],
    relatedCharacters: [],
  };
}

function arcGoal(id: string, title: string, evidence: readonly string[]): ArcGoalsContext["activeGoals"][number] {
  return {
    id,
    title,
    status: "active",
    scope: "mini_arc",
    lastTouchedChapter: 7,
    evidence,
    relatedHooks: [],
    relatedThreads: [],
    relatedLocations: [],
    relatedCharacters: [],
  };
}
