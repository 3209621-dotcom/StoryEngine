// @vitest-environment node
// generate_worldbuilding 入参 schema：模型无关——空串 premise/genre 必须归一成 undefined，
// 这样 run() 里的 `input.premise ?? overview…` 才接得住、回落「从项目现有设定推断」，
// 不在有世界设定的书上谎报「没种子」。锁住 blankToUndefined 接线，回退会变红。
import { describe, expect, it } from "vitest";

import { inputSchema } from "./generate-worldbuilding.js";

describe("generate_worldbuilding inputSchema 模型无关", () => {
  it("空串/纯空白 premise/genre → undefined（让 ?? 现有设定 兜底）", () => {
    const r = inputSchema.parse({ premise: "", genre: "   " });
    expect(r.premise).toBeUndefined();
    expect(r.genre).toBeUndefined();
  });

  it("非空 premise/genre → 原样保留", () => {
    const r = inputSchema.parse({ premise: "雾港的私家侦探", genre: "悬疑" });
    expect(r.premise).toBe("雾港的私家侦探");
    expect(r.genre).toBe("悬疑");
  });

  it("全省略 → 都 undefined", () => {
    const r = inputSchema.parse({});
    expect(r.premise).toBeUndefined();
    expect(r.genre).toBeUndefined();
  });
});
