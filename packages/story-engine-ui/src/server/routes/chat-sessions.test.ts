import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { makeHomeTempDir } from "../lib/home-test-tmp.js";
import type { Middleware } from "../lib/project-io.js";
import { registerChatSessionsRoutes } from "./chat-sessions.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed a minimal valid StoryEngine-NG project directory. */
async function realProject(): Promise<string> {
  const dir = await makeHomeTempDir("chat-sessions-routes-");
  await Promise.all([
    mkdir(join(dir, "story"), { recursive: true }),
    mkdir(join(dir, "timeline"), { recursive: true }),
    mkdir(join(dir, "world"), { recursive: true }),
    mkdir(join(dir, "characters"), { recursive: true }),
  ]);
  await writeFile(
    join(dir, "project.json"),
    `${JSON.stringify({ title: "Chat Sessions Test" }, null, 2)}\n`,
    "utf-8",
  );
  return dir;
}

/** Build a mock GET IncomingMessage. */
function makeGet(url: string): IncomingMessage {
  return Object.assign(Readable.from([]), { method: "GET", url }) as IncomingMessage;
}

/** Build a mock PUT IncomingMessage with a JSON body. */
function makePut(body: Record<string, unknown>): IncomingMessage {
  return Object.assign(
    Readable.from([Buffer.from(JSON.stringify(body))]),
    { method: "PUT", url: "/api/chat-sessions" },
  ) as IncomingMessage;
}

interface MockRes {
  statusCode: number;
  body: string;
}

function makeRes(): MockRes & ServerResponse {
  const chunks: Buffer[] = [];
  const res = {
    statusCode: 200,
    get body() { return Buffer.concat(chunks).toString("utf-8"); },
    setHeader: () => res as unknown as ServerResponse,
    end: (chunk?: string | Buffer) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return res as unknown as ServerResponse;
    },
  };
  return res as unknown as MockRes & ServerResponse;
}

