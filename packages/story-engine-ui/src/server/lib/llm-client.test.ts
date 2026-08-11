import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelSettingsLoadResult } from "@actalk/story-engine";

const storyEngineMocks = vi.hoisted(() => ({
  loadModelSettingsV0: vi.fn(),
}));

vi.mock("@actalk/story-engine", async () => {
  const actual = await vi.importActual<typeof import("@actalk/story-engine")>("@actalk/story-engine");
  return {
    ...actual,
    ...storyEngineMocks,
  };
});

// resolveConfiguredChatModel 现在会读 task-assignments 旁路合成 thinking/profileId。
// 直接 mock 本地模块的 readTaskAssignments（比 mock node:os 内部 homedir() 稳），其余纯函数走 actual。
const taskAssignMocks = vi.hoisted(() => ({ readTaskAssignments: vi.fn() }));
vi.mock("./task-assignments.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-assignments.js")>();
  return { ...actual, readTaskAssignments: taskAssignMocks.readTaskAssignments };
});

import { callOpenAICompatibleChatModel, createIdleAbort, createOpenAICompatibleWriterClient, resolveConfiguredChatModel, streamChatModelToText, streamOpenAICompatibleResponse } from "./llm-client.js";

const { loadModelSettingsV0 } = storyEngineMocks;

function settingsWithoutTriage(): ModelSettingsLoadResult {
  return {
    passed: true,
    available: true,
    status: "loaded",
    configPath: "/tmp/model-settings.json",
    issues: [],
    summary: {
      available: true,
      status: "loaded",
      configPath: "/tmp/model-settings.json",
      defaultProvider: "main",
      defaultProfile: "balanced",
      providers: [
        {
          id: "main",
          type: "openai-compatible",
          baseUrl: "https://api.example.invalid/v1",
          apiKeyStatus: "not_required",
        },
      ],
      profiles: [
        {
          id: "balanced",
          provider: "main",
          model: "balanced-model",
        },
        {
          id: "fast",
          provider: "main",
          model: "fast-model",
        },
      ],
      taskProfiles: {
        qualityCheck: "fast",
        chapterSteering: "balanced",
      },
      issueCount: 0,
      highRiskIssueCount: 0,
    },
  };
}

describe("createIdleAbort（空闲超时：有字节就续命、彻底静默才判死）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("从不 kick：静默超过 idleMs 后 abort", () => {
    const idle = createIdleAbort(1000);
    expect(idle.controller.signal.aborted).toBe(false);
    vi.advanceTimersByTime(999);
    expect(idle.controller.signal.aborted).toBe(false);
    vi.advanceTimersByTime(2);
    expect(idle.controller.signal.aborted).toBe(true);
    idle.dispose();
  });

  it("持续 kick：永不 abort（有输出就续命，不设总时长上限）", () => {
    const idle = createIdleAbort(1000);
    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(900); // 每次都在窗口内
      idle.kick();
    }
    // 总共过了 9000ms，远超 idleMs，但因持续 kick 从未静默达 1000ms
    expect(idle.controller.signal.aborted).toBe(false);
    idle.dispose();
  });

  it("kick 后再次静默达 idleMs → abort", () => {
    const idle = createIdleAbort(1000);
    vi.advanceTimersByTime(500);
    idle.kick();
    vi.advanceTimersByTime(500); // 距上次 kick 仅 500ms
    expect(idle.controller.signal.aborted).toBe(false);
    vi.advanceTimersByTime(600); // 距上次 kick 共 1100ms > 1000
    expect(idle.controller.signal.aborted).toBe(true);
    idle.dispose();
  });

  it("abort 后 kick 不复活", () => {
    const idle = createIdleAbort(1000);
    vi.advanceTimersByTime(1100);
    expect(idle.controller.signal.aborted).toBe(true);
    idle.kick();
    expect(idle.controller.signal.aborted).toBe(true);
    idle.dispose();
  });
});

