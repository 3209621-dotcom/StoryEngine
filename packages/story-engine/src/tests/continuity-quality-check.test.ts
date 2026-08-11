import { mkdtemp, writeFile } from "node:fs/promises";
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
import type { TimelineEvent } from "../types.js";

describe("StoryEngine-NG Continuity Quality Check", () => {
  it("treats empty continuity as pass-through and avoids fake carry-forward wording", async () => {
    const projectDir = await createFixtureProject();
    const context = await buildWriterContext({
      projectDir,
      chapter: 1,
      chapterGoal: "开局。",
    });
    const continuity = context.sections.find((section) => section.name === "story_continuity")
      ?.content as StoryContinuityContext;

    expect(continuity).toMatchObject({
      recentEvents: [],
      openLeads: [],
      activeConflicts: [],
      discoveries: [],
      recentLocations: [],
      recentCharacters: [],
      carryForwardInstruction: "暂无前情承接要求。",
    });
    expect(continuity.carryForwardInstruction).not.toContain("最近事件");
    expect(continuity.carryForwardInstruction).not.toContain("上一章后果");

    const report = checkDraftContinuity({
      draftContent: "林远第一次来到外院园圃。",
      continuity,
      chapter: 1,
    });

    expect(report).toEqual({
      passed: true,
      score: 1,
      issues: [],
      matched: {
        events: [],
        leads: [],
        locations: [],
        characters: [],
        conflicts: [],
        discoveries: [],
      },
    });
  });

  it("matches characters, locations, leads, conflicts, discoveries, and recent events", () => {
    const continuity = fixtureContinuity();

    const report = checkDraftContinuity({
      draftContent: "林远在账房外贴着后墙听见异常响动，黑影留下的暗号又指向外院账本暗页。管事威胁他交出破损信物，账本暗页记录的外院账目仍在发酵。",
      continuity,
      chapter: 4,
    });

    expect(report.passed).toBe(true);
    expect(report.score).toBe(1);
    expect(report.issues).toEqual([]);
    expect(report.matched.characters).toEqual(["林远"]);
    expect(report.matched.locations).toEqual(["账房", "外院"]);
    expect(report.matched.leads).toEqual(["后墙传来异常响动，黑影暗号仍未解开。"]);
    expect(report.matched.conflicts).toEqual(["管事威胁林远交出破损信物。"]);
    expect(report.matched.discoveries).toEqual(["林远发现账本暗页记录外院账目。"]);
    expect(report.matched.events).toEqual(["林远夜入账房发现账本暗页暴露外院账目。"]);
  });

  it("warns when a draft ignores open leads but does not fail the report", () => {
    const report = checkDraftContinuity({
      draftContent: "林远在外院清点粮米，暂时没有靠近后墙。",
      continuity: {
        ...fixtureContinuity(),
        openLeads: ["禁区封条旁的暗号仍未解开。"],
      },
      chapter: 4,
    });

    expect(report.passed).toBe(true);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "warning",
        type: "open_leads_not_referenced",
      }),
    ]));
  });

  it("warns on a possible restart when no continuity anchors are matched", () => {
    const report = checkDraftContinuity({
      draftContent: "多年以后，故事开始。一个陌生少年第一次来到组织，望着天边发呆。",
      continuity: fixtureContinuity(),
      chapter: 4,
    });

    expect(report.passed).toBe(true);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "warning",
        type: "possible_restart",
      }),
    ]));
  });

  it("matches underground garage water-tank progress to an open thread by evidence", () => {
    const report = checkDraftContinuity({
      draftContent: "林澈进入地下车库后一路摸到北墙，终于看见消防水箱。他蹲下来检查阀门，确认水箱里还有水，开始接水。",
      continuity: emptyContinuity(),
      storyThreads: fixtureStoryThreads({
        openLeads: [{
          id: "lead-garage-water",
          type: "lead",
          title: "地下车库通道与水源",
          status: "open",
          lastTouchedChapter: 7,
          evidence: ["水箱在地下车库北墙，可能有饮用水。"],
          relatedLocations: [],
          relatedCharacters: [],
        }],
      }),
      chapter: 8,
    });

    expect(report.issues.some((issue) => issue.type === "open_threads_not_referenced")).toBe(false);
    expect(report.matched.leads).toEqual(["地下车库通道与水源"]);
  });

  it("matches pharmacy medicine progress to an emergency-medicine arc goal", () => {
    const report = checkDraftContinuity({
      draftContent: "林澈说自己要去药店，先弄到药品和绷带，再找机会带回抗生素。",
      continuity: emptyContinuity(),
      arcGoals: fixtureArcGoals({
        activeGoals: [{
          id: "arc-medicine",
          title: "获取急救药品",
          status: "active",
          scope: "mini_arc",
          lastTouchedChapter: 5,
          evidence: ["药店里可能还有抗生素和绷带。"],
          relatedHooks: [],
          relatedThreads: [],
          relatedLocations: [],
          relatedCharacters: [],
        }],
      }),
      chapter: 6,
    });

    expect(report.issues.some((issue) => issue.type === "arc_goals_not_referenced")).toBe(false);
  });

  it("matches underground garage search progress to a garage arc goal", () => {
    const report = checkDraftContinuity({
      draftContent: "林澈放轻脚步踏进地下车库，准备搜索地下车库的出口和安全路线。",
      continuity: emptyContinuity(),
      arcGoals: fixtureArcGoals({
        activeGoals: [{
          id: "arc-garage",
          title: "搜索地下车库",
          status: "active",
          scope: "mini_arc",
          lastTouchedChapter: 6,
          evidence: ["地下车库可能有通往街背后的出口。"],
          relatedHooks: [],
          relatedThreads: [],
          relatedLocations: [],
          relatedCharacters: [],
        }],
      }),
      chapter: 7,
    });

    expect(report.issues.some((issue) => issue.type === "arc_goals_not_referenced")).toBe(false);
  });

  it("matches continued door-threat sounds to a recent event", () => {
    const report = checkDraftContinuity({
      draftContent: "脚步声没有继续，也没有离开。片刻后，门外又响起指甲刮过墙面的声音，从楼道尽头慢慢拖过去。",
      continuity: {
        ...emptyContinuity(),
        recentEvents: ["门外异常脚步停在楼道里，林澈不敢开门。"],
        recentCharacters: ["林澈"],
      },
      chapter: 2,
    });

    expect(report.issues.some((issue) => issue.type === "recent_events_not_referenced")).toBe(false);
    expect(report.matched.events).toEqual(["门外异常脚步停在楼道里，林澈不敢开门。"]);
  });

  it("matches corpse-stain clues plus a new garage sound to a recent event", () => {
    const report = checkDraftContinuity({
      draftContent: "他想起楼道上那滩暗色污渍和单元门上的尸体。就在他准备离开时，车库深处忽然传来一声响动，他举起打火机继续调查。",
      continuity: {
        ...emptyContinuity(),
        recentEvents: ["楼道尸体和暗色污渍说明有人拖过受伤的东西。"],
        recentCharacters: ["林澈"],
      },
      chapter: 8,
    });

    expect(report.issues.some((issue) => issue.type === "recent_events_not_referenced")).toBe(false);
    expect(report.matched.events).toEqual(["楼道尸体和暗色污渍说明有人拖过受伤的东西。"]);
  });

  it("does not match passive resource or location mentions as reference progress", () => {
    const cases = [
      {
        draftContent: "林澈看了一眼桌上的水，没有出门，也没有检查水箱，只是把杯子放回原处。",
        storyThreads: fixtureStoryThreads({
          openLeads: [{
            id: "lead-water",
            type: "lead",
            title: "找到稳定水源",
            status: "open",
            lastTouchedChapter: 7,
            evidence: ["检查水箱并取水。"],
            relatedLocations: [],
            relatedCharacters: [],
          }],
        }),
        warningType: "open_threads_not_referenced",
      },
      {
        draftContent: "窗外街角能看见药店的招牌，但林澈没有过去，只是关上窗帘。",
        storyThreads: fixtureStoryThreads({
          openLeads: [{
            id: "lead-pharmacy",
            type: "lead",
            title: "去药店找药",
            status: "open",
            lastTouchedChapter: 7,
            evidence: ["进入药店获取药品。"],
            relatedLocations: [],
            relatedCharacters: [],
          }],
        }),
        warningType: "open_threads_not_referenced",
      },
      {
        draftContent: "地下车库入口在楼下，但他今天没有下去，只在门口停了几秒。",
        storyThreads: fixtureStoryThreads({
          openLeads: [{
            id: "lead-garage",
            type: "lead",
            title: "搜索地下车库",
            status: "open",
            lastTouchedChapter: 7,
            evidence: ["搜索地下车库出口和安全路线。"],
            relatedLocations: [],
            relatedCharacters: [],
          }],
        }),
        warningType: "open_threads_not_referenced",
      },
    ];

    for (const item of cases) {
      const report = checkDraftContinuity({
        draftContent: item.draftContent,
        continuity: emptyContinuity(),
        storyThreads: item.storyThreads,
        chapter: 8,
      });

      expect(report.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: item.warningType }),
      ]));
    }
  });

  it("does not match passive corpse or blood recollection as recent event progress", () => {
    const report = checkDraftContinuity({
      draftContent: "他忽然想起那具尸体和血迹，随后把念头压下，继续坐在屋里发呆。",
      continuity: {
        ...emptyContinuity(),
        recentEvents: ["楼道尸体和血迹需要继续调查。"],
        recentCharacters: ["林澈"],
      },
      chapter: 8,
    });

    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "recent_events_not_referenced" }),
    ]));
  });

  it("warns on repeated paragraphs and homogeneous-loop repetition", () => {
    const paragraph = "苏晚翻完旧账册，又核对了一遍名单，再次回到书房整理同一批文件。";
    const report = checkDraftContinuity({
      draftContent: [paragraph, paragraph].join("\n\n"),
      continuity: fixtureContinuity(),
      chapter: 9,
    });

    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "possible_repeated_paragraph" }),
      expect.objectContaining({ type: "possible_homogeneous_loop_repetition" }),
    ]));
  });
});

function fixtureContinuity(): StoryContinuityContext {
  return {
    recentEvents: ["林远夜入账房发现账本暗页暴露外院账目。"],
    openLeads: ["后墙传来异常响动，黑影暗号仍未解开。"],
    activeConflicts: ["管事威胁林远交出破损信物。"],
    discoveries: ["林远发现账本暗页记录外院账目。"],
    recentLocations: ["账房", "外院"],
    recentCharacters: ["林远"],
    carryForwardInstruction: "下一章必须承接最近未解决线索，不要重新开局。",
  };
}

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

async function createFixtureProject(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "story-engine-continuity-quality-"));
  const { projectDir } = await createStoryProject({
    rootDir,
    title: "空前情测试",
    genre: "xianxia",
    premise: "测试空前情。",
    mainCharacterName: "林远",
  });
  const events: TimelineEvent[] = [];
  await writeFile(join(projectDir, "timeline", "events.json"), `${JSON.stringify(events, null, 2)}\n`, "utf-8");
  return projectDir;
}
