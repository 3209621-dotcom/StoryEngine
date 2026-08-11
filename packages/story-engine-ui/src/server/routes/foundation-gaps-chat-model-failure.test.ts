import { mkdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeHomeTempDir } from "../lib/home-test-tmp.js";
import type { Middleware } from "../lib/project-io.js";

// 健壮性回归（G3）：
// 修 1 —— 模型调用失败（超时 / 非 JSON / 空内容 / 网络抛错）被 catch 兜底时，绝不静默吞掉错误：
//   响应必须带上诊断（safetyWarnings 含 foundation_model_call_failed: <reason>），且 reply 仍是友好兜底文案、
//   不把错误 stack 泄给终端用户。
// 修 2 —— directArchive=true 时，确定性兜底绕过「写入动词 / intent」门槛，对带明确实体的裸陈述句尽力抽取；
//   非 directArchive 同输入保持原门槛（无写入动词 → 空），不破坏交互体验。

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

describe("foundation gap chat surfaces swallowed model errors and hardens direct-archive fallback", () => {
  let projectDir: string | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
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
    consoleErrorSpy.mockRestore();
    if (projectDir) {
      await rm(projectDir, { recursive: true, force: true });
      projectDir = undefined;
    }
  });

  // ---- 修 1：透出被吞掉的模型错误 ----

  it("surfaces a model rejection as a diagnostic instead of silently swallowing it", async () => {
    projectDir = await createFoundationRouteProject();
    callOpenAICompatibleChatModel.mockRejectedValueOnce(new Error("ETIMEDOUT connecting upstream"));

    const response = await callFoundationGapsRoute("/api/foundation-gaps/chat", {
      projectPath: projectDir,
      userMessage: "记一下：主角怕水",
      directArchive: true,
    });

    expect(response.statusCode).toBe(200);
    const result = (response.payload as { readonly result?: Record<string, unknown> }).result ?? {};
    const safetyWarnings = (result.safetyWarnings ?? []) as readonly string[];
    const reply = String(result.reply ?? "");

    // 绝不静默：诊断字段必须透出「模型调用挂了」。
    expect(safetyWarnings.some((warning) => warning.startsWith("foundation_model_call_failed"))).toBe(true);
    expect(safetyWarnings.join("\n")).toContain("ETIMEDOUT");
    // 必须记日志（带上下文），方便 Codex 诊断。
    expect(consoleErrorSpy).toHaveBeenCalled();
    const loggedContext = consoleErrorSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(loggedContext).toContain("foundation");
    // reply 仍是友好兜底文案，绝不把错误 stack / "Error:" 泄给终端用户。
    expect(reply.length).toBeGreaterThan(0);
    expect(reply).not.toContain("ETIMEDOUT");
    expect(reply).not.toContain("Error:");
    expect(reply).not.toContain("at ");
  });

  it("surfaces a non-JSON model response as a diagnostic", async () => {
    projectDir = await createFoundationRouteProject();
    callOpenAICompatibleChatModel.mockResolvedValueOnce({
      content: "这不是 JSON，模型跑偏了。",
      raw: "{}",
      response: undefined,
    });

    const response = await callFoundationGapsRoute("/api/foundation-gaps/chat", {
      projectPath: projectDir,
      userMessage: "记一下：主角怕水",
      directArchive: true,
    });

    expect(response.statusCode).toBe(200);
    const result = (response.payload as { readonly result?: Record<string, unknown> }).result ?? {};
    const safetyWarnings = (result.safetyWarnings ?? []) as readonly string[];
    const reply = String(result.reply ?? "");

    expect(safetyWarnings.some((warning) => warning.startsWith("foundation_model_call_failed"))).toBe(true);
    expect(reply.length).toBeGreaterThan(0);
    // 不泄露原始模型脏内容里可能带的指纹（这里至少保证不复读完整脏串当作 reply）。
    expect(reply).not.toContain("Error:");
  });

  // ---- 修 2：directArchive 兜底加固 ----

  it("extracts a bare-statement entity in direct-archive mode when the model call fails", async () => {
    projectDir = await createFoundationRouteProject();
    // 明确实体的裸陈述句：「城南有家面馆叫老周面馆」。无写入动词、无显式 intent，
    // 既有交互门槛会产 0 条；directArchive 下应尽力抽出一条地点草案。
    callOpenAICompatibleChatModel.mockRejectedValueOnce(new Error("upstream 500"));

    const response = await callFoundationGapsRoute("/api/foundation-gaps/chat", {
      projectPath: projectDir,
      userMessage: "城南有家面馆叫老周面馆",
      directArchive: true,
    });

    expect(response.statusCode).toBe(200);
    const result = (response.payload as { readonly result?: Record<string, unknown> }).result ?? {};
    const suggestions = (result.generatedSuggestions ?? []) as readonly Record<string, unknown>[];

    // 兜底应抽出至少一条建议（绕过写入动词门槛）。
    expect(suggestions.length).toBeGreaterThan(0);
    // 抽出的实体名要落在建议里（证明不是凭空造卡，而是抽了「老周面馆」）。
    const serialized = JSON.stringify(suggestions);
    expect(serialized).toContain("老周面馆");
    // 仍透出模型失败诊断（修 1 不被修 2 覆盖）。
    const safetyWarnings = (result.safetyWarnings ?? []) as readonly string[];
    expect(safetyWarnings.some((warning) => warning.startsWith("foundation_model_call_failed"))).toBe(true);
  });

  it("keeps the original write-verb gate for the same bare statement when NOT in direct-archive mode", async () => {
    projectDir = await createFoundationRouteProject();
    callOpenAICompatibleChatModel.mockRejectedValueOnce(new Error("upstream 500"));

    const response = await callFoundationGapsRoute("/api/foundation-gaps/chat", {
      projectPath: projectDir,
      userMessage: "城南有家面馆叫老周面馆",
      // directArchive 缺省 = 交互面板，保持原门槛。
    });

    expect(response.statusCode).toBe(200);
    const result = (response.payload as { readonly result?: Record<string, unknown> }).result ?? {};
    const suggestions = (result.generatedSuggestions ?? []) as readonly unknown[];

    // 交互面板：无写入动词 → 不绕门槛，仍产 0 条（不破坏交互体验）。
    expect(suggestions.length).toBe(0);
    // 即便如此，模型失败诊断仍应透出。
    const safetyWarnings = (result.safetyWarnings ?? []) as readonly string[];
    expect(safetyWarnings.some((warning) => warning.startsWith("foundation_model_call_failed"))).toBe(true);
  });

  it("honestly returns empty (no fabricated card) for an ambiguous-referent bare statement in direct-archive mode", async () => {
    projectDir = await createFoundationRouteProject();
    callOpenAICompatibleChatModel.mockRejectedValueOnce(new Error("upstream 500"));

    const response = await callFoundationGapsRoute("/api/foundation-gaps/chat", {
      projectPath: projectDir,
      // 指代不明（她=谁？whose home?）：兜底诚实失败，不硬塞角色卡。
      userMessage: "她家在城南",
      directArchive: true,
    });

    expect(response.statusCode).toBe(200);
    const result = (response.payload as { readonly result?: Record<string, unknown> }).result ?? {};
    const suggestions = (result.generatedSuggestions ?? []) as readonly Record<string, unknown>[];

    // 抽不出可靠结构 → 如实返回空，不凭空造「她」这个角色卡。
    const fabricatedCharacterCard = suggestions.some(
      (suggestion) => suggestion.actionType === "create_character",
    );
    expect(fabricatedCharacterCard).toBe(false);
    // reply 仍如实回报（绝不静默），且模型失败诊断透出。
    expect(String(result.reply ?? "").length).toBeGreaterThan(0);
    const safetyWarnings = (result.safetyWarnings ?? []) as readonly string[];
    expect(safetyWarnings.some((warning) => warning.startsWith("foundation_model_call_failed"))).toBe(true);
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
  const root = await makeHomeTempDir("story-engine-ui-foundation-chat-failure-");
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