describe("streamOpenAICompatibleResponse onActivity（每收到一块字节就回调，用于续命）", () => {
  function sseResponse(chunks: readonly string[]): globalThis.Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }

  it("正文 + 思考 delta 都累加，且 onActivity 在收到字节时被触发", async () => {
    const response = sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "想…" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "正文A" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "正文B" } }] })}\n\n`,
      "data: [DONE]\n\n",
    ]);
    const deltas: string[] = [];
    const thinks: string[] = [];
    let activity = 0;
    const out = await streamOpenAICompatibleResponse(
      response,
      (delta) => deltas.push(delta),
      (delta) => thinks.push(delta),
      () => {
        activity += 1;
      },
    );
    expect(out.content).toBe("正文A正文B");
    expect(out.thinking).toBe("想…");
    expect(deltas).toEqual(["正文A", "正文B"]);
    expect(thinks).toEqual(["想…"]);
    expect(activity).toBeGreaterThan(0);
  });
});

describe("resolveConfiguredChatModel triage fallback", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to the qualityCheck profile when triage is not configured", async () => {
    loadModelSettingsV0.mockResolvedValue(settingsWithoutTriage());
    taskAssignMocks.readTaskAssignments.mockResolvedValue({ file: null, corrupt: false });

    const resolved = await resolveConfiguredChatModel("triage");

    expect(resolved.profile.id).toBe("fast");
    expect(resolved.profile.model).toBe("fast-model");
  });

  it("审查 #9：显式指定的 profileId 不存在 → 明确报错，绝不静默切到 profiles[0]", async () => {
    loadModelSettingsV0.mockResolvedValue(settingsWithoutTriage());
    taskAssignMocks.readTaskAssignments.mockResolvedValue({
      file: { version: 1, tasks: { fastDraft: { profileId: "ghost-profile", thinking: true } } },
      corrupt: false,
    });
    await expect(resolveConfiguredChatModel("fastDraft")).rejects.toThrow(/ghost-profile/);
  });
});

describe("resolveConfiguredChatModel 合成思考开关（旁路）", () => {
  it("旁路把 fastDraft 思考设为 false → 返回 thinking:false + 用旁路 profileId；未配置任务默认 thinking:true", async () => {
    loadModelSettingsV0.mockResolvedValue(settingsWithoutTriage());
    taskAssignMocks.readTaskAssignments.mockResolvedValue({
      file: { version: 1, tasks: { fastDraft: { profileId: "fast", thinking: false } } },
      corrupt: false,
    });

    const draft = await resolveConfiguredChatModel("fastDraft");
    expect(draft.thinking).toBe(false);
    expect(draft.profile.id).toBe("fast"); // 旁路 profileId 生效

    const quality = await resolveConfiguredChatModel("qualityCheck");
    expect(quality.thinking).toBe(true); // 未配置该任务 → 默认开
  });

  it("enrichment 无旁路 → 回退引擎 chapterSteering 的 profile，thinking 默认 true", async () => {
    loadModelSettingsV0.mockResolvedValue(settingsWithoutTriage());
    taskAssignMocks.readTaskAssignments.mockResolvedValue({ file: null, corrupt: false });
    const enr = await resolveConfiguredChatModel("enrichment");
    expect(enr.profile.id).toBe("balanced");
    expect(enr.thinking).toBe(true);
  });
});

describe("思考透传（非流式路）：按 configured.thinkingDialect 翻成各家方言（模型无关·R7）", () => {
  function fakeConfigured(thinking: boolean, thinkingDialect = "glm"): Parameters<typeof callOpenAICompatibleChatModel>[0]["configured"] {
    return {
      provider: { id: "p", baseUrl: "https://x.invalid/v1", apiKeyStatus: "not_required" },
      profile: { id: "m", provider: "p", model: "m", temperature: 0.5 },
      apiKey: "",
      thinking,
      thinkingDialect,
    } as unknown as Parameters<typeof callOpenAICompatibleChatModel>[0]["configured"];
  }
  async function bodyOf(configured: Parameters<typeof callOpenAICompatibleChatModel>[0]["configured"]): Promise<Record<string, unknown>> {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }));
    await callOpenAICompatibleChatModel({ configured, messages: [{ role: "user", content: "x" }] });
    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    spy.mockRestore();
    return body;
  }

  it("glm 方言 + thinking=false → body.thinking.type === 'disabled'", async () => {
    expect((await bodyOf(fakeConfigured(false))).thinking).toEqual({ type: "disabled" });
  });

  it("glm 方言 + thinking=true → body.thinking.type === 'enabled'", async () => {
    expect((await bodyOf(fakeConfigured(true))).thinking).toEqual({ type: "enabled" });
  });

  it("qwen 方言（非流式）→ 强制 enable_thinking:false（即便要开；Qwen3 非流式不关会 400）", async () => {
    for (const want of [true, false]) {
      const body = await bodyOf(fakeConfigured(want, "qwen"));
      expect(body.enable_thinking).toBe(false);
      expect(body.thinking).toBeUndefined();
    }
  });

  it("none 方言（认不出的模型）→ 整键不发（换 Kimi/DeepSeek 不因它报错）", async () => {
    const body = await bodyOf(fakeConfigured(true, "none"));
    expect(body.thinking).toBeUndefined();
    expect(body.enable_thinking).toBeUndefined();
  });
});

describe("streamChatModelToText 思考透传（审稿/质检主路径，补覆盖空档）", () => {
  function sseResponse(chunks: readonly string[]): globalThis.Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }
  function streamConfigured(thinking: boolean, thinkingDialect = "glm"): Parameters<typeof streamChatModelToText>[0]["configured"] {
    return {
      provider: { id: "p", baseUrl: "https://x.invalid/v1", apiKeyStatus: "not_required" },
      profile: { id: "m", provider: "p", model: "m" },
      apiKey: "",
      thinking,
      thinkingDialect,
    } as unknown as Parameters<typeof streamChatModelToText>[0]["configured"];
  }

  it("glm 方言 + thinking=false → body.thinking.type==='disabled' + stream:true，并聚合正文", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "正文A" } }] })}\n\n`,
      "data: [DONE]\n\n",
    ]));
    const out = await streamChatModelToText({ configured: streamConfigured(false), messages: [{ role: "user", content: "x" }] });
    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.stream).toBe(true);
    expect(out.content).toBe("正文A");
    spy.mockRestore();
  });

  it("glm 方言 + thinking=true → body.thinking.type==='enabled'", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(["data: [DONE]\n\n"]));
    await streamChatModelToText({ configured: streamConfigured(true), messages: [] });
    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.thinking).toEqual({ type: "enabled" });
    spy.mockRestore();
  });

  it("qwen 方言（流式）→ enable_thinking 跟随开关（流式可正常开思考）", async () => {
    for (const want of [true, false]) {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(["data: [DONE]\n\n"]));
      await streamChatModelToText({ configured: streamConfigured(want, "qwen"), messages: [] });
      const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string);
      expect(body.enable_thinking).toBe(want);
      expect(body.thinking).toBeUndefined();
      spy.mockRestore();
    }
  });

  it("none 方言（认不出的模型）→ 整键不发（流式路径同口径，换任何模型不因它报错）", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(["data: [DONE]\n\n"]));
    await streamChatModelToText({ configured: streamConfigured(true, "none"), messages: [] });
    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.thinking).toBeUndefined();
    expect(body.enable_thinking).toBeUndefined();
    spy.mockRestore();
  });

  it("onDelta：每段正文 delta 逐字外发（供出稿流式进编辑器），仍聚合完整 content", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "甲" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "乙" } }] })}\n\n`,
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    const out = await streamChatModelToText({ configured: streamConfigured(false), messages: [], onDelta: (d) => deltas.push(d) });
    expect(deltas).toEqual(["甲", "乙"]);
    expect(out.content).toBe("甲乙");
    spy.mockRestore();
  });
});

describe("createOpenAICompatibleWriterClient（出稿走流式·afterfix 治非流式整章生成卡代理超时间歇 500）", () => {
  function sseResponse(chunks: readonly string[]): globalThis.Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }
  function writerConfigured(): Parameters<typeof createOpenAICompatibleWriterClient>[0] {
    return {
      provider: { id: "p", baseUrl: "https://x.invalid/v1", apiKeyStatus: "not_required" },
      profile: { id: "m", provider: "p", model: "m", temperature: 0.7 },
      apiKey: "",
      thinking: false,
      thinkingDialect: "qwen",
    } as unknown as Parameters<typeof createOpenAICompatibleWriterClient>[0];
  }
  const ctx = { chapter: 5, sections: [] } as unknown as Parameters<ReturnType<typeof createOpenAICompatibleWriterClient>["generateDraft"]>[0]["context"];

  it("发 stream:true 并从 SSE 增量聚合正文（不再非流式一次性等整章→不卡代理超时）", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "第五章" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "正文。" } }] })}\n\n`,
      "data: [DONE]\n\n",
    ]));
    const out = await createOpenAICompatibleWriterClient(writerConfigured()).generateDraft({ context: ctx, maxOutputTokens: 0 });
    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect(out.content).toBe("第五章正文。");
    spy.mockRestore();
  });

  it("绝不传 max_tokens（铁律：思考吃额度会截断/写空正文）", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(["data: [DONE]\n\n"]));
    await createOpenAICompatibleWriterClient(writerConfigured()).generateDraft({ context: ctx, maxOutputTokens: 4096 });
    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.max_tokens).toBeUndefined();
    expect(body.maxTokens).toBeUndefined();
    spy.mockRestore();
  });

  it("传 onDelta → 出稿时逐字外发正文 delta（agent 路流式进编辑器的源头），仍返回完整 content", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "第五章" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "正文。" } }] })}\n\n`,
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    const out = await createOpenAICompatibleWriterClient(writerConfigured(), (d) => deltas.push(d)).generateDraft({ context: ctx, maxOutputTokens: 0 });
    expect(deltas.join("")).toBe("第五章正文。");
    expect(out.content).toBe("第五章正文。");
    spy.mockRestore();
  });
});
