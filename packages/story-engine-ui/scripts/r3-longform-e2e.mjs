/**
 * r3-longform-e2e.mjs —— R3 主驱动：建书 + 种子 + 逐章生成入库（抽事实）+ 每 10 章 checkpoint（6 类做厚 + dump + 账本）。
 * 断点续跑：每章落 chapter-NN.done.json，重跑时从 lastCommittedChapter+1 接上。
 *
 * 用法：
 *   node scripts/r3-longform-e2e.mjs --maxChapter=30 --runDir=$HOME/StoryEngine-NG-r3/r3-run
 *
 * ⚠ 这是 R3「验证活动」脚本：会真打 GLM、真建书、真出 30 章稿。绝不在自检阶段跑主流程。
 *
 * 关键事实（plan R3「关键事实」段）：
 *  - 不走 writeTool.run（Mastra 工具对象，run 不挂返回对象）→ 直调底层纯函数。
 *  - 入库走 applyCommitToolLogic + 手动 extractAndAppendFacts 才记事实账本（HTTP /api/commit/apply 不抽）。
 *  - 章序护栏要求严格 1→N 顺序（脚本靠顺序自保；runGenerateDraftToolLogic 本身不含护栏）。
 *  - currentChapter = inferCurrentChapter(timeline)=max(events.chapter)，顺序入库自动推进。
 *  - 6 个 generateXEnrichment 内部同时 persist + mergeIntoEngine（→ 进 envelope）。
 *
 * UI 侧 `.ts` 经 r3-ts-hooks 动态 import；引擎包走 @actalk/story-engine dist。
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";

register("./r3-ts-hooks.mjs", import.meta.url);

// --- 引擎 dist ---
const { createStoryProject, buildStateOverview } = await import("@actalk/story-engine");

// --- UI 侧 .ts（经 hooks）---
const { createConfiguredWriterClient, resolveConfiguredChatModel, callOpenAICompatibleChatModel } = await import(
  "../src/server/lib/llm-client.ts"
);
const { runGenerateDraftToolLogic } = await import("../src/server/agent/tools/generate-draft.ts");
const { buildCommitPreviewToolOutput } = await import("../src/server/agent/tools/commit-preview.ts");
const { applyCommitToolLogic } = await import("../src/server/agent/tools/commit-apply.ts");
const { extractAndAppendFacts } = await import("../src/server/agent/fact-ledger/fact-ledger.ts");
const { generateCharacterEnrichment } = await import("../src/server/agent/character-enrichment/character-enrichment.ts");
const { generateAssetEnrichment } = await import("../src/server/agent/asset-enrichment/asset-enrichment.ts");
const { generateLocationEnrichment } = await import("../src/server/agent/location-enrichment/location-enrichment.ts");
const { generateMatrixEnrichment } = await import("../src/server/agent/matrix-enrichment/matrix-enrichment.ts");
const { generateWorldbuilding } = await import("../src/server/agent/worldbuilding/worldbuilding.ts");
const { generateWritingRulesEnrichment } = await import(
  "../src/server/agent/writing-rules-enrichment/writing-rules-enrichment.ts"
);

// --- R3 共享工具（纯 .mjs）---
const { seedFoundationR3, buildRegisteredContext, writeCheckpoint, readResumeState, scanDraft } = await import(
  "./r3-lib.mjs"
);
const { dumpWritingContext } = await import("./dump-writing-context.mjs");

// ---------------------------------------------------------------------------
// callModel（照 tools/generate-*.ts:38 与 commit-apply.ts:170）
// ---------------------------------------------------------------------------

/** enrichment 用：JSON 输出，maxTokens 4000。 */
const callConfiguredModel = async (messages) => {
  const configured = await resolveConfiguredChatModel("chapterSteering");
  const { content } = await callOpenAICompatibleChatModel({
    configured,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    responseFormat: { type: "json_object" },
    maxTokens: 4000,
    timeoutMs: 250000,
  });
  return content;
};

/** 抽事实用：JSON 输出，maxTokens 2000，30s 超时（抽不完即跳过、非致命）。 */
const callConfiguredFactModel = async (messages) => {
  const configured = await resolveConfiguredChatModel("chapterSteering");
  const { content } = await callOpenAICompatibleChatModel({
    configured,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    responseFormat: { type: "json_object" },
    maxTokens: 2000,
    timeoutMs: 30000,
  });
  return content;
};

