import { describe, expect, it } from "vitest";

import { createStreamingScrubber, scrubEntityIds } from "./entity-id-scrubber.js";

describe("entity-id-scrubber", () => {
  it("scrubs bare internal entity ids from visible text", () => {
    expect(scrubEntityIds("已更新 char-8d83a3 和 hook-11jei9u。")).toBe(
      "已更新 （内部编号已隐去） 和 （内部编号已隐去）。",
    );
  });

  it("removes common id decoration groups", () => {
    expect(scrubEntityIds("占位主角「韩青」（id: char-8d83a3）已更新。")).toBe("占位主角「韩青」已更新。");
    expect(scrubEntityIds("角色(id=char-8d83a3) 已更新。")).toBe("角色 已更新。");
  });

  it("does not scrub ordinary hyphenated words or Chinese prose", () => {
    expect(scrubEntityIds("near-future station 与 E3-047 读数正常保留。")).toBe(
      "near-future station 与 E3-047 读数正常保留。",
    );
  });

  it("buffers ids split across text deltas", () => {
    const scrubber = createStreamingScrubber();
    const out = [
      scrubber.push("已更新 char-8"),
      scrubber.push("d83a3，继续。"),
      scrubber.flush(),
    ].join("");

    expect(out).toBe("已更新 （内部编号已隐去），继续。");
  });

  it("flushes non-id tail text at stream end", () => {
    const scrubber = createStreamingScrubber();
    expect(scrubber.push("这不是 cha")).toBe("这不是 ");
    expect(scrubber.flush()).toBe("cha");
  });
});
