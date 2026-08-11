// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DraftAIReviewCard } from "./DraftAIReviewCard.js";
import type { DraftAIReviewReport } from "../../../api/types.js";

afterEach(() => cleanup());

function makeReview(overrides: Partial<DraftAIReviewReport> = {}): DraftAIReviewReport {
  return {
    passed: false,
    score: 58,
    verdict: "needs_major_revision",
    summary: "需要大修。",
    strengths: ["开场有氛围"],
    issues: [
      {
        id: "issue-1",
        severity: "high",
        category: "plot",
        title: "动机不清",
        description: "缺来因。",
        evidence: "他推开门",
        suggestedFix: "补来因",
      },
      {
        id: "issue-2",
        severity: "warning",
        category: "style",
        title: "语言略平",
        description: "偏说明文。",
        evidence: "雨很大",
        suggestedFix: "加画面",
      },
    ],
    suggestedRevisions: [],
    continuityNotes: [],
    styleNotes: [],
    characterNotes: [],
    pacingNotes: [],
    readerHookNotes: [],
    shouldCommit: false,
    blockingReasons: [],
    ...overrides,
  };
}

describe("DraftAIReviewCard 随消息折叠壳", () => {
  it("有问题：StepCard 标题「审稿」、statusLabel 含分数与问题数、默认展开、attention", () => {
    const { container } = render(<DraftAIReviewCard review={makeReview()} />);
    expect(container.querySelector(".step-card.sc-attention")).toBeTruthy();
    expect(screen.getByText("内容审阅")).toBeTruthy();
    expect(screen.getByText("58/100 · 2 处问题")).toBeTruthy();
    expect(container.querySelector(".sc-body")).toBeTruthy();
    expect(screen.getByText(/需要大修/)).toBeTruthy();
  });

  it("无问题：statusLabel「通过」、status=done", () => {
    const { container } = render(
      <DraftAIReviewCard
        review={makeReview({
          passed: true,
          score: 92,
          verdict: "ready_to_commit",
          summary: "可以入库。",
          issues: [],
        })}
      />,
    );
    expect(container.querySelector(".step-card.sc-done")).toBeTruthy();
    expect(screen.getByText("通过")).toBeTruthy();
  });

  it("点「按最重要问题生成修订任务」回调 onCreateRevisionTask", () => {
    const onCreateRevisionTask = vi.fn();
    render(<DraftAIReviewCard review={makeReview()} onCreateRevisionTask={onCreateRevisionTask} />);
    fireEvent.click(screen.getByRole("button", { name: /按最重要问题准备修改方案/ }));
    expect(onCreateRevisionTask).toHaveBeenCalledTimes(1);
    expect(onCreateRevisionTask.mock.calls[0][0].issue?.id).toBe("issue-1");
  });
});
