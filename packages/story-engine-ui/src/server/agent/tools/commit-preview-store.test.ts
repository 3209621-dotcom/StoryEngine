// @vitest-environment node
//
// commit preview token 存储的守卫纯逻辑单测：登记/校验/消费、各类失败分支。
import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetCommitPreviewStore,
  consumeCommitPreview,
  recordCommitPreview,
  verifyCommitPreview,
} from "./commit-preview-store.js";

const DIR = "/tmp/proj-x";

beforeEach(() => {
  __resetCommitPreviewStore();
});

describe("commit preview 守卫", () => {
  it("没预览过 → no_preview", () => {
    const r = verifyCommitPreview({ projectDir: DIR, chapter: 1, token: "anything", currentDraftHash: "h" });
    expect(r.ok).toBe(false);
    expect(r.failure).toBe("no_preview");
  });

  it("预览后带正确 token + 同哈希 → 通过", () => {
    const rec = recordCommitPreview({ projectDir: DIR, chapter: 2, draftHash: "h2" });
    const r = verifyCommitPreview({ projectDir: DIR, chapter: 2, token: rec.token, currentDraftHash: "h2" });
    expect(r.ok).toBe(true);
  });

  it("token 不匹配 → token_mismatch", () => {
    recordCommitPreview({ projectDir: DIR, chapter: 2, draftHash: "h2" });
    const r = verifyCommitPreview({ projectDir: DIR, chapter: 2, token: "wrong", currentDraftHash: "h2" });
    expect(r.ok).toBe(false);
    expect(r.failure).toBe("token_mismatch");
  });

  it("草稿在预览后改动（哈希变了）→ draft_changed_since_preview", () => {
    const rec = recordCommitPreview({ projectDir: DIR, chapter: 2, draftHash: "h2" });
    const r = verifyCommitPreview({ projectDir: DIR, chapter: 2, token: rec.token, currentDraftHash: "h2-changed" });
    expect(r.ok).toBe(false);
    expect(r.failure).toBe("draft_changed_since_preview");
  });

  it("预览章节与 apply 章节不同 → 该章无记录 → no_preview", () => {
    const rec = recordCommitPreview({ projectDir: DIR, chapter: 2, draftHash: "h2" });
    const r = verifyCommitPreview({ projectDir: DIR, chapter: 3, token: rec.token, currentDraftHash: "h2" });
    expect(r.ok).toBe(false);
    expect(r.failure).toBe("no_preview");
  });

  it("R3：消费后 token 仍对未改的当前草稿有效（无状态重算；重复入库防护改由 commit_apply 幂等探测兜底）", () => {
    const rec = recordCommitPreview({ projectDir: DIR, chapter: 2, draftHash: "h2" });
    consumeCommitPreview(DIR, 2);
    // store record 已清，但 token=sha256(dir,章,草稿哈希) 纯函数，草稿没变→重算仍匹配→放行
    // （治断流后草稿没变、token 被消费却又入不了库；防重复入库改由 commit_apply 的已入库幂等探测做）。
    const r = verifyCommitPreview({ projectDir: DIR, chapter: 2, token: rec.token, currentDraftHash: "h2" });
    expect(r.ok).toBe(true);
  });

  it("R3：store 空（重启/换会话）但带对当前草稿 token → 仍放行（不再误判 no_preview）", () => {
    const rec = recordCommitPreview({ projectDir: DIR, chapter: 5, draftHash: "h5" });
    __resetCommitPreviewStore(); // 模拟进程重启 / 换会话：内存表清空
    const r = verifyCommitPreview({ projectDir: DIR, chapter: 5, token: rec.token, currentDraftHash: "h5" });
    expect(r.ok).toBe(true);
  });

  it("R3：store 空 + 草稿已变（token 对不上当前草稿）→ no_preview，要求重新预览", () => {
    const rec = recordCommitPreview({ projectDir: DIR, chapter: 5, draftHash: "h5" });
    __resetCommitPreviewStore();
    const r = verifyCommitPreview({ projectDir: DIR, chapter: 5, token: rec.token, currentDraftHash: "h5-CHANGED" });
    expect(r.ok).toBe(false);
    expect(r.failure).toBe("no_preview");
  });
});