// ---------------------------------------------------------------------------
// 实体收集（照抄 tools/generate-*.ts 的私有 collectXEntities 映射）
// ---------------------------------------------------------------------------

function collectCharacterEntities(matrix) {
  if (!matrix.available || matrix.characters.length === 0) return [];
  return matrix.characters
    .filter((c) => c.name && c.name.trim().length > 0)
    .map((c) => ({
      name: c.name,
      ...(c.id ? { id: c.id } : {}),
      ...(c.role ? { role: c.role } : {}),
      ...(c.identity ? { identity: c.identity } : {}),
      ...(c.desire ? { desire: c.desire } : {}),
      ...(c.fear ? { fear: c.fear } : {}),
      ...(c.weakness ? { weakness: c.weakness } : {}),
      ...(c.currentGoal ? { currentGoal: c.currentGoal } : {}),
    }));
}

function collectAssetEntities(assetSummary) {
  if (assetSummary.assetItems.length > 0) {
    return assetSummary.assetItems.map((item) => ({
      ...(item.id ? { id: item.id } : {}),
      name: item.name,
      ...(item.owner ?? item.carriedBy ? { owner: item.owner ?? item.carriedBy } : {}),
      ...(item.type ? { type: item.type } : {}),
      ...(item.status ? { status: item.status } : {}),
    }));
  }
  const seen = new Map();
  const unavailable = new Set(assetSummary.unavailableAssets.map((s) => s.trim()));
  const critical = new Set(assetSummary.plotCriticalAssets.map((s) => s.trim()));
  const add = (raw, status) => {
    const name = raw.trim();
    if (!name || seen.has(name)) return;
    seen.set(name, { name, status: unavailable.has(name) ? "受限" : critical.has(name) ? "关键" : status });
  };
  assetSummary.carriedAssets.forEach((a) => add(a, "随身可用"));
  assetSummary.ownedAssets.forEach((a) => add(a, "可用"));
  assetSummary.unavailableAssets.forEach((a) => add(a, "受限"));
  assetSummary.plotCriticalAssets.forEach((a) => add(a, "关键"));
  return [...seen.values()];
}

function collectLocationEntities(locationDetail) {
  return locationDetail.locations
    .filter((item) => item.name.trim().length > 0)
    .map((item) => ({
      name: item.name,
      ...(item.id ? { id: item.id } : {}),
      ...(item.type ? { type: item.type } : {}),
      ...(item.narrativeFunction ? { narrativeFunction: item.narrativeFunction } : {}),
      ...(item.risks?.length > 0 ? { risks: item.risks } : {}),
      ...(item.currentStatus ? { status: item.currentStatus } : {}),
    }));
}

function matrixRelationshipKey(rel) {
  const id = (rel.targetCharacterId ?? "").trim();
  const name = (rel.targetName ?? "").trim();
  return `${id || name}|${(rel.relationType ?? "").trim()}`;
}

function collectMatrixCharacters(matrix) {
  return matrix.characters
    .filter((c) => (c.id ?? "").trim().length > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      ...(c.role && c.role.trim() ? { role: c.role } : {}),
      ...(c.roleHint && c.roleHint.trim() ? { roleHint: c.roleHint } : {}),
    }));
}

function collectMatrixRelationships(matrix) {
  return matrix.relationships
    .filter((r) => (r.relationType ?? "").trim().length > 0 && ((r.targetCharacterId ?? "").trim() || (r.targetName ?? "").trim()))
    .map((r) => ({
      key: matrixRelationshipKey(r),
      targetName: r.targetName,
      relationType: r.relationType,
      ...(r.attitude && r.attitude.trim() ? { attitude: r.attitude } : {}),
      ...(r.trustLevel ? { trustLevel: r.trustLevel } : {}),
      ...(r.conflict && r.conflict.trim() ? { conflict: r.conflict } : {}),
      ...(r.secret && r.secret.trim() ? { secret: r.secret } : {}),
    }));
}

