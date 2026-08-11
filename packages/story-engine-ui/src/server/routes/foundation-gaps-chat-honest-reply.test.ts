import { mkdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeHomeTempDir } from "../lib/home-test-tmp.js";
import type { Middleware } from "../lib/project-io.js";

// 一致性校验：消除「说了没写」。模型在同一份 JSON 里分别填 reply（自由文本）与
// generatedSuggestions/draftSuggestion（结构化）。当解析/过滤后最终可落盘的
// suggestions 为空、但 reply 含「整理了 N 条 / 马上写入 / 已写入」这类写入承诺时，
// 不能把这句承诺透传给用户——服务端兜底改写成如实文案。

const storyEngineMocks = vi.hoisted(() => ({
  buildFoundationGapReport: vi.fn(),
  buildFoundationGapSuggestions: vi.fn(),
  buildStateOverview: vi.fn(),
}));

vi.mock("@actalk/story-engine", async () => {
  const actual = await vi.importActual<typeof import("@actalk/story-engine")>("@actalk/story-engine");
  return {
    ...actual,
    ...storyEngineMocks,
  };
});

const llmMocks = vi.hoisted(() => ({
  resolveConfiguredChatModel: vi.fn(),
  callOpenAICompatibleChatModel: vi.fn(),
}));

vi.mock("../lib/llm-client.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/llm-client.js")>("../lib/llm-client.js");
  return {
    ...actual,
    resolveConfiguredChatModel: llmMocks.resolveConfiguredChatModel,
    callOpenAICompatibleChatModel: llmMocks.callOpenAICompatibleChatModel,
  };
});

import { registerFoundationGapsRoutes } from "./foundation-gaps.js";

const { buildFoundationGapReport, buildFoundationGapSuggestions, buildStateOverview } = storyEngineMocks;
const { resolveConfiguredChatModel, callOpenAICompatibleChatModel } = llmMocks;

const WRITE_PROMISE_FRAGMENTS = ["整理了 1 条", "马上写入", "已写入", "都写进去"];

describe("foundation gap chat rewrites a write-promise reply when nothing is archivable", () => {
  let projectDir: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    buildFoundationGapReport.mockResolvedValue({
      readinessLevel: "ok",
      missingItems: [],
      riskyItems: [],
      conflictItems: [],
      byCategory: {},
    });
    buildFoundationGapSuggestions.mockResolvedValue([]);
    buildStateOverview.mockResolvedValue(minimalOverview());
    resolveConfiguredChatModel.mockResolvedValue({
      provider: { id: "p", baseUrl: "https://example.test/v1" },
      profile: { id: "profile-test", model: "test-model", temperature: 0.4, maxTokens: 2000 },
      apiKey: "test-key",
    });
  });

  afterEach(async () => {
    if (projectDir) {
      await rm(projectDir, { recursive: true, force: true });
      projectDir = undefined;
    }
  });

  it("strips the broken 'I will write it in' promise when resolved suggestions are empty", async () => {
    projectDir = await createFoundationRouteProject();
    // 模型嘴上承诺「整理了 1 条，马上写入」，但结构化字段全空——经典的「说了没写」。
    callOpenAICompatibleChatModel.mockResolvedValueOnce({
      content: JSON.stringify({
        reply: "好的，我整理了 1 条，马上写入。",
        intent: "update_character_detail",
        askedQuestions: [],
        draftSuggestion: null,
        missingFields: [],
        generatedSuggestions: [],
        suggestedActions: [],
        safetyWarnings: [],
      }),
      raw: "{}",
      response: undefined,
    });

    const response = await callFoundationGapsRoute("/api/foundation-gaps/chat", {
      projectPath: projectDir,
      userMessage: "记一下：主角怕水",
    });

    expect(response.statusCode).toBe(200);
    const result = (response.payload as { readonly result?: Record<string, unknown> }).result ?? {};
    const reply = String(result.reply ?? "");
    const suggestions = (result.generatedSuggestions ?? []) as readonly unknown[];

    // 前提：确实什么都没落盘。
    expect(suggestions.length).toBe(0);
    expect(result.draftSuggestion ?? null).toBeNull();
    // 不能把任何写入承诺透传给用户。
    for (const fragment of WRITE_PROMISE_FRAGMENTS) {
      expect(reply).not.toContain(fragment);
    }
    // 仍要有如实回报（绝不静默失败）。
    expect(reply.length).toBeGreaterThan(0);
  });

  it("leaves the reply untouched when there is a real archivable suggestion", async () => {
    buildFoundationGapReport.mockResolvedValueOnce({
      readinessLevel: "ok",
      missingItems: [],
      riskyItems: [],
      conflictItems: [],
      byCategory: {},
    });
    projectDir = await createFoundationRouteProject();
    await mkdir(join(projectDir, "characters", "lin-wan"), { recursive: true });
    await writeFile(
      join(projectDir, "characters", "lin-wan", "state.json"),
      `${JSON.stringify({ characterId: "lin-wan", emotion: "冷静", goal: "突破", extraFields: { 境界: "筑基期" } }, null, 2)}\n`,
      "utf-8",
    );
    // 同样的承诺文案，但这次结构化字段真有一条可落盘建议——reply 应原样保留。
    callOpenAICompatibleChatModel.mockResolvedValueOnce({
      content: JSON.stringify({
        reply: "我整理了 1 条：林晚境界更新为金丹期，马上写入。",
        intent: "update_character_detail",
        askedQuestions: [],
        draftSuggestion: null,
        missingFields: [],
        generatedSuggestions: [
          {
            id: "sug-lin-wan-realm",
            category: "characters",
            actionType: "update_character_detail",
            title: "林晚突破金丹期",
            summary: "境界：金丹期",
            requiresUserConfirm: true,
            before: { id: "lin-wan", name: "林晚" },
            after: { extraFields: { 境界: "金丹期" } },
          },
        ],
        suggestedActions: [],
        safetyWarnings: [],
      }),
      raw: "{}",
      response: undefined,
    });

    const response = await callFoundationGapsRoute("/api/foundation-gaps/chat", {
      projectPath: projectDir,
      userMessage: "林晚突破金丹期了",
      directArchive: true,
    });

    expect(response.statusCode).toBe(200);
    const result = (response.payload as { readonly result?: Record<string, unknown> }).result ?? {};
    const reply = String(result.reply ?? "");
    const suggestions = (result.generatedSuggestions ?? []) as readonly unknown[];

    // 前提：真有一条建议落定。
    expect(suggestions.length).toBe(1);
    // 有 suggestions 时 reply 原样不动，承诺仍在。
    expect(reply).toContain("整理了 1 条");
    expect(reply).toContain("马上写入");
  });
});

