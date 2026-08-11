import { describe, expect, it } from "vitest";
import { summarizeCommitReport } from "./commitReportSummary.js";

describe("summarizeCommitReport", () => {
  it("summarizes formal state sync counts from commit report", () => {
    const summary = summarizeCommitReport({
      chapterPath: "/tmp/story/chapters/chapter-0001.md",
      updatedCharacters: ["guo-xu"],
      timelineEventIds: ["evt-1", "evt-2"],
      updatedHooks: ["hook-1"],
      updatedWorld: true,
      updatedCalendar: false,
      threadTracking: {
        touchedThreads: ["thread-1", "thread-2"],
        staleThreadWarnings: [{}],
      },
      arcGoalTracking: {
        touchedGoals: ["goal-1"],
        completedGoals: ["goal-1"],
        staleGoalWarnings: [],
      },
    });

    expect(summary.statusLine).toBe("状态同步：角色 1 项，时间线 2 条，伏笔/线索 3 项，主线目标 1 项。");
    expect(summary.detailLines).toEqual([
      "正式章节：已写入 /tmp/story/chapters/chapter-0001.md",
      "角色状态：1 项",
      "时间线事件：2 条",
      "伏笔更新：1 项",
      "线索线程：2 项",
      "主线目标：1 项，完成 1 项",
      "世界状态：已更新",
      "故事日历：无变更",
      "过期提醒：伏笔 0 条，线索 1 条，主线目标 0 条",
    ]);
  });

  it("handles missing or malformed reports without throwing", () => {
    const summary = summarizeCommitReport(null);

    expect(summary.statusLine).toBe("状态同步：角色 0 项，时间线 0 条，伏笔/线索 0 项，主线目标 0 项。");
    expect(summary.detailLines).toContain("正式章节：已写入 chapters");
    expect(summary.detailLines).toContain("世界状态：无变更");
  });
});
