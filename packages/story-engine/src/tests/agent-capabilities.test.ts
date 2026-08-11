import { describe, expect, it } from "vitest";
import {
  describeAgentCapabilitiesForPrompt,
  getAgentCapability,
  STORY_ENGINE_AGENT_CAPABILITIES,
} from "../agent-capabilities.js";

describe("StoryEngine agent capability registry", () => {
  it("defines the author-facing lower-level agents used by the chapter orchestrator", () => {
    const ids = STORY_ENGINE_AGENT_CAPABILITIES.map((capability) => capability.id);

    expect(ids).toEqual(expect.arrayContaining([
      "chapterSteeringAgent",
      "contextPackAgent",
      "draftWriterAgent",
      "draftEditAgent",
      "foundationAgent",
      "satelliteUpdateAgent",
      "qualityAgent",
      "commitPreviewAgent",
      "commitApplyAgent",
    ]));
    expect(getAgentCapability("draftEditAgent")).toMatchObject({
      confirmation: "draft_save_reject",
      permissions: expect.arrayContaining(["draft_patch"]),
    });
    expect(getAgentCapability("foundationAgent")).toMatchObject({
      confirmation: "confirm_before_foundation_write",
      permissions: expect.arrayContaining(["foundation_patch"]),
    });
  });

  it("renders a prompt manifest with canonical paths and chapter draft target", () => {
    const manifest = describeAgentCapabilitiesForPrompt(5);

    expect(manifest).toContain("draftWriterAgent");
    expect(manifest).toContain("drafts/fast/chapter-0005.md");
    expect(manifest).toContain("用户说法示例：开始写");
    expect(manifest).toContain("foundationAgent");
    expect(manifest).toContain("story/character-bible.json");
    expect(manifest).toContain("characters/*");
    expect(manifest).toContain("用户说法示例：补角色");
    expect(manifest).toContain("确认策略：资料写入前必须给用户确认");
  });

  it("omits every confirmation-policy line when includeConfirmationPolicy is false (direct-mode agents)", () => {
    const manifest = describeAgentCapabilitiesForPrompt(null, { includeConfirmationPolicy: false });

    // 仍保留能力 id / 读写 / 触发示例，只是不渲染确认策略行。
    expect(manifest).toContain("foundationAgent");
    expect(manifest).toContain("satelliteUpdateAgent");
    expect(manifest).toContain("用户说法示例：补角色");
    expect(manifest).toContain("story/character-bible.json");

    // 关键：任何「确认策略」字样、以及会与「直接做」铁律冲突的确认措辞都不得出现。
    expect(manifest).not.toContain("确认策略");
    expect(manifest).not.toContain("资料写入前必须给用户确认");
    expect(manifest).not.toContain("正式状态写入前必须给用户确认");
    expect(manifest).not.toContain("必须给用户确认");
  });

  it("keeps confirmation-policy lines by default (backward compatible)", () => {
    const withDefault = describeAgentCapabilitiesForPrompt(null);
    const withExplicitTrue = describeAgentCapabilitiesForPrompt(null, { includeConfirmationPolicy: true });

    expect(withDefault).toBe(withExplicitTrue);
    expect(withDefault).toContain("确认策略：资料写入前必须给用户确认");
  });
});