function minimalOverview(): Record<string, unknown> {
  return {
    project: { title: "Foundation Chat Test", genre: "", currentChapter: null },
    storyStatus: {},
    characters: { knownCharacters: [], protagonist: undefined },
    world: { activeLocations: [], importantFacts: [], summary: undefined },
    writingRules: {
      narrativePerspective: "",
      proseStyle: [],
      pacing: "",
      revealPolicy: "",
      doNotDo: [],
      forbiddenContent: [],
    },
    storyBible: { forbiddenChanges: [], coreMysteries: [], projectLogline: undefined },
    hooks: { activeItems: [] },
    threads: { keyOpenItems: [] },
    arcGoals: { activeItems: [] },
    timeline: { recentEvents: [], earlierSummary: [], macroSummary: [] },
  };
}

async function createFoundationRouteProject(): Promise<string> {
  const root = await makeHomeTempDir("story-engine-ui-foundation-chat-honest-");
  await Promise.all([
    mkdir(join(root, "characters"), { recursive: true }),
    mkdir(join(root, "story"), { recursive: true }),
    mkdir(join(root, "timeline"), { recursive: true }),
    mkdir(join(root, "world"), { recursive: true }),
  ]);
  await writeFile(join(root, "project.json"), `${JSON.stringify({ title: "Foundation Chat Test" }, null, 2)}\n`, "utf-8");
  return root;
}

async function callFoundationGapsRoute(
  path: string,
  body?: Record<string, unknown> | string,
  method: "GET" | "POST" = "POST",
): Promise<{
  readonly statusCode: number;
  readonly payload: Record<string, unknown>;
}> {
  const handlers: Middleware[] = [];
  registerFoundationGapsRoutes({ use: (handler) => handlers.push(handler) });
  const rawBody = typeof body === "string" ? body : body ? JSON.stringify(body) : "";
  const req = Object.assign(Readable.from(rawBody ? [Buffer.from(rawBody)] : []), {
    method,
    url: path,
  }) as IncomingMessage;
  const chunks: Buffer[] = [];
  const res = {
    statusCode: 200,
    setHeader: (name: string, value: string | number | readonly string[]) => {
      void name;
      void value;
      return res as unknown as ServerResponse;
    },
    end: (chunk?: string | Buffer) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return res as unknown as ServerResponse;
    },
  } as unknown as ServerResponse;

  await new Promise<void>((resolve, reject) => {
    const result = handlers[0]?.(req, res, (error?: unknown) => error ? reject(error) : resolve()) as unknown;
    Promise.resolve(result).then(() => resolve(), reject);
  });

  const payload = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>;
  return { statusCode: res.statusCode, payload };
}
