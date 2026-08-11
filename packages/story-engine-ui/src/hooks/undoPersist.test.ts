import { describe, expect, it } from "vitest";
import type { ChapterWorkspaceSnapshot } from "../api/types.js";
import type { ChapterMessage } from "../types.js";
import { buildUndoPersistRequest } from "./undoPersist.js";

const truncated: readonly ChapterMessage[] = [
  { id: "user-1", role: "user", content: "继续写下一章" },
  { id: "assistant-1", role: "assistant", content: "好的。" },
];

// restore 后读回的当前章快照：草稿已是回退稿（turn-start），messages 仍含被撤销的孤儿。
const restored: ChapterWorkspaceSnapshot = {
  chapter: 2,
  messages: [
    { id: "user-orphan", role: "user", content: "删掉顾明" },
    { id: "assistant-orphan", role: "assistant", content: "已删除顾明。" },
  ],
  selectedAdviceCardKeys: ["card-1"],
  flowStatus: "draft_ready",
  draftContent: "# 第二章\n\n回退后的旧稿正文 SENTINEL_A",
  draftTitle: "第二章",
};

describe("buildUndoPersistRequest（H5 把干净截断写回磁盘，保留回退草稿）", () => {
  it("messages 换成截断后的干净对话（丢弃磁盘上的孤儿）", () => {
    const req = buildUndoPersistRequest("/tmp/book", 2, truncated, restored);
    expect(req.messages).toBe(truncated);
    expect(req.messages!.some((m) => m.id.includes("orphan"))).toBe(false);
  });

  it("保留 restore 后的回退草稿 draftContent/draftTitle/flowStatus（绝不用内存旧稿覆盖）", () => {
    const req = buildUndoPersistRequest("/tmp/book", 2, truncated, restored);
    expect(req.draftContent).toBe("# 第二章\n\n回退后的旧稿正文 SENTINEL_A");
    expect(req.draftTitle).toBe("第二章");
    expect(req.flowStatus).toBe("draft_ready");
  });

  it("不带 writeDraftFile：.md 已被 git restore 还原，绝不重写", () => {
    const req = buildUndoPersistRequest("/tmp/book", 2, truncated, restored);
    expect("writeDraftFile" in req).toBe(false);
  });

  it("uses the restored snapshot revision as the CAS baseline", () => {
    const req = buildUndoPersistRequest("/tmp/book", 2, truncated, { ...restored, revision: 5 });
    expect(req.expectedRevision).toBe(5);
  });

  it("projectPath/chapter 透传；selectedAdviceCardKeys 缺省回退空数组", () => {
    const req = buildUndoPersistRequest("/tmp/book", 7, truncated, {
      chapter: 7,
      messages: [],
      selectedAdviceCardKeys: undefined as unknown as readonly string[],
    });
    expect(req.projectPath).toBe("/tmp/book");
    expect(req.chapter).toBe(7);
    expect(req.selectedAdviceCardKeys).toEqual([]);
    // 回退快照无 draftContent → 不带该字段（避免写空草稿）。
    expect("draftContent" in req).toBe(false);
  });
});
