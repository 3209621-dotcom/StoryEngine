import { afterEach, describe, expect, it } from "vitest";
import {
  __resetAutosaveControlForTest,
  createExactPayloadAutosaveRunner,
  drainAutosave,
  getAutosaveSnapshot,
  flushAutosaveNow,
  hasPendingAutosave,
  isAutosaveSuspended,
  resumeAutosave,
  scheduleAutosave,
  setAutosaveFlusher,
  subscribeAutosave,
  suspendAutosave,
} from "./autosaveControl.js";

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("autosaveControl", () => {
  afterEach(() => {
    __resetAutosaveControlForTest();
  });

  it("初始未冻结；suspend/resume 切换冻结态", () => {
    expect(isAutosaveSuspended()).toBe(false);
    suspendAutosave();
    expect(isAutosaveSuspended()).toBe(true);
    resumeAutosave();
    expect(isAutosaveSuspended()).toBe(false);
  });

  it("无在途时 drainAutosave 立即 resolve", async () => {
    await expect(drainAutosave()).resolves.toBeUndefined();
  });

  it("flushAutosaveNow awaits the registered flusher and reports its real failure", async () => {
    const gate = deferred();
    setAutosaveFlusher(async () => {
      await gate.promise;
      return { ok: false, error: "旧章节保存失败" };
    });

    const flushed = flushAutosaveNow();
    let settled = false;
    void flushed.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.resolve();
    await expect(flushed).resolves.toEqual({ ok: false, error: "旧章节保存失败" });
  });

  it("scheduleAutosave does not turn a swallowed task error into a successful flush result", async () => {
    await expect(scheduleAutosave("book-a::chapter-1", async () => {
      throw new Error("磁盘已满");
    })).resolves.toEqual({ ok: false, error: "磁盘已满" });
  });

  it("retry reuses the exact failed project/chapter/session payload instead of recapturing current state", async () => {
    const attempts: { projectPath: string; chapter: number; sessionId: string; messages: readonly string[]; revision: number }[] = [];
    const original = {
      projectPath: "/books/a",
      chapter: 3,
      sessionId: "session-a",
      messages: ["old-session-message"],
      revision: 7,
    };
    const runner = createExactPayloadAutosaveRunner<typeof original>(async (payload) => {
      attempts.push(payload);
      return attempts.length === 1 ? { ok: false, error: "offline" } : { ok: true };
    });

    await runner.run(original);
    expect(runner.getFailedPayload()).toBe(original);
    // 模拟用户已经切到了另一书/章/会话；retry 没有 capture 回调可读，只能重放失败对象。
    await runner.retry();

    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toBe(original);
    expect(runner.getFailedPayload()).toBeNull();
    expect(attempts[1]).toEqual({
      projectPath: "/books/a",
      chapter: 3,
      sessionId: "session-a",
      messages: ["old-session-message"],
      revision: 7,
    });
  });

  it("a newer successful payload supersedes an older failed payload for the same save identity", async () => {
    const persisted: string[] = [];
    const attempts: string[] = [];
    const runner = createExactPayloadAutosaveRunner(async (payload: { key: string; sessionId: string; value: string }) => {
      attempts.push(payload.value);
      if (payload.value === "A") return { ok: false, error: "session failed" };
      persisted.push(payload.value);
      return { ok: true };
    }, {
      supersedes: (newer, failed) => newer.key === failed.key && newer.sessionId === failed.sessionId,
    });

    await runner.run({ key: "book::chapter-1", sessionId: "session-a", value: "A" });
    await runner.run({ key: "book::chapter-1", sessionId: "session-a", value: "B" });
    await runner.retry();

    expect(runner.getFailedPayload()).toBeNull();
    expect(attempts).toEqual(["A", "B"]);
    expect(persisted).toEqual(["B"]);
  });

  it("串行 last-write-wins：一笔在写时连发多笔，只跑首笔 + 最后一笔（中间被覆盖丢弃）", async () => {
    const events: string[] = [];
    const first = deferred();

    const p1 = scheduleAutosave("k", async () => {
      events.push("start-1");
      await first.promise;
      events.push("end-1");
    });
    // 首笔运行中，连发三笔 → 只保留最后一笔
    void scheduleAutosave("k", async () => { events.push("run-2"); });
    void scheduleAutosave("k", async () => { events.push("run-3"); });
    const p4 = scheduleAutosave("k", async () => { events.push("run-4"); });

    expect(hasPendingAutosave()).toBe(true);
    first.resolve();
    await Promise.all([p1, p4]);

    expect(events).toEqual(["start-1", "end-1", "run-4"]);
    expect(hasPendingAutosave()).toBe(false);
  });

  it("drainAutosave 等掉在途链，且吞掉写盘错误（不阻断撤销）", async () => {
    const gate = deferred();
    void scheduleAutosave("k", async () => {
      await gate.promise;
      throw new Error("落盘失败");
    });
    const drained = drainAutosave();
    gate.resolve();
    await expect(drained).resolves.toBeUndefined();
  });

  it("状态可见：成功 → saved；失败 → error + lastError（审查 #3）", async () => {
    const seen: string[] = [];
    const unsub = subscribeAutosave((s) => seen.push(s.status));

    await scheduleAutosave("k", async () => { /* ok */ });
    expect(getAutosaveSnapshot().status).toBe("saved");
    expect(getAutosaveSnapshot().lastSavedAt).not.toBeNull();

    await scheduleAutosave("k", async () => { throw new Error("网络断了"); });
    expect(getAutosaveSnapshot().status).toBe("error");
    expect(getAutosaveSnapshot().lastError).toBe("网络断了");

    expect(seen).toContain("saving");
    expect(seen).toContain("saved");
    expect(seen).toContain("error");
    unsub();
  });

  it("不同 key 各自串行，drain 等全部", async () => {
    const a = deferred();
    const b = deferred();
    const order: string[] = [];
    void scheduleAutosave("a", async () => { await a.promise; order.push("a"); });
    void scheduleAutosave("b", async () => { await b.promise; order.push("b"); });
    const drained = drainAutosave();
    b.resolve();
    a.resolve();
    await drained;
    expect(order.sort()).toEqual(["a", "b"]);
    expect(hasPendingAutosave()).toBe(false);
  });

  // —— R4b：按 key 记错、错误优先 ——
  it("A 失败、B 成功 → status 仍 error、lastError 是 A 的信息", async () => {
    await scheduleAutosave("a", async () => { throw new Error("A章失败"); });
    await scheduleAutosave("b", async () => { /* ok */ });
    expect(getAutosaveSnapshot().status).toBe("error");
    expect(getAutosaveSnapshot().lastError).toBe("A章失败");
  });

  it("A 失败后 A 重试成功 → error 清除、status saved", async () => {
    await scheduleAutosave("a", async () => { throw new Error("A章失败"); });
    expect(getAutosaveSnapshot().status).toBe("error");
    await scheduleAutosave("a", async () => { /* ok */ });
    expect(getAutosaveSnapshot().status).toBe("saved");
    expect(getAutosaveSnapshot().lastError).toBeNull();
  });

  it("A 失败、B 也失败 → lastError 更新为最近的错误", async () => {
    await scheduleAutosave("a", async () => { throw new Error("err-A"); });
    await scheduleAutosave("b", async () => { throw new Error("err-B"); });
    expect(getAutosaveSnapshot().status).toBe("error");
    expect(getAutosaveSnapshot().lastError).toBe("err-B");
  });

  it("同 key 重试的状态序列：error → saving → error", async () => {
    const seen: string[] = [];
    const unsub = subscribeAutosave((s) => seen.push(s.status));
    await scheduleAutosave("a", async () => { throw new Error("fail1"); });
    await scheduleAutosave("a", async () => { throw new Error("fail2"); });
    unsub();
    const joined = seen.join(",");
    expect(joined).toMatch(/error.*saving.*error/);
  });

  it("A 失败期间 B 开写 → status 保持 error（错误优先于 saving）", async () => {
    await scheduleAutosave("a", async () => { throw new Error("A挂了"); });
    const gate = deferred();
    void scheduleAutosave("b", async () => { await gate.promise; });
    expect(getAutosaveSnapshot().status).toBe("error");
    expect(getAutosaveSnapshot().lastError).toBe("A挂了");
    expect(getAutosaveSnapshot().hasPending).toBe(true);
    gate.resolve();
    await drainAutosave();
  });
});