async function drive(req: IncomingMessage): Promise<MockRes> {
  const handlers: Middleware[] = [];
  registerChatSessionsRoutes({ use: (h) => handlers.push(h) });
  const res = makeRes();
  await new Promise<void>((resolve, reject) => {
    const result = handlers[0]?.(req, res as unknown as ServerResponse, (err?: unknown) =>
      err ? reject(err) : resolve(),
    ) as unknown;
    Promise.resolve(result).then(() => resolve(), reject);
  });
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/api/chat-sessions 路由", () => {
  it("GET ?list=1 — 自动建默认会话并返回 ok+index", async () => {
    const dir = await realProject();
    const res = await drive(makeGet(`/api/chat-sessions?list=1&project=${encodeURIComponent(dir)}`));
    const payload = JSON.parse(res.body) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    const index = payload.index as { sessions: unknown[] };
    expect(index.sessions.length).toBeGreaterThanOrEqual(1);
  });

  it("PUT create — 建会话后返回 ok + session + index", async () => {
    const dir = await realProject();
    const res = await drive(makePut({ action: "create", projectPath: dir, name: "X" }));
    const payload = JSON.parse(res.body) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect((payload.session as { name: string }).name).toBe("X");
    const index = payload.index as { sessions: { id: string; name: string }[] };
    expect(index.sessions).toHaveLength(1);
    expect(index.sessions.some((s) => s.name === "X")).toBe(true);
  });

  it("PUT rename — 改名后 index 里 name 更新", async () => {
    const dir = await realProject();
    const created = JSON.parse(
      (await drive(makePut({ action: "create", projectPath: dir, name: "X" }))).body,
    ) as { session: { id: string } };
    const id = created.session.id;

    const renamed = JSON.parse(
      (await drive(makePut({ action: "rename", projectPath: dir, id, name: "Y" }))).body,
    ) as { ok: boolean; index: { sessions: { id: string; name: string }[] } };
    expect(renamed.ok).toBe(true);
    expect(renamed.index.sessions.find((s) => s.id === id)?.name).toBe("Y");
  });

  it("PUT save — 保存消息返回 ok:true", async () => {
    const dir = await realProject();
    const created = JSON.parse(
      (await drive(makePut({ action: "create", projectPath: dir, name: "SaveTest" }))).body,
    ) as { session: { id: string } };
    const id = created.session.id;

    const messages = [{ id: "user-1234567890", role: "user", content: "你好" }];
    const saved = JSON.parse(
      (await drive(makePut({ action: "save", projectPath: dir, id, messages }))).body,
    ) as { ok: boolean };
    expect(saved.ok).toBe(true);
  });

  it("PUT delete — 删除会话返回 ok:true + index", async () => {
    const dir = await realProject();
    const created = JSON.parse(
      (await drive(makePut({ action: "create", projectPath: dir, name: "ToDelete" }))).body,
    ) as { session: { id: string } };
    const id = created.session.id;

    const deleted = JSON.parse(
      (await drive(makePut({ action: "delete", projectPath: dir, id }))).body,
    ) as { ok: boolean; index: { sessions: { id: string }[]; activeSessionId: string }; session: { id: string } };
    expect(deleted.ok).toBe(true);
    expect(deleted.index.sessions.every((s) => s.id !== id)).toBe(true);
    expect(deleted.session.id).toBe(deleted.index.activeSessionId);
  });

  it("PUT setActive — 设置活跃会话返回 ok:true + 正确 activeSessionId", async () => {
    const dir = await realProject();
    const s1 = JSON.parse(
      (await drive(makePut({ action: "create", projectPath: dir, name: "S1" }))).body,
    ) as { session: { id: string } };
    const s2 = JSON.parse(
      (await drive(makePut({ action: "create", projectPath: dir, name: "S2" }))).body,
    ) as { session: { id: string } };

    const result = JSON.parse(
      (await drive(makePut({ action: "setActive", projectPath: dir, id: s1.session.id }))).body,
    ) as { ok: boolean; index: { activeSessionId: string }; session: { id: string } };
    expect(result.ok).toBe(true);
    expect(result.index.activeSessionId).toBe(s1.session.id);
    expect(result.session.id).toBe(s1.session.id);
    void s2; // created but not checked further
  });

  it("PUT archive — 归档消息返回 ok:true", async () => {
    const dir = await realProject();
    const created = JSON.parse(
      (await drive(makePut({ action: "create", projectPath: dir, name: "ArchiveTest" }))).body,
    ) as { session: { id: string } };
    const id = created.session.id;

    const result = JSON.parse(
      (await drive(makePut({ action: "archive", projectPath: dir, id }))).body,
    ) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("PUT unarchive — 解档返回 ok:true", async () => {
    const dir = await realProject();
    const created = JSON.parse(
      (await drive(makePut({ action: "create", projectPath: dir, name: "UnarchiveTest" }))).body,
    ) as { session: { id: string } };
    const id = created.session.id;

    const result = JSON.parse(
      (await drive(makePut({ action: "unarchive", projectPath: dir, id }))).body,
    ) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("GET ?session=id — 读单个会话", async () => {
    const dir = await realProject();
    const created = JSON.parse(
      (await drive(makePut({ action: "create", projectPath: dir, name: "SingleRead" }))).body,
    ) as { session: { id: string } };
    const id = created.session.id;

    const res = await drive(
      makeGet(`/api/chat-sessions?session=${encodeURIComponent(id)}&project=${encodeURIComponent(dir)}`),
    );
    const payload = JSON.parse(res.body) as { ok: boolean; session: { id: string } | null };
    expect(payload.ok).toBe(true);
    expect(payload.session?.id).toBe(id);
  });

  it("PUT 未知 action — 返回 ok:false + error", async () => {
    const dir = await realProject();
    const res = await drive(makePut({ action: "bogus", projectPath: dir }));
    const payload = JSON.parse(res.body) as { ok: boolean; error: string };
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/bogus/);
  });

  it("GET 无 list 也无 session — 返回 500 ok:false（缺 session id）", async () => {
    const dir = await realProject();
    const res = await drive(makeGet(`/api/chat-sessions?project=${encodeURIComponent(dir)}`));
    const payload = JSON.parse(res.body) as { ok: boolean };
    expect(payload.ok).toBe(false);
  });

  it("不匹配 URL — 调用 next() 不响应", async () => {
    const handlers: Middleware[] = [];
    registerChatSessionsRoutes({ use: (h) => handlers.push(h) });
    const req = Object.assign(Readable.from([]), {
      method: "GET",
      url: "/api/other-thing",
    }) as IncomingMessage;
    const res = makeRes();
    let nexted = false;
    await new Promise<void>((resolve) => {
      handlers[0]?.(req, res as unknown as ServerResponse, () => { nexted = true; resolve(); });
    });
    expect(nexted).toBe(true);
    expect(res.body).toBe("");
  });
});
