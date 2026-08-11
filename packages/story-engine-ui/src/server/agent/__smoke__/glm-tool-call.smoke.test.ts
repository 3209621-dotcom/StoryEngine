// @vitest-environment node
//
// 阶段0 关键验证：实测 Mastra + 用户的 GLM 端点能不能可靠地做 tool-calling。
// 这是「这条路通不通」的命门——若 GLM 的 OpenAI 兼容 function-calling 不稳，整条 Mastra 方案要回退。
//
// 需真实网络 + 真实 GLM key，默认 skip；手动跑：
//   RUN_GLM_SMOKE=1 pnpm --filter @actalk/story-engine-ui exec vitest run glm-tool-call.smoke
import { describe, it, expect } from "vitest";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { resolveGlmModel } from "../model.js";

const ENABLED = process.env.RUN_GLM_SMOKE === "1";

describe.skipIf(!ENABLED)("GLM + Mastra tool-calling 实测", () => {
  it("agent 能通过 GLM 决定调用一个工具", async () => {
    const { model, profile } = await resolveGlmModel("triage");
    // eslint-disable-next-line no-console
    console.log("[smoke] 使用模型:", profile.model);

    let toolCalled = false;
    let toolArgs: unknown = null;
    const readStateTool = createTool({
      id: "read_state_overview",
      description: "读取当前故事的状态总览（有哪些角色、写到第几章、世界设定等）。当用户询问故事现状/进度/有哪些角色时，必须调用本工具，绝不凭空编造。",
      inputSchema: z.object({ focus: z.string().optional().describe("可选：想重点了解的方面") }),
      outputSchema: z.object({ summary: z.string() }),
      execute: async ({ context }) => {
        toolCalled = true;
        toolArgs = context;
        return { summary: "当前项目：主角林晚；已建角色 3 个；写到第 2 章草稿；世界为架空古代。" };
      },
    });

    const agent = new Agent({
      id: "smoke-writing-agent",
      name: "写作助手",
      instructions:
        "你是中文小说写作助手。涉及故事当前状态/进度/角色时，必须调用 read_state_overview 工具获取真实数据后再回答，绝不凭空编造。",
      model,
      tools: { read_state_overview: readStateTool },
    });

    const res = await agent.generate("现在这个故事写到什么程度了？有哪些角色？");

    // eslint-disable-next-line no-console
    console.log("[smoke] toolCalled =", toolCalled, "| toolArgs =", JSON.stringify(toolArgs));
    // eslint-disable-next-line no-console
    console.log("[smoke] final text =", res.text);
    // eslint-disable-next-line no-console
    console.log("[smoke] steps/toolCalls =", JSON.stringify(res.toolCalls ?? [], null, 2));

    // 核心断言：GLM 真的决定调了工具（function-calling 通）
    expect(toolCalled).toBe(true);
    // 且最终回答里带上了工具返回的真实数据（说明 tool result 被消费）
    expect(res.text).toContain("林晚");
  }, 90_000);
});
