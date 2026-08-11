import { describe, expect, it } from "vitest";

import { filterByEntityTarget, parseEntityTarget } from "./enrichment-target.js";

const ents = [
  { id: "c1", name: "林远" },
  { id: "c2", name: "沈墨" },
  { name: "无 id 角色" },
];

describe("enrichment-target 单体定向（补即做厚只补指名的，不整批覆盖）", () => {
  it("不传 target → undefined → 补全部（向后兼容）", () => {
    expect(parseEntityTarget({})).toBeUndefined();
    expect(filterByEntityTarget(ents, undefined)).toEqual(ents);
  });

  it("按名字命中：只补沈墨", () => {
    const t = parseEntityTarget({ targetNames: ["沈墨"] });
    expect(filterByEntityTarget(ents, t)).toEqual([{ id: "c2", name: "沈墨" }]);
  });

  it("按 id 命中：只补 c1", () => {
    const t = parseEntityTarget({ targetIds: ["c1"] });
    expect(filterByEntityTarget(ents, t)).toEqual([{ id: "c1", name: "林远" }]);
  });

  it("名字 + 空白/重复整理：『 沈墨 』命中，空串忽略", () => {
    const t = parseEntityTarget({ targetNames: [" 沈墨 ", "", "  "] });
    expect(t?.names.has("沈墨")).toBe(true);
    expect(filterByEntityTarget(ents, t)).toEqual([{ id: "c2", name: "沈墨" }]);
  });

  it("命中为空（指名了不存在的）→ 返回空数组，供工具诚实回报", () => {
    const t = parseEntityTarget({ targetNames: ["不存在的人"] });
    expect(t).not.toBeUndefined();
    expect(filterByEntityTarget(ents, t)).toEqual([]);
  });

  // labels 仅用于「没找到 X」提示：优先人类可读名字，绝不泄露裸 id（匹配仍走 ids/names 集合）。
  it("labels 优先用名字（给了名字就不回显裸 id）", () => {
    const t = parseEntityTarget({ targetNames: ["沈墨"], targetIds: ["cX"] });
    expect(t?.labels).toEqual(["沈墨"]); // cX 不进提示
    expect(t?.ids.has("cX")).toBe(true); // 但仍参与匹配
  });

  it("只给 id（无名字）时 labels 才回显 id（唯一可读 ref）", () => {
    const t = parseEntityTarget({ targetIds: ["cX"] });
    expect(t?.labels).toEqual(["cX"]);
  });
});
