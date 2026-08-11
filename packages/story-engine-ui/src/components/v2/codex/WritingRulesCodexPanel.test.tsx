import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import WritingRulesCodexPanel from "./WritingRulesCodexPanel.js";

describe("WritingRulesCodexPanel customNotes（破例⑧·我的补充 Markdown 展示）", () => {
  afterEach(cleanup);

  it("有 customNotes 时渲染「我的补充」section + 轻量 Markdown（标题/列表）", () => {
    render(
      <WritingRulesCodexPanel
        items={[]}
        customNotes={"## 我的开车节奏\n- 前戏别超200字\n- 高潮用短句"}
      />,
    );
    expect(screen.getByText("我的补充")).toBeInTheDocument();
    expect(screen.getByText("我的开车节奏")).toBeInTheDocument(); // 标题行
    expect(screen.getByText("前戏别超200字")).toBeInTheDocument(); // 列表项
    expect(screen.getByText("高潮用短句")).toBeInTheDocument();
  });

  it("customNotes 缺省且无其它规则 → 空态，不渲染「我的补充」", () => {
    render(<WritingRulesCodexPanel items={[]} />);
    expect(screen.queryByText("我的补充 Custom Notes")).toBeNull();
  });
});

describe("WritingRulesCodexPanel 稀疏态 batch1（T3）", () => {
  afterEach(cleanup);

  it("读者体验规则用诚实标签，长字段列表化，反AI·归反 AI 区", () => {
    render(
      <WritingRulesCodexPanel
        items={[
          "叙事视角：第三人称有限视角",
          "文风关键词：沉浸；状态感知",
          "读者体验规则：反AI·鼓励角色内部感知：AI容易直接描述场景；落具体感官",
          "禁止事项：草稿阶段不要改写正式状态",
        ]}
      />,
    );
    expect(screen.getByText("读者体验规则")).toBeInTheDocument();
    expect(screen.queryByText("描写重点")).toBeNull();
    expect(screen.getByText(/落具体感官/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /避免机器腔/ })).toBeInTheDocument();
    expect(screen.getByText(/鼓励角色内部感知/)).toBeInTheDocument();
  });
});
