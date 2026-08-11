import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callRoute } from "./test-helpers.js";
import {
  findInvalidTaskProfile,
  readProfileIdsFromConfig,
  registerModelSettingsRoutes,
} from "./model-settings.js";
import type { TaskAssignmentsFile } from "../lib/task-assignments.js";

/** 最小合法 model-settings（单 provider），baseUrl / apiKeyEnv 可覆盖。 */
function sampleSettingsText(overrides: { baseUrl?: string; apiKeyEnv?: string } = {}): string {
  return `${JSON.stringify({
    version: 1,
    defaultProvider: "main",
    defaultProfile: "balanced",
    providers: {
      main: {
        id: "main",
        label: "OpenAI Compatible",
        type: "openai-compatible",
        baseUrl: overrides.baseUrl ?? "https://api.example.com/v1",
        apiKeyEnv: overrides.apiKeyEnv ?? "STORY_ENGINE_API_KEY",
      },
    },
    profiles: {
      balanced: {
        id: "balanced",
        label: "长篇均衡",
        provider: "main",
        model: "model-name",
        temperature: 0.7,
        maxTokens: 4096,
        timeoutMs: 60000,
        retries: 2,
        stream: true,
      },
    },
    taskProfiles: {
      fastDraft: "balanced",
      chapterSteering: "balanced",
      qualityCheck: "balanced",
      repair: "balanced",
      draftReview: "balanced",
      triage: "balanced",
    },
  }, null, 2)}\n`;
}

describe("readProfileIdsFromConfig / findInvalidTaskProfile（审查 #9）", () => {
  const config = {
    version: 1,
    profiles: { balanced: { id: "balanced" }, fast: { id: "fast" } },
  };

  it("抽出全部合法 profile id", () => {
    expect(readProfileIdsFromConfig(config)).toEqual(new Set(["balanced", "fast"]));
  });

  it("引用不存在的 profileId → 返回该任务", () => {
    const assignments: TaskAssignmentsFile = {
      version: 1,
      tasks: { fastDraft: { profileId: "ghost", thinking: true } },
    };
    expect(findInvalidTaskProfile(assignments, config)).toEqual({ task: "fastDraft", profileId: "ghost" });
  });

  it("全部合法（含只切思考、无 profileId 的任务）→ null", () => {
    const assignments: TaskAssignmentsFile = {
      version: 1,
      tasks: { fastDraft: { profileId: "fast", thinking: true }, triage: { thinking: false } },
    };
    expect(findInvalidTaskProfile(assignments, config)).toBeNull();
  });
});

describe("provider 测试接口安全（审查 #1）", () => {
  let dir: string;
  const originalDataDir = process.env.SE_DATA_DIR;
  const SECRET_ENV = "SE_TEST_SECRET_ENV_DO_NOT_LEAK";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "se-mst-"));
    process.env.SE_DATA_DIR = dir; // 空目录：无已存 provider，隔离真实 ~/.story-engine
    process.env[SECRET_ENV] = "super-secret-value";
  });
  afterEach(async () => {
    if (originalDataDir === undefined) delete process.env.SE_DATA_DIR;
    else process.env.SE_DATA_DIR = originalDataDir;
    delete process.env[SECRET_ENV];
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  function mockModelsFetch() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ data: [{ id: "m1", name: "Model 1" }] }), { status: 200 }),
    );
  }

  it("绝不按客户端传的 apiKeyEnv 读 process.env 外送（旧漏洞回归）", async () => {
    const spy = mockModelsFetch();
    const { statusCode, payload } = await callRoute(registerModelSettingsRoutes, "POST", "/api/model-settings/test", {
      providerId: "attacker",
      baseUrl: "http://attacker.test/v1",
      apiKeyEnv: SECRET_ENV,
    });
    expect(statusCode).toBe(200);
    expect(payload.ok).toBe(true);
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    // 无 authorization 头，且密钥值绝不出现在请求里
    expect(headers.authorization).toBeUndefined();
    expect(JSON.stringify(init)).not.toContain("super-secret-value");
  });

  it("用户当下输入的 apiKey 会作为 Bearer 发送（合法用例仍可用）", async () => {
    const spy = mockModelsFetch();
    await callRoute(registerModelSettingsRoutes, "POST", "/api/model-settings/test", {
      providerId: "custom",
      baseUrl: "https://api.example.test/v1",
      apiKey: "sk-user-typed",
    });
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-user-typed");
    expect(init.redirect).toBe("error");
  });

  it("非 http/https 协议 baseUrl → 400 拒绝", async () => {
    const { statusCode, payload } = await callRoute(registerModelSettingsRoutes, "POST", "/api/model-settings/test", {
      providerId: "x",
      baseUrl: "file:///etc/passwd",
    });
    expect(statusCode).toBe(400);
    expect(payload.ok).toBe(false);
  });

  it("内嵌账号密码的 URL → 400 拒绝", async () => {
    const { statusCode } = await callRoute(registerModelSettingsRoutes, "POST", "/api/model-settings/test", {
      providerId: "x",
      baseUrl: "https://user:pass@evil.test/v1",
    });
    expect(statusCode).toBe(400);
  });

  it("已存 provider：有已存密钥 → 带 Bearer（R1a）", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "model-settings.json"), sampleSettingsText(), "utf-8");
    await writeFile(
      join(dir, "model-secrets.json"),
      JSON.stringify({ version: 1, providerApiKeys: { main: "sk-saved" } }),
      "utf-8",
    );
    const spy = mockModelsFetch();
    await callRoute(registerModelSettingsRoutes, "POST", "/api/model-settings/test", { providerId: "main" });
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-saved");
  });

  it("已存 provider：无已存密钥但 apiKeyEnv 指向的 env 有值 → 请求不带 authorization（R1a 核心）", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "model-settings.json"),
      sampleSettingsText({ apiKeyEnv: SECRET_ENV }),
      "utf-8",
    );
    // 故意不写 model-secrets.json；env 里已有 SECRET_ENV
    const spy = mockModelsFetch();
    await callRoute(registerModelSettingsRoutes, "POST", "/api/model-settings/test", { providerId: "main" });
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(JSON.stringify(init)).not.toContain("super-secret-value");
  });
});

