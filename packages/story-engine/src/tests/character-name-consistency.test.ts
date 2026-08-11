import { describe, expect, it } from "vitest";
import {
  detectNameDrift,
  type EstablishedCharacter,
} from "../character-name-consistency.js";

const SISTER: EstablishedCharacter = { canonicalName: "林宁", identityKey: "妹妹" };
const PROTAGONIST: EstablishedCharacter = { canonicalName: "林澈", identityKey: "char-protagonist" };

describe("detectNameDrift — CJK 近形名漂移", () => {
  it("已确立名字本章缺席、却用到形近变体 → 判为漂移", () => {
    const findings = detectNameDrift({ chapterNames: ["林棠"], established: [SISTER] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ establishedName: "林宁", driftedVariant: "林棠", identityKey: "妹妹" });
  });

  it("正确名字本章用到 → 不判漂移", () => {
    const findings = detectNameDrift({ chapterNames: ["林宁"], established: [SISTER] });
    expect(findings).toHaveLength(0);
  });

  it("首字（姓氏）不同 → 视作另一个人，不判漂移", () => {
    const findings = detectNameDrift({ chapterNames: ["王宁"], established: [SISTER] });
    expect(findings).toHaveLength(0);
  });

  it("两个合法的已确立同姓角色都在场 → 互不误判", () => {
    const findings = detectNameDrift({ chapterNames: ["林澈", "林宁"], established: [PROTAGONIST, SISTER] });
    expect(findings).toHaveLength(0);
  });

  it("候选名本身就是另一个已确立名字 → 不误判为漂移", () => {
    // 只用到了合法的"林澈"；林宁虽缺席，但"林澈"是已知合法名，不能算成林宁的漂移。
    const findings = detectNameDrift({ chapterNames: ["林澈"], established: [PROTAGONIST, SISTER] });
    expect(findings).toHaveLength(0);
  });

  it("别名本章用到也算正确引用 → 不判漂移", () => {
    const withAlias: EstablishedCharacter = { canonicalName: "林宁", aliases: ["宁儿"], identityKey: "妹妹" };
    const findings = detectNameDrift({ chapterNames: ["宁儿"], established: [withAlias] });
    expect(findings).toHaveLength(0);
  });

  it("别名与规范名都缺席、用到形近变体 → 判漂移", () => {
    const withAlias: EstablishedCharacter = { canonicalName: "林宁", aliases: ["宁儿"], identityKey: "妹妹" };
    const findings = detectNameDrift({ chapterNames: ["林棠"], established: [withAlias] });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.driftedVariant).toBe("林棠");
  });

  it("三字名的中/尾字写歪也能抓到", () => {
    const character: EstablishedCharacter = { canonicalName: "赵长河" };
    const findings = detectNameDrift({ chapterNames: ["赵长何"], established: [character] });
    expect(findings[0]).toMatchObject({ establishedName: "赵长河", driftedVariant: "赵长何" });
  });

  it("共享通用称呼前缀的二字名不误判为漂移", () => {
    const established: EstablishedCharacter[] = [
      { canonicalName: "老赵" },
      { canonicalName: "小王" },
      { canonicalName: "阿强" },
    ];

    expect(detectNameDrift({ established, chapterNames: ["老周"], draft: "老周把门推开。" })).toHaveLength(0);
    expect(detectNameDrift({ established, chapterNames: ["小李"], draft: "小李站在门口。" })).toHaveLength(0);
    expect(detectNameDrift({ established, chapterNames: ["阿明"], draft: "阿明压低声音。" })).toHaveLength(0);
  });

  it("普通二字近形名仍会告警", () => {
    const findings = detectNameDrift({
      established: [{ canonicalName: "林宁" }, { canonicalName: "赵平" }],
      chapterNames: ["林棠", "赵屏"],
      draft: "林棠站在窗口。赵屏递来纸条。",
    });

    expect(findings).toEqual([
      { establishedName: "林宁", driftedVariant: "林棠" },
      { establishedName: "赵平", driftedVariant: "赵屏" },
    ]);
  });

  it("长度不同不算近形（多字/少字视作不同名）", () => {
    const character: EstablishedCharacter = { canonicalName: "林宁" };
    const findings = detectNameDrift({ chapterNames: ["林宁宁", "林"], established: [character] });
    expect(findings).toHaveLength(0);
  });
});

describe("detectNameDrift — 用正文过滤幽灵名", () => {
  it("给了 draft：形近变体确实出现在正文里才告警", () => {
    const draft = "林棠去年突然从旧港消失，赵叔说沈砚的人当时也在。";
    const findings = detectNameDrift({ chapterNames: ["林棠"], established: [SISTER], draft });
    expect(findings).toHaveLength(1);
  });

  it("给了 draft：候选名没真正写进正文 → 不告警（过滤幽灵名）", () => {
    const draft = "妹妹去年突然从旧港消失，再没回来。";
    const findings = detectNameDrift({ chapterNames: ["林棠"], established: [SISTER], draft });
    expect(findings).toHaveLength(0);
  });
});

describe("detectNameDrift — 拉丁名漂移", () => {
  it("Aaron 缺席、用到 Aron（漏字母）→ 判漂移", () => {
    const character: EstablishedCharacter = { canonicalName: "Aaron" };
    const findings = detectNameDrift({ chapterNames: ["Aron"], established: [character] });
    expect(findings[0]).toMatchObject({ establishedName: "Aaron", driftedVariant: "Aron" });
  });

  it("大小写不同不算漂移（Aaron 正确在场）", () => {
    const character: EstablishedCharacter = { canonicalName: "Aaron" };
    const findings = detectNameDrift({ chapterNames: ["AARON"], established: [character] });
    expect(findings).toHaveLength(0);
  });
});

describe("detectNameDrift — 边界", () => {
  it("空候选名 / 空名册 → 无告警", () => {
    expect(detectNameDrift({ chapterNames: [], established: [SISTER] })).toHaveLength(0);
    expect(detectNameDrift({ chapterNames: ["林棠"], established: [] })).toHaveLength(0);
  });

  it("候选名首尾空白不影响比对", () => {
    const findings = detectNameDrift({ chapterNames: ["  林宁 "], established: [SISTER] });
    expect(findings).toHaveLength(0);
  });

  it("maxFindings 限制条数", () => {
    const established: EstablishedCharacter[] = [
      { canonicalName: "林宁" },
      { canonicalName: "赵河" },
    ];
    const findings = detectNameDrift({ chapterNames: ["林棠", "赵何"], established, maxFindings: 1 });
    expect(findings).toHaveLength(1);
  });
});
