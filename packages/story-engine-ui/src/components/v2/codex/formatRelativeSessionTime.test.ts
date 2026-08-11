import { describe, expect, it } from "vitest";
import { formatRelativeSessionTime } from "./formatRelativeSessionTime.js";

describe("formatRelativeSessionTime", () => {
  const now = Date.parse("2026-07-12T12:00:00.000Z");

  it("空/非法 → 空串", () => {
    expect(formatRelativeSessionTime(undefined, now)).toBe("");
    expect(formatRelativeSessionTime("nope", now)).toBe("");
  });

  it("相对时间档位", () => {
    expect(formatRelativeSessionTime(new Date(now - 10_000).toISOString(), now)).toBe("刚刚");
    expect(formatRelativeSessionTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5 分钟前");
    expect(formatRelativeSessionTime(new Date(now - 3 * 3600_000).toISOString(), now)).toBe("3 小时前");
    expect(formatRelativeSessionTime(new Date(now - 2 * 86400_000).toISOString(), now)).toBe("2 天前");
  });
});