function collectWritingRulesContext(overview) {
  const wr = overview.writingRules;
  return {
    ...(overview.project.genre ? { genre: overview.project.genre } : {}),
    ...(wr.narrativePerspective ? { narrativePerspective: wr.narrativePerspective } : {}),
    proseStyle: wr.proseStyle,
    ...(wr.pacing ? { pacing: wr.pacing } : {}),
    ...(wr.revealPolicy ? { revealPolicy: wr.revealPolicy } : {}),
    genreRequirements: wr.genreRequirements,
    forbiddenContent: wr.forbiddenContent,
    doNotDo: wr.doNotDo,
    readerExperienceRules: wr.readerExperienceRules,
    antiAiPatterns: wr.antiAiPatterns,
  };
}

function buildWorldbuildingSeed(overview) {
  return {
    genre: (overview.project.genre ?? "长篇故事").trim() || "长篇故事",
    premise: (overview.world?.summary ?? overview.storyStatus?.currentObjective ?? "").trim(),
    ...(overview.project.title ? { title: overview.project.title } : {}),
  };
}

// ---------------------------------------------------------------------------
// 每章方向（林远千亿富豪线，30 章占位方向；题材中立、只给推进意图）
// ---------------------------------------------------------------------------

function directionFor(chapter) {
  const seeded = [
    "毕业当天，林远被父母摊牌家里是千亿富豪、账上十亿，父母随即出国，他独自消化这份落差。",
    "林远第一次走进明海的高端商圈，想花钱却被穷惯了的本能拦住，体验暴富反差。",
    "林远决定不靠父母，盘算用自己的方式在明海立足，先从一件小事做起。",
  ];
  return seeded[chapter - 1] ?? `第 ${chapter} 章：林远在明海继续用自己的方式发展，处理暴富落差与自立之间的张力。`;
}

// ---------------------------------------------------------------------------
// 做厚（6 类，checkpoint 内跑）
// ---------------------------------------------------------------------------

