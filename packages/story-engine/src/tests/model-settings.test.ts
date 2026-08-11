import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModelSettingsV0 } from "../model-settings.js";
import type { ModelSettingsV0 } from "../types.js";

describe("Model Settings V0", () => {
  it("returns a missing result when the config file does not exist", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "story-engine-model-settings-"));

    const result = await loadModelSettingsV0(projectDir);

    expect(result).toMatchObject({
      passed: true,
      available: false,
      status: "missing",
      issues: [],
      summary: {
        available: false,
        status: "missing",
        providers: [],
        profiles: [],
      },
    });
  });

  it("accepts a valid config and reports only apiKeyEnv presence", async () => {
    const projectDir = await writeSettings(validSettings());

    const result = await loadModelSettingsV0(projectDir, {
      env: {
        STORY_ENGINE_TEST_API_KEY: "secret-real-key",
      },
    });

    expect(result.passed).toBe(true);
    expect(result.status).toBe("loaded");
    expect(result.issues).toEqual([]);
    expect(result.summary.providers[0]).toMatchObject({
      id: "main",
      apiKeyEnv: "STORY_ENGINE_TEST_API_KEY",
      apiKeyStatus: "present",
    });
    expect(JSON.stringify(result)).not.toContain("secret-real-key");
  });

  it("reports a validation issue when a profile references an unknown provider", async () => {
    const projectDir = await writeSettings({
      ...validSettings(),
      profiles: {
        creative: {
          ...validSettings().profiles.creative,
          provider: "missing-provider",
        },
      },
    });

    const result = await loadModelSettingsV0(projectDir);

    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "unknown_profile_provider",
      path: "$.profiles.creative.provider",
    }));
  });

  it("reports a validation issue when taskProfiles reference an unknown profile", async () => {
    const projectDir = await writeSettings({
      ...validSettings(),
      taskProfiles: {
        ...validSettings().taskProfiles,
        repair: "missing-profile",
      },
    });

    const result = await loadModelSettingsV0(projectDir);

    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "unknown_task_profile_reference",
      path: "$.taskProfiles.repair",
    }));
  });

  it("accepts a triage task profile mapping without an unknown-key warning", async () => {
    const projectDir = await writeSettings({
      ...validSettings(),
      taskProfiles: {
        ...validSettings().taskProfiles,
        triage: "creative",
      },
    });

    const result = await loadModelSettingsV0(projectDir);

    expect(result.passed).toBe(true);
    expect(result.status).toBe("loaded");
    expect(result.summary.taskProfiles.triage).toBe("creative");
    expect(result.issues).not.toContainEqual(expect.objectContaining({
      code: "unknown_task_profile",
      path: "$.taskProfiles.triage",
    }));
  });

  it("reports high risk issue when a plaintext apiKey field appears", async () => {
    const projectDir = await writeSettings({
      ...validSettings(),
      providers: {
        main: {
          ...validSettings().providers.main,
          apiKey: "secret-real-key",
        },
      },
    });

    const result = await loadModelSettingsV0(projectDir, {
      env: {
        STORY_ENGINE_TEST_API_KEY: "env-secret",
      },
    });

    expect(result.passed).toBe(false);
    expect(result.summary.highRiskIssueCount).toBe(1);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "high",
      code: "plaintext_api_key",
      path: "$.providers.main.apiKey",
    }));
    expect(JSON.stringify(result.summary)).not.toContain("secret-real-key");
    expect(JSON.stringify(result.summary)).not.toContain("env-secret");
  });
});

function validSettings(): ModelSettingsV0 {
  return {
    version: 1,
    defaultProvider: "main",
    defaultProfile: "creative",
    providers: {
      main: {
        id: "main",
        label: "Main model provider",
        type: "openai-compatible",
        baseUrl: "https://api.example.invalid/v1",
        apiKeyEnv: "STORY_ENGINE_TEST_API_KEY",
      },
    },
    profiles: {
      creative: {
        id: "creative",
        provider: "main",
        model: "story-model",
        temperature: 0.7,
        maxTokens: 3000,
        timeoutMs: 30000,
        retries: 1,
        stream: false,
      },
    },
    taskProfiles: {
      fastDraft: "creative",
      chapterSteering: "creative",
      qualityCheck: "creative",
      repair: "creative",
      futureReview: "creative",
      draftReview: "creative",
    },
  };
}

async function writeSettings(settings: unknown): Promise<string> {
  const projectDir = await mkdtemp(join(tmpdir(), "story-engine-model-settings-"));
  const settingsDir = join(projectDir, ".story-engine");
  await mkdir(settingsDir, { recursive: true });
  await writeFile(join(settingsDir, "model-settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
  return projectDir;
}
