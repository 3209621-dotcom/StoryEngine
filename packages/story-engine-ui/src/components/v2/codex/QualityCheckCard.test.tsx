// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QualityCheckCard } from "./QualityCheckCard.js";
import type { QualityCardReport } from "../../../api/types.js";

const base: QualityCardReport = { passed: true, blocking: [], soft: [], reference: [], summary: "没硬伤可入库" };

describe("QualityCheckCard 质检明细卡", () => {
  it("有 blocking → status=attention、徽章计数、默认展开、红色硬伤可见", () => {
    const report: QualityCardReport = {
      ...base,
      passed: false,
      blocking: [{ type: "forbidden_reveal", label: "提前泄密", severity: "error", message: "第3章不该知道X" }],
    };
    const { container, getByText } = render(<QualityCheckCard report={report} />);
    expect(container.querySelector(".step-card.sc-attention")).toBeTruthy();
    expect(getByText("1 处硬伤")).toBeTruthy();
    expect(container.textContent ?? "").toContain("提前泄密");
    expect(container.querySelector(".qcc-sev-error")).toBeTruthy();
  });

  it("无 blocking → status=done、徽章「通过」", () => {
    const { container, getByText } = render(<QualityCheckCard report={base} />);
    expect(container.querySelector(".step-card.sc-done")).toBeTruthy();
    expect(getByText("通过")).toBeTruthy();
  });

  it("有 severe（AI confirmed+high）但无 blocking → status=attention、默认展开、严重项醒目可见、不再单打『可入库』（afterfix）", () => {
    const report: QualityCardReport = {
      ...base,
      severe: [{ type: "writing_context_forbidden_reveal", label: "提前泄露了禁止揭示的秘密", severity: "warning", message: "第1章就给了核心答案" }],
    };
    const { container } = render(<QualityCheckCard report={report} />);
    expect(container.querySelector(".step-card.sc-attention")).toBeTruthy(); // 不再是 done 绿
    expect(container.querySelector(".sc-body")).toBeTruthy(); // 默认展开（不折叠埋掉严重问题）
    expect(container.textContent ?? "").toContain("提前泄露了禁止揭示的秘密"); // 严重项直接可见
    expect(container.textContent ?? "").not.toContain("没有硬伤，可以定稿"); // 不再单说「可以定稿」
  });

  it("无硬伤仅有 soft → 外壳默认折叠（防噪音）、徽章带软提示计数", () => {
    const report: QualityCardReport = {
      ...base,
      soft: [{ type: "recent_characters_not_referenced", label: "近期角色没提到", severity: "warning", message: "没提到李四" }],
    };
    const { container, getByText } = render(<QualityCheckCard report={report} />);
    // 外壳默认折叠（无 .sc-body），软提示文字与 toggle 都不渲染——通过状态的卡不抢戏。
    expect(container.querySelector(".sc-body")).toBeNull();
    expect(container.querySelector(".qcc-soft-toggle")).toBeNull();
    expect(getByText("通过 · 1 提示")).toBeTruthy();
  });

  it("展开外壳后，soft 软提示仍二级折叠，点开才显（两级防噪音）", () => {
    const report: QualityCardReport = {
      ...base,
      soft: [{ type: "recent_characters_not_referenced", label: "近期角色没提到", severity: "warning", message: "没提到李四" }],
    };
    const { container } = render(<QualityCheckCard report={report} />);
    // 1) 先展开外壳 StepCard。
    fireEvent.click(container.querySelector("button.sc-head") as HTMLButtonElement);
    // 2) 软提示项仍收起（二级折叠）。
    expect(container.textContent ?? "").not.toContain("没提到李四");
    // 3) 点软提示 toggle 才显。
    fireEvent.click(container.querySelector(".qcc-soft-toggle") as HTMLButtonElement);
    expect(container.textContent ?? "").toContain("没提到李四");
  });
});