describe("PUT 保存：origin 变更时清密钥（R1b）", () => {
  let dir: string;
  const originalDataDir = process.env.SE_DATA_DIR;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "se-mst-put-"));
    process.env.SE_DATA_DIR = dir;
  });
  afterEach(async () => {
    if (originalDataDir === undefined) delete process.env.SE_DATA_DIR;
    else process.env.SE_DATA_DIR = originalDataDir;
    await rm(dir, { recursive: true, force: true });
  });

  async function readSecrets(): Promise<Record<string, string>> {
    const raw = await readFile(join(dir, "model-secrets.json"), "utf-8");
    return (JSON.parse(raw) as { providerApiKeys: Record<string, string> }).providerApiKeys;
  }

  it("origin 变更且未提供新密钥 → 该 provider 密钥被删", async () => {
    await writeFile(join(dir, "model-settings.json"), sampleSettingsText({ baseUrl: "https://api.example.com/v1" }), "utf-8");
    await writeFile(
      join(dir, "model-secrets.json"),
      JSON.stringify({ version: 1, providerApiKeys: { main: "sk-old" } }),
      "utf-8",
    );
    const { statusCode, payload } = await callRoute(registerModelSettingsRoutes, "PUT", "/api/model-settings", {
      rawText: sampleSettingsText({ baseUrl: "https://attacker.example/v1" }),
      providerApiKeys: {},
    });
    expect(statusCode).toBe(200);
    expect(payload.ok).toBe(true);
    expect(await readSecrets()).not.toHaveProperty("main");
  });

  it("origin 变更且提供了新密钥 → 用新密钥", async () => {
    await writeFile(join(dir, "model-settings.json"), sampleSettingsText({ baseUrl: "https://api.example.com/v1" }), "utf-8");
    await writeFile(
      join(dir, "model-secrets.json"),
      JSON.stringify({ version: 1, providerApiKeys: { main: "sk-old" } }),
      "utf-8",
    );
    const { statusCode } = await callRoute(registerModelSettingsRoutes, "PUT", "/api/model-settings", {
      rawText: sampleSettingsText({ baseUrl: "https://new.example.com/v1" }),
      providerApiKeys: { main: "sk-new" },
    });
    expect(statusCode).toBe(200);
    expect(await readSecrets()).toEqual({ main: "sk-new" });
  });

  it("同 origin 仅路径变化（/v1→/v2）→ 旧密钥保留", async () => {
    await writeFile(join(dir, "model-settings.json"), sampleSettingsText({ baseUrl: "https://api.example.com/v1" }), "utf-8");
    await writeFile(
      join(dir, "model-secrets.json"),
      JSON.stringify({ version: 1, providerApiKeys: { main: "sk-keep" } }),
      "utf-8",
    );
    const { statusCode } = await callRoute(registerModelSettingsRoutes, "PUT", "/api/model-settings", {
      rawText: sampleSettingsText({ baseUrl: "https://api.example.com/v2" }),
      providerApiKeys: {},
    });
    expect(statusCode).toBe(200);
    expect(await readSecrets()).toEqual({ main: "sk-keep" });
  });

  it("旧配置缺失时 PUT → 密钥不被误删", async () => {
    // 无 model-settings.json（available=false），但 secrets 已有
    await writeFile(
      join(dir, "model-secrets.json"),
      JSON.stringify({ version: 1, providerApiKeys: { main: "sk-keep" } }),
      "utf-8",
    );
    const { statusCode } = await callRoute(registerModelSettingsRoutes, "PUT", "/api/model-settings", {
      rawText: sampleSettingsText({ baseUrl: "https://anywhere.example/v1" }),
      providerApiKeys: {},
    });
    expect(statusCode).toBe(200);
    expect(await readSecrets()).toEqual({ main: "sk-keep" });
  });
});
