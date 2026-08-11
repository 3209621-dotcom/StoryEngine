import { afterEach, describe, expect, it, vi } from "vitest";
import { listChatSessions, archiveChatSession } from "./chatSessionsClient.js";

afterEach(() => vi.restoreAllMocks());

describe("chatSessionsClient", () => {
  it("list 命中 GET /api/chat-sessions?list=1", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, index: { sessions: [], activeSessionId: "x" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await listChatSessions("/p");
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit?][];
    expect(calls[0][0]).toContain("/api/chat-sessions?list=1");
    expect(r.index.activeSessionId).toBe("x");
  });

  it("archive 用 PUT + action:archive", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, archivedCount: 5, tokensBefore: 100, tokensAfter: 40 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await archiveChatSession("/p", "sid");
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit?][];
    const init = calls[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body)).action).toBe("archive");
    expect(r.archivedCount).toBe(5);
  });
});
