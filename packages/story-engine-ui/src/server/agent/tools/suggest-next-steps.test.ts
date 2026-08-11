import { describe, expect, it } from "vitest";
import { suggestNextStepsTool } from "./suggest-next-steps.js";

describe("suggestNextStepsTool", () => {
  it("合法空对象退化输入应诚实返回 ok:false，而不是抛工具错误", async () => {
    const result = await suggestNextStepsTool.execute?.({} as never, {} as never);

    expect(result).toMatchObject({
      ok: false,
      summary: expect.stringContaining("下一步选项不完整"),
    });
  });

  it("正常输入原样回传给前端渲染下一步卡片", async () => {
    const result = await suggestNextStepsTool.execute?.(
      {
        question: "接下来？",
        choices: [
          {
            label: "写下一章",
            intent: "继续写下一章",
            recommended: true,
          },
        ],
      } as never,
      {} as never,
    );

    expect(result).toEqual({
      ok: true,
      question: "接下来？",
      choices: [
        {
          label: "写下一章",
          intent: "继续写下一章",
          recommended: true,
        },
      ],
    });
  });
});
