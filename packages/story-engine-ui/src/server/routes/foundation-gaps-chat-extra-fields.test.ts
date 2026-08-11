import { mkdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeHomeTempDir } from "../lib/home-test-tmp.js";
import type { Middleware } from "../lib/project-io.js";

// 引擎只 mock 上下文构建器（report / suggestions / overview），其余（含 collectBookExtraFieldKeys）走真实实现，
// 这样采集器才会真正读临时项目目录里预置的 extraFields，证明「采集 + 透传」链路接通而非恒 undefined。
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

// 截获喂给模型的 messages，并返回合法 JSON，让归档 chat 路由跑完整条链路。
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

describe("foundation gap chat feeds existing extraField keys into the archiver prompt", () => {
  let projectDir: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    buildFoundationGapReport.mockResolvedValue({
      readinessLevel: "ok",
      missingItems: [],
      riskyItems: [],
      conflictItems: [],
    });
    buildFoundationGapSuggestions.mockResolvedValue([]);
    buildStateOverview.mockResolvedValue(minimalOverview());
    resolveConfiguredChatModel.mockResolvedValue({
      provider: { id: "p", baseUrl: "https://example.test/v1" },
      profile: { id: "profile-test", model: "test-model", temperature: 0.4, maxTokens: 2000 },
      apiKey: "test-key",
    });
    callOpenAICompatibleChatModel.mockResolvedValue({
      content: JSON.stringify({
        reply: "好的。",
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
  });

  afterEach(async () => {
    if (projectDir) {
      await rm(projectDir, { recursive: true, force: true });
      projectDir = undefined;
    }
  });

  it("collects 境界 from a character state card and renders it into the system prompt", async () => {
    projectDir = await createFoundationRouteProject();
    // 预置一个角色 state.json，其 extraFields 里有「境界」——这是本书已有的自定义字段。
    await mkdir(join(projectDir, "characters", "guo-xu"), { recursive: true });
    await writeFile(
      join(projectDir, "characters", "guo-xu", "state.json"),
      `${JSON.stringify({ characterId: "guo-xu", emotion: "平静", goal: "查清真相", extraFields: { 境界: "金丹期" } }, null, 2)}\n`,
      "utf-8",
    );

    const response = await callFoundationGapsRoute("/api/foundation-gaps/chat", {
      projectPath: projectDir,
      userMessage: "林远的修为是元婴期，记一下。",
    });

    expect(response.statusCode).toBe(200);
    expect(callOpenAICompatibleChatModel).toHaveBeenCalledTimes(1);

    const messages = callOpenAICompatibleChatModel.mock.calls[0]?.[0]?.messages as readonly { readonly role: string; readonly content: string }[];
    const systemPrompt = messages.find((m) => m.role === "system")?.content ?? "";
    // 证明：采集出的已有字段名「境界」真的进了 system prompt（而非恒 undefined）。
    expect(systemPrompt).toContain("本书已有的自定义字段：境界");
    // 并且复用指令本身仍在，闭环完整。
    expect(systemPrompt).toContain("归档时优先复用本书已有的自定义字段");
  });

  it("renders the no-custom-field line when the book has no extraFields yet", async () => {
    projectDir = await createFoundationRouteProject();

    const response = await callFoundationGapsRoute("/api/foundation-gaps/chat", {
      projectPath: projectDir,
      userMessage: "林远新增一个朋友角色赵磊。",
    });

    expect(response.statusCode).toBe(200);
    const messages = callOpenAICompatibleChatModel.mock.calls[0]?.[0]?.messages as readonly { readonly role: string; readonly content: string }[];
    const systemPrompt = messages.find((m) => m.role === "system")?.content ?? "";
    expect(systemPrompt).toContain("本书暂无自定义字段");
    expect(systemPrompt).not.toContain("本书已有的自定义字段：");
  });

  it("unions keys across character, location, asset, and world cards into the prompt", async () => {
    projectDir = await createFoundationRouteProject();
    await mkdir(join(projectDir, "characters", "lin-wan"), { recursive: true });
    await writeFile(
      join(projectDir, "characters", "lin-wan", "state.json"),
      `${JSON.stringify({ characterId: "lin-wan", emotion: "冷静", goal: "复仇", extraFields: { 境界: "筑基" } }, null, 2)}\n`,
      "utf-8",
    );
    await writeFile(
      join(projectDir, "story", "location-bible.json"),
      `${JSON.stringify({ version: "v0", locations: [{ id: "loc-1", name: "雷宗", extraFields: { 阵营: "正道" } }] }, null, 2)}\n`,
      "utf-8",
    );
    await writeFile(
      join(projectDir, "story", "assets.json"),
      `${JSON.stringify({ version: "v0", assets: [{ id: "a-1", name: "奔雷剑", extraFields: { 功法: ["奔雷诀"] } }], containers: [] }, null, 2)}\n`,
      "utf-8",
    );
    await writeFile(
      join(projectDir, "world", "state.json"),
      `${JSON.stringify({ currentPhase: "开局", activeConflicts: [], activeHooks: [], knownSecrets: [], extraFields: { 灵气浓度: "稀薄" } }, null, 2)}\n`,
      "utf-8",
    );

    const response = await callFoundationGapsRoute("/api/foundation-gaps/chat", {
      projectPath: projectDir,
      userMessage: "把这些资料整理一下。",
    });

    expect(response.statusCode).toBe(200);
    const messages = callOpenAICompatibleChatModel.mock.calls[0]?.[0]?.messages as readonly { readonly role: string; readonly content: string }[];
    const systemPrompt = messages.find((m) => m.role === "system")?.content ?? "";
    for (const key of ["境界", "阵营", "功法", "灵气浓度"]) {
      expect(systemPrompt).toContain(key);
    }
    expect(systemPrompt).toContain("本书已有的自定义字段：");
  });

  // F2: directArchive 透传到路由 → 决断式 system prompt，且模型产出的 extraFields 建议被原样返回。
  it("threads directArchive into the decisive prompt and returns an extraFields suggestion", async () => {
    // 真实 buildFoundationGapReport 总会带 byCategory（见 foundation-gap-assistant.ts）；
    // readGeneratedFoundationGapSuggestions 会用它兜底 gapId，所以本用例补全这个键。
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

    // mock 模型：决断式抽取出一条 update_character_detail，after.extraFields={境界:金丹期}。
    callOpenAICompatibleChatModel.mockResolvedValueOnce({
      content: JSON.stringify({
        reply: "我整理了 1 条：林晚境界更新为金丹期。",
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
    expect(callOpenAICompatibleChatModel).toHaveBeenCalledTimes(1);

    // ① directArchive 透传到 prompt：system message 含决断式指令。
    const messages = callOpenAICompatibleChatModel.mock.calls[0]?.[0]?.messages as readonly { readonly role: string; readonly content: string }[];
    const systemPrompt = messages.find((m) => m.role === "system")?.content ?? "";
    expect(systemPrompt).toContain("强制产出 generatedSuggestions");
    expect(systemPrompt).toContain("已分诊");

    // ② 模型产出的 extraFields 建议原样回到响应（解析正常）。
    const result = (response.payload as { readonly result?: { readonly generatedSuggestions?: readonly Record<string, unknown>[] } }).result;
    const suggestions = result?.generatedSuggestions ?? [];
    expect(suggestions.length).toBe(1);
    const after = suggestions[0]?.after as { readonly extraFields?: Record<string, unknown> } | undefined;
    expect(after?.extraFields?.["境界"]).toBe("金丹期");
  });

  // H4 兜底安全网：directArchive 下模型「听懂了却没吐出可写卡」(合法 JSON 但 generatedSuggestions:[])时，
  // 对「她家在城南」这类「代词/主角 + 家在/住在 + 地点」高把握句式，由代码确定性补一条角色居所卡。
  it("safety-nets 她家在城南 to a protagonist residence card when the model returns empty (case A)", async () => {
    buildFoundationGapReport.mockResolvedValueOnce({
      readinessLevel: "ok", missingItems: [], riskyItems: [], conflictItems: [], byCategory: {},
    });
    buildStateOverview.mockResolvedValueOnce(overviewWithProtagonist());
    projectDir = await createFoundationRouteProject();

    // 模型「听懂但没吐卡」：合法 JSON、intent 对、但 generatedSuggestions 空、还说被禁止的「没有谈妥」。
    callOpenAICompatibleChatModel.mockResolvedValueOnce({
      content: JSON.stringify({
        reply: "其中“居所”是我新增的自定义字段。这次没有谈妥可以直接落盘的资料点，所以没有写入任何文件。",
        intent: "update_character_detail",
        askedQuestions: [], draftSuggestion: null, missingFields: [],
        generatedSuggestions: [], suggestedActions: [], safetyWarnings: [],
      }),
      raw: "{}", response: undefined,
    });

    const response = await callFoundationGapsRoute("/api/foundation-gaps/chat", {
      projectPath: projectDir,
      userMessage: "她家在城南",
      directArchive: true,
    });

    expect(response.statusCode).toBe(200);
    const result = (response.payload as { readonly result?: Record<string, unknown> }).result ?? {};
    const suggestions = (result.generatedSuggestions ?? []) as readonly Record<string, unknown>[];
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]?.actionType).toBe("update_character_detail");
    expect(suggestions[0]?.targetId).toBe("lin-wan");
    const after = suggestions[0]?.after as { readonly extraFields?: Record<string, unknown> } | undefined;
    expect(after?.extraFields?.["居所"]).toBe("城南");
    // 绝不再把模型那句「没有谈妥」透传给用户。
    expect(String(result.reply ?? "")).not.toContain("没有谈妥");
  });

  // case B：模型返回非法 JSON → 抛错 → catch 走确定性兜底，同样应补出居所卡（而非空）。
  it("safety-nets 她家在城南 even when the model throws invalid JSON (case B)", async () => {
    buildFoundationGapReport.mockResolvedValueOnce({
      readinessLevel: "ok", missingItems: [], riskyItems: [], conflictItems: [], byCategory: {},
    });
    buildStateOverview.mockResolvedValueOnce(overviewWithProtagonist());
    projectDir = await createFoundationRouteProject();

    callOpenAICompatibleChatModel.mockResolvedValueOnce({
      content: "这不是合法 JSON{{{", raw: "{}", response: undefined,
    });

    const response = await callFoundationGapsRoute("/api/foundation-gaps/chat", {
      projectPath: projectDir,
      userMessage: "她家在城南",
      directArchive: true,
    });

    expect(response.statusCode).toBe(200);
    const result = (response.payload as { readonly result?: Record<string, unknown> }).result ?? {};
    const suggestions = (result.generatedSuggestions ?? []) as readonly Record<string, unknown>[];
    expect(suggestions.length).toBe(1);
    const after = suggestions[0]?.after as { readonly extraFields?: Record<string, unknown> } | undefined;
    expect(after?.extraFields?.["居所"]).toBe("城南");
  });

  it("keeps the interactive ask-first prompt when directArchive is omitted", async () => {
    projectDir = await createFoundationRouteProject();

    const response = await callFoundationGapsRoute("/api/foundation-gaps/chat", {
      projectPath: projectDir,
      userMessage: "林晚突破金丹期了",
    });

    expect(response.statusCode).toBe(200);
    const messages = callOpenAICompatibleChatModel.mock.calls[0]?.[0]?.messages as readonly { readonly role: string; readonly content: string }[];
    const systemPrompt = messages.find((m) => m.role === "system")?.content ?? "";
    expect(systemPrompt).not.toContain("强制产出 generatedSuggestions");
    expect(systemPrompt).toContain("先问 3-5 个最关键的问题");
  });
});

function overviewWithProtagonist(): Record<string, unknown> {
  return {
    ...minimalOverview(),
    characters: {
      protagonist: "林晚",
      knownCharacters: [{ id: "lin-wan", name: "林晚", role: "主角", status: "在场" }],
    },
  };
}

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
  const root = await makeHomeTempDir("story-engine-ui-foundation-chat-extra-");
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