async function runAllEnrichments(projectDir) {
  const overview = await buildStateOverview({ projectDir, maxTimelineEvents: 8 });
  const results = {};
  const safe = async (label, fn) => {
    try {
      const r = await fn();
      results[label] = { ok: r.ok, mergedIntoEngine: r.mergedIntoEngine ?? null, summary: r.summary };
    } catch (err) {
      results[label] = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
  await safe("character", () =>
    generateCharacterEnrichment({ projectDir, characters: collectCharacterEntities(overview.characterMatrix), callModel: callConfiguredModel }),
  );
  await safe("asset", () =>
    generateAssetEnrichment({ projectDir, assets: collectAssetEntities(overview.assetSummary), callModel: callConfiguredModel }),
  );
  await safe("location", () =>
    generateLocationEnrichment({ projectDir, locations: collectLocationEntities(overview.locationDetailSummary), callModel: callConfiguredModel }),
  );
  await safe("matrix", () =>
    generateMatrixEnrichment({
      projectDir,
      characters: collectMatrixCharacters(overview.characterMatrix),
      relationships: collectMatrixRelationships(overview.characterMatrix),
      callModel: callConfiguredModel,
    }),
  );
  await safe("worldbuilding", () =>
    generateWorldbuilding({ projectDir, seed: buildWorldbuildingSeed(overview), callModel: callConfiguredModel }),
  );
  await safe("writingRules", () =>
    generateWritingRulesEnrichment({ projectDir, context: collectWritingRulesContext(overview), callModel: callConfiguredModel }),
  );
  return results;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/u.exec(raw);
    if (!m) continue;
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function expandHome(p) {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

async function loadMeta(runDir) {
  const path = join(runDir, "run-meta.json");
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf-8"));
}

async function ensureProject(runDir) {
  const existing = await loadMeta(runDir);
  if (existing?.projectDir && existsSync(existing.projectDir)) return existing;
  const rootDir = join(homedir(), "StoryEngine-NG-r3");
  const { projectDir } = await createStoryProject({
    rootDir,
    title: "林远千亿富豪R3验证",
    genre: "都市爽文 / 暴富反差",
    premise: "林远毕业当天意外得知自己是千亿富二代、账上十亿，父母随即出国，他想靠自己在明海立足。",
    mainCharacterName: "林远",
  });
  await seedFoundationR3(projectDir);
  const meta = { projectDir, rootDir, createdAt: new Date().toISOString() };
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "run-meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
  return meta;
}

async function runChapter(projectDir, chapter, runDir, regContext, writerClient) {
  const direction = directionFor(chapter);

  // 出稿偶发失败（如 GLM 通篇代词化未字面写主角名、被题材中立的 selected-character 检查拦）→ 重试，
  // 复刻真实产品「重新生成」；非架构问题，重试大概率换一版就过。
  let draft;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    draft = await runGenerateDraftToolLogic({ projectDir, chapter, chapterGoal: direction, writerClient, maxTimelineEvents: 8 });
    if (draft.ok && draft.draftBody) break;
    console.log(`[R3] 第 ${chapter} 章出稿第 ${attempt}/3 次未通过（${draft.summary ?? "无 draftBody"}），重试…`);
  }
  if (!draft.ok || !draft.draftBody) {
    throw new Error(`第 ${chapter} 章出稿重试 3 次仍未通过：${draft.summary ?? "无 draftBody"}`);
  }

  const preview = await buildCommitPreviewToolOutput({ projectDir, chapter });
  if (!preview.ok || !preview.previewToken) {
    throw new Error(`第 ${chapter} 章预览失败：${preview.blockingReasons?.join("；") || preview.summary}`);
  }

  const applied = await applyCommitToolLogic({ projectDir, chapter, previewToken: preview.previewToken });
  if (!applied.committed) {
    throw new Error(`第 ${chapter} 章入库失败：${applied.refusalReason ?? applied.summary}`);
  }

  const draftText = applied.draftBody ?? draft.draftBody;
  const facts = await extractAndAppendFacts({ projectDir, chapter, draftText, callModel: callConfiguredFactModel });

  const driftScan = scanDraft(draftText, regContext);
  await writeCheckpoint(runDir, `chapter-${String(chapter).padStart(2, "0")}.done`, {
    chapter,
    direction,
    ok: true,
    factsAdded: facts.added,
    driftScan,
    committedAt: new Date().toISOString(),
  });
  return { chapter, factsAdded: facts.added };
}

async function runCheckpoint(projectDir, chapter, runDir) {
  const enrichments = await runAllEnrichments(projectDir);
  const dumpBefore = await dumpWritingContext({ projectDir, chapter, ranked: false });
  const dumpRanked = await dumpWritingContext({ projectDir, chapter, ranked: true });
  await writeCheckpoint(runDir, `checkpoint-${chapter}`, {
    chapter,
    enrichments,
    envelope: dumpBefore,
    envelopeRanked: dumpRanked,
    at: new Date().toISOString(),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const maxChapter = Number.parseInt(String(args.maxChapter ?? "30"), 10);
  const runDir = expandHome(String(args.runDir ?? join(homedir(), "StoryEngine-NG-r3", "r3-run")));

  const meta = await ensureProject(runDir);
  const { projectDir } = meta;
  const regContext = await buildRegisteredContext(projectDir);
  const writerClient = await createConfiguredWriterClient("fastDraft");

  const { lastCommittedChapter } = await readResumeState(runDir);
  const start = lastCommittedChapter + 1;

  for (let chapter = start; chapter <= maxChapter; chapter += 1) {
    const result = await runChapter(projectDir, chapter, runDir, regContext, writerClient);
    console.log(`[R3] 第 ${chapter} 章入库完成，新增硬事实 ${result.factsAdded} 条。`);
    if (chapter === 10 || chapter === 20 || chapter === 30) {
      await runCheckpoint(projectDir, chapter, runDir);
      console.log(`[R3] checkpoint-${chapter} 已落盘（6 类做厚 + envelope dump + 账本）。`);
    }
  }
  console.log(`[R3] 跑到第 ${maxChapter} 章完成。projectDir=${projectDir} runDir=${runDir}`);
}

// 守卫：用 pathToFileURL 规范化（项目路径含空格「New project」，import.meta.url 会把空格编码成 %20，
// 旧的字符串拼接 `file://${argv[1]}` 用未编码空格 → 永不相等 → main 永不执行）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
