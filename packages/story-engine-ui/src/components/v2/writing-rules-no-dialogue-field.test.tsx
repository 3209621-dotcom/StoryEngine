// @vitest-environment jsdom
//
// 回归守卫：写作规则里的「对话风格」是个没接线的死字段——
// 引擎 WritingRules 类型无此字段、无任何生成端、也不进正文 prompt（writingRulesContext）。
// 对话风格这件事由「每个角色各自的 speechStyle」承担。故 codex 面板不该再渲染这个死标签。
// 即便上游硬塞一条「对话风格：…」，UI 也必须不显示，防止它误导用户以为是个可用配置项。
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import WritingRulesCodexPanel from "./codex/WritingRulesCodexPanel.js";

const itemsWithDialogue: readonly string[] = [
  "文风：冷峻克制",
  "语言风格：短句为主",
  "叙事视角：第三人称",
  "节奏：快",
  "对话风格：简洁有力", // 故意塞入死字段，验证 UI 不再渲染
];

describe("写作规则面板不再渲染「对话风格」死字段", () => {
  it("codex 面板（WritingRulesCodexPanel）：没有对话风格 / 对话合同 section", () => {
    const { queryByText } = render(
      <WritingRulesCodexPanel items={itemsWithDialogue} projectPath={null} />,
    );
    expect(queryByText(/对话风格|对话合同/u)).toBeNull();
    expect(queryByText("简洁有力")).toBeNull();
  });
});
