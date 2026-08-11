import { describe, it, expect } from "vitest";
import { spotlightVars } from "./cursorSpotlight";

describe("spotlightVars", () => {
  it("把鼠标坐标转成 CSS 变量对象", () => {
    expect(spotlightVars(120, 340)).toEqual({ "--mx": "120px", "--my": "340px" });
  });
  it("四舍五入到整数像素（避免亚像素抖动）", () => {
    expect(spotlightVars(120.7, 340.2)).toEqual({ "--mx": "121px", "--my": "340px" });
  });
});
