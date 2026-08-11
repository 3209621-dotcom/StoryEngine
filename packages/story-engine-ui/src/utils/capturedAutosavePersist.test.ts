import { describe, expect, it, vi } from "vitest";
import { persistCapturedAutosavePayload, type CapturedAutosavePayload } from "./capturedAutosavePersist.js";
import { createExactPayloadAutosaveRunner } from "./autosaveControl.js";

describe("persistCapturedAutosavePayload", () => {
  it("CAS-gates the workspace before session messages and retries only the failed session stage", async () => {
    const payload = {
      key: "book-a::chapter-1",
      request: { projectPath: "/books/a", chapter: 1, selectedAdviceCardKeys: [], expectedRevision: 5 },
      sessionId: "session-a",
      messages: ["exact old-session payload"],
    };
    const saveWorkspace = vi.fn(async () => ({
      chapter: 1, messages: [], selectedAdviceCardKeys: [], revision: 6,
    }));
    const saveSession = vi.fn()
      .mockRejectedValueOnce(new Error("session disk failed"))
      .mockResolvedValueOnce({ ok: true });

    await expect(persistCapturedAutosavePayload(payload, { saveWorkspace, saveSession }))
      .rejects.toThrow("session disk failed");
    await expect(persistCapturedAutosavePayload(payload, { saveWorkspace, saveSession }))
      .resolves.toMatchObject({ revision: 6 });

    expect(saveWorkspace).toHaveBeenCalledTimes(1);
    expect(saveSession).toHaveBeenCalledTimes(2);
    expect(saveSession).toHaveBeenLastCalledWith("/books/a", "session-a", payload.messages);
  });

  it("never writes stale session messages when workspace CAS rejects first", async () => {
    const payload = {
      key: "book-a::chapter-1",
      request: { projectPath: "/books/a", chapter: 1, selectedAdviceCardKeys: [], expectedRevision: 5 },
      sessionId: "session-a",
      messages: ["stale messages"],
    };
    const saveWorkspace = vi.fn(async () => { throw new Error("revision conflict"); });
    const saveSession = vi.fn();

    await expect(persistCapturedAutosavePayload(payload, { saveWorkspace, saveSession }))
      .rejects.toThrow("revision conflict");
    expect(saveSession).not.toHaveBeenCalled();
  });

  it("A session failure is superseded by newer B success so automatic retry cannot restore A", async () => {
    let revision = 5;
    let sessionDisk = "";
    let failAOnce = true;
    const saveWorkspace = vi.fn(async (request: { expectedRevision?: number }) => ({
      chapter: 1,
      messages: [],
      selectedAdviceCardKeys: [],
      revision: ++revision,
      expectedRevision: request.expectedRevision,
    }));
    const saveSession = vi.fn(async (_project: string, _session: string, messages: readonly string[]) => {
      if (messages[0] === "A" && failAOnce) {
        failAOnce = false;
        throw new Error("A session failed");
      }
      sessionDisk = messages[0] ?? "";
    });
    type Payload = CapturedAutosavePayload<readonly string[]>;
    const runner = createExactPayloadAutosaveRunner<Payload>(async (payload) => {
      try {
        await persistCapturedAutosavePayload(payload, { saveWorkspace: saveWorkspace as never, saveSession });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }, { supersedes: (newer, failed) => newer.key === failed.key && newer.sessionId === failed.sessionId });
    const a: Payload = {
      key: "book-a::1", request: { projectPath: "/books/a", chapter: 1, selectedAdviceCardKeys: [], expectedRevision: 5 },
      sessionId: "session-a", messages: ["A"],
    };
    const b: Payload = {
      key: "book-a::1", request: { projectPath: "/books/a", chapter: 1, selectedAdviceCardKeys: [], expectedRevision: 6 },
      sessionId: "session-a", messages: ["B"],
    };

    await runner.run(a);
    await runner.run(b);
    await runner.retry();

    expect(sessionDisk).toBe("B");
    expect(saveSession).toHaveBeenCalledTimes(2);
    expect(runner.getFailedPayload()).toBeNull();
  });
});
