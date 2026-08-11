// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommitDeltaCard } from "./CommitDeltaCard.js";

const report = {
  updatedCharacters: ["c1", "c2"],
  timelineEventIds: ["e1", "e2", "e3"],
  updatedHooks: ["h1"],
  updatedWorld: true,
  updatedCalendar: false,
  threadTracking: { touchedThreads: ["t1", "t2"] },
  arcGoalTracking: { touchedGoals: ["g1"], completedGoals: [] },
};

describe("CommitDeltaCard 入库 delta 卡", () => {
  it("用 StepCard 外壳、标题「入库」、徽章「已入库」", () => {
    const { container, getByText } = render(<CommitDeltaCard report={report} />);
    expect(container.querySelector(".step-card.sc-done")).toBeTruthy();
    expect(getByText("定稿")).toBeTruthy();
    expect(getByText("已定稿")).toBeTruthy();
  });

  it("渲染状态行 + 分项（角色/时间线/主线目标）", () => {
    const { container } = render(<CommitDeltaCard report={report} />);
    const text = container.textContent ?? "";
    expect(text).toContain("角色");
    expect(text).toContain("2");
    expect(text).toContain("时间线");
    expect(text).toContain("3");
    expect(text).toContain("主线目标");
  });

  it("脏/空 report 不崩（summarizeCommitReport 全程防御）", () => {
    const { container } = render(<CommitDeltaCard report={undefined} />);
    expect(container.querySelector(".step-card")).toBeTruthy();
  });
});
