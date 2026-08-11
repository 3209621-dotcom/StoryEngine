// @vitest-environment node
//
// generate_draft 纯逻辑单测：复刻 routes/draft.ts 的 runFastDraft 落工作稿编排（进程内）。
// 草稿待保存 → 不建 git 快照（withSnapshot 不参与）；写盘后 refreshScope:"full"。
// writerClient 注入一个 mock model（不调真实 LLM），引擎应用走临时项目 fixture。
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createStoryProject, runFastDraft, type StateOverview, type WriterClient } from "@actalk/story-engine";
import type { ToolExecutionContext } from "@mastra/core/tools";
import { describe, expect, it, vi } from "vitest";

import { writeFile } from "node:fs/promises";

import { ALIAS_TABLE_RELATIVE_PATH } from "../alias-generator/alias-generator.js";
import { defaultCommittedChapterPath, defaultDraftPath } from "../../lib/project-io.js";
import { makeWriterRankContext } from "../context-budget/rank-writer-context.js";
import { buildProjectRequestContext } from "../request-context.js";
import {
  advancePastCommittedFrontier,
  buildNoWriteIntentBlockedOutput,
  buildSequencingBlockedOutput,
  generateDraftTool,
  isChapterCommitted,
  positiveOrUndefined,
  readDraftBodyWithRetry,
  runGenerateDraftToolLogic,
} from "./generate-draft.js";

describe("positiveOrUndefined（模型把 0 当『默认/不限』用 → 归一成 undefined，让 ?? 默认 兜底）", () => {
  it("0/负/NaN/undefined → undefined；正数原样", () => {
    expect(positiveOrUndefined(0)).toBeUndefined();
    expect(positiveOrUndefined(-5)).toBeUndefined();
    expect(positiveOrUndefined(Number.NaN)).toBeUndefined();
    expect(positiveOrUndefined(undefined)).toBeUndefined();
    expect(positiveOrUndefined(8)).toBe(8);
    expect(positiveOrUndefined(12_000)).toBe(12_000);
  });
});

async function makeProject(title: string, mainCharacterName = "林远"): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "gen-draft-test-"));
  const { projectDir } = await createStoryProject({
    rootDir,
    title,
    genre: "都市",
    premise: "主角进入权力中心。",
    mainCharacterName,
  });
  return projectDir;
}

/** 构造一个返回固定长正文的 mock writerClient（不调真实模型）。 */
function mockWriterClient(body: string): WriterClient {
  return {
    async generateDraft({ context }) {
      return { title: `第${context.chapter}章`, content: body };
    },
  };
}

/** 够长（>200 中文字、>=3 段）且提及主角的正文，确保通过引擎长度/有效性门槛。 */
function longBody(mainCharacterName: string): string {
  const para = `${mainCharacterName}在走廊尽头停下脚步，反复掂量手里这份账册的分量，心里盘算着接下来每一步该怎么走才不至于落人话柄。`;
  return [para, para, para, para].join("\n\n");
}

async function seedSecondaryCharacter(projectDir: string): Promise<void> {
  const characterDir = join(projectDir, "characters", "lin-wan-qing");
  await mkdir(characterDir, { recursive: true });
  await writeFile(join(characterDir, "profile.json"), `${JSON.stringify({ id: "lin-wan-qing", name: "林婉清" }, null, 2)}\n`, "utf-8");
  await writeFile(join(characterDir, "core.json"), `${JSON.stringify({ characterId: "lin-wan-qing", personality: ["冷静"] }, null, 2)}\n`, "utf-8");
  await writeFile(join(characterDir, "state.json"), `${JSON.stringify({ characterId: "lin-wan-qing", emotion: "calm", goal: "assist", lastUpdatedChapter: null }, null, 2)}\n`, "utf-8");
}

async function seedMainCharacter(projectDir: string): Promise<void> {
  const characterDir = join(projectDir, "characters", "guo-xu");
  await mkdir(characterDir, { recursive: true });
  await writeFile(join(characterDir, "profile.json"), `${JSON.stringify({ id: "guo-xu", name: "林远", identity: "protagonist", appearance: {}, tags: [] }, null, 2)}\n`, "utf-8");
  await writeFile(join(characterDir, "core.json"), `${JSON.stringify({ characterId: "guo-xu", personality: ["谨慎"], speechStyle: "克制" }, null, 2)}\n`, "utf-8");
  await writeFile(join(characterDir, "state.json"), `${JSON.stringify({ characterId: "guo-xu", emotion: "alert", goal: "进入核心场景", lastUpdatedChapter: null }, null, 2)}\n`, "utf-8");
}

describe("generate_draft 写工作稿工具", () => {
  it("生成成功 → 写入工作稿文件，返回 draftPath/draftBody 与 refreshScope:full，且不带 snapshotId（草稿不建 git 快照）", async () => {
    const projectDir = await makeProject("出稿", "林远");
    const out = await runGenerateDraftToolLogic({
      projectDir,
      chapter: 1,
      chapterGoal: "第 1 章：主角初入局。",
      writerClient: mockWriterClient(longBody("林远")),
    });
    expect(out.ok).toBe(true);
    expect(out.refreshScope).toBe("full");
    expect(out.draftPath).toBe(defaultDraftPath(projectDir, 1));
    expect(out.draftBody && out.draftBody.includes("林远")).toBe(true);
    // 草稿待保存：不建 git 快照、不带 snapshotId
    expect("snapshotId" in out).toBe(false);
    // 工作稿确实落盘
    const onDisk = await readFile(defaultDraftPath(projectDir, 1), "utf-8");
    expect(onDisk).toContain("林远");
    // overview 供前端刷新
    expect(out.overview).toBeTruthy();
  });

  // Codex 复测额外发现：首稿把「第三块砖→第三层杂志架」「债权池A-17→数字串」。mustHitBeats 注入硬约束 +
  // 出稿后确定性核对，漏写/改写 → summary 带「首稿核对」软警告，让 agent 如实转达、问用户要不要改稿。
  it("mustHitBeats 里的具体锚点漏写/被改写 → summary 带首稿核对软警告", async () => {
    const projectDir = await makeProject("保真漏", "林远");
    const body = [longBody("林远"), "林远撬开第三层杂志架后面的暗格，取出薄铁盒，收据背面写着债权池17号。"].join("\n\n");
    const out = await runGenerateDraftToolLogic({
      projectDir,
      chapter: 1,
      mustHitBeats: ["第三块砖", "债权池A-17"],
      writerClient: mockWriterClient(body),
    });
    expect(out.ok).toBe(true);
    expect(out.summary).toContain("首稿核对");
    expect(out.summary).toContain("第三块砖");
    expect(out.summary).toContain("债权池A-17");
  });

  it("mustHitBeats 都写到了 → summary 不带首稿核对警告", async () => {
    const projectDir = await makeProject("保真中", "林远");
    const body = [longBody("林远"), "林远撬开第三块砖后面的暗格，取出薄铁盒，收据背面写着债权池A-17。"].join("\n\n");
    const out = await runGenerateDraftToolLogic({
      projectDir,
      chapter: 1,
      mustHitBeats: ["第三块砖", "债权池A-17"],
      writerClient: mockWriterClient(body),
    });
    expect(out.ok).toBe(true);
    expect(out.summary).not.toContain("首稿核对");
  });

  it("模型返回工具/JSON 伪正文 → 引擎拒绝写盘，诚实回报 ok=false（含 issues），不谎称成功", async () => {
    const projectDir = await makeProject("无效", "林远");
    const out = await runGenerateDraftToolLogic({
      projectDir,
      chapter: 1,
      chapterGoal: "第 1 章。",
      // 看起来像 JSON/工具调用产物 → 引擎 validateDraft 判无效，passed:false。
      writerClient: mockWriterClient('{"tool":"call","args":{}}'),
    });
    expect(out.ok).toBe(false);
    expect(out.draftPath).toBeUndefined();
    expect(out.issues.length).toBeGreaterThan(0);
    expect(out.summary).toMatch(/未通过|未写入|拒绝/u);
  });

  it("透传 selectedCharacterIds / selectedHookIds / maxTimelineEvents 给 FastDraft context", async () => {
    const projectDir = await makeProject("选中上下文", "林远");
    await seedSecondaryCharacter(projectDir);
    const writerClient: WriterClient = {
      async generateDraft({ context }) {
        expect(context.trace.selectedCharacters).toEqual(["lin-wan-qing"]);
        expect(context.sections.find((section) => section.name === "character_profile")?.content).toEqual([
          expect.objectContaining({ id: "lin-wan-qing", name: "林婉清" }),
        ]);
        return { title: `第${context.chapter}章`, content: longBody("林婉清") };
      },
    };

    const out = await runGenerateDraftToolLogic({
      projectDir,
      chapter: 1,
      chapterGoal: "林婉清出场。",
      selectedCharacterIds: ["lin-wan-qing"],
      selectedHookIds: ["h-ledger"],
      maxTimelineEvents: 2,
      writerClient,
    });

    expect(out.ok).toBe(true);
  });

  // P1 集成断言（复审实锤）：显式 selectedCharacterIds 是「bible 有、但缺 characters/<id>/ 三件套文件」的幽灵 id 时，
  // 过滤层必须把它判为不可读、丢弃、回落自动检测——整条 generate_draft → buildWriterContext 不再 ENOENT 崩。
  it("显式 selectedCharacterIds 是 bible 有、三件套文件缺的幽灵 id → 过滤回落、整条不 ENOENT 崩、幽灵 id 不进 context", async () => {
    const projectDir = await makeProject("册有文件缺", "林远");
    const biblePath = join(projectDir, "story", "character-bible.json");
    const bible = JSON.parse(await readFile(biblePath, "utf-8")) as { readonly characters: { id: string; name: string; role: string }[] };
    bible.characters.push({ id: "ghost-no-files", name: "幽灵", role: "配角" }); // 只进册、不建文件（真书角色都有 role）
    await writeFile(biblePath, `${JSON.stringify(bible, null, 2)}\n`, "utf-8");

    let contextIds: readonly string[] = [];
    const writerClient: WriterClient = {
      async generateDraft({ context }) {
        contextIds = context.trace.selectedCharacters ?? [];
        return { title: `第${context.chapter}章`, content: longBody("林远") };
      },
    };

    const out = await runGenerateDraftToolLogic({
      projectDir,
      chapter: 1,
      chapterGoal: "推进剧情。",
      selectedCharacterIds: ["ghost-no-files"],
      writerClient,
    });

    expect(out.ok).toBe(true); // 没有 ENOENT 崩
    expect(contextIds).not.toContain("ghost-no-files"); // 幽灵 id 没被直透下游 context
  });

  it("omitted selectedCharacterIds are resolved from chapter goal and previous chapter aliases before FastDraft", async () => {
    const projectDir = await makeProject("自动挑角色", "林远");
    await seedMainCharacter(projectDir);
    await seedSecondaryCharacter(projectDir);
    await writeFile(
      join(projectDir, "story", "character-bible.json"),
      `${JSON.stringify({
        version: "v0",
        characters: [
          { id: "guo-xu", name: "林远", role: "主角" },
          { id: "lin-wan-qing", name: "林婉清", role: "老师" },
        ],
      }, null, 2)}\n`,
      "utf-8",
    );
    await mkdir(join(projectDir, ".story-engine-ui"), { recursive: true });
    await writeFile(
      join(projectDir, ALIAS_TABLE_RELATIVE_PATH),
      `${JSON.stringify({
        version: "v0",
        byEntity: {
          "guo-xu": { canonicalName: "林远", primary: "林远", aliases: ["林总"], generated: ["林总"], type: "character" },
          "lin-wan-qing": { canonicalName: "林婉清", primary: "林婉清", aliases: ["林老师"], generated: ["林老师"], type: "character" },
        },
        conflicts: [],
      }, null, 2)}\n`,
      "utf-8",
    );
    await mkdir(join(projectDir, "chapters"), { recursive: true });
    await writeFile(join(projectDir, "chapters", "0001.md"), "# 第一章\n\n林老师在门外递来一份资料。", "utf-8");
    const writerClient: WriterClient = {
      async generateDraft({ context }) {
        expect(context.trace.selectedCharacters).toEqual(expect.arrayContaining(["guo-xu", "lin-wan-qing"]));
        return { title: `第${context.chapter}章`, content: longBody("林远") };
      },
    };

    const out = await runGenerateDraftToolLogic({
      projectDir,
      chapter: 2,
      chapterGoal: "继续写林总处理资料。",
      writerClient,
    });

    expect(out.ok).toBe(true);
    expect(out.characterSelection?.selectedCharacterIds).toEqual(expect.arrayContaining(["guo-xu", "lin-wan-qing"]));
    expect(out.summary).toContain("本章相关角色：林远、林婉清");
  });

  it("returns context budget dropped sections when the tool ranker trims dynamic context", async () => {
    const projectDir = await makeProject("预算诊断", "林远");
    await writeFile(
      join(projectDir, "timeline", "events.json"),
      `${JSON.stringify(Array.from({ length: 8 }, (_, index) => ({
        id: `event-${index + 1}`,
        chapter: index + 1,
        summary: `林远在第${index + 1}章持续追查一条很长的线索，线索包含地点、对手、证据和下一步压力。`,
        participants: ["guo-xu"],
      })), null, 2)}\n`,
      "utf-8",
    );

    const out = await runGenerateDraftToolLogic({
      projectDir,
      chapter: 1,
      chapterGoal: "第 1 章：主角初入局。",
      contextTokenBudget: 1,
      writerClient: mockWriterClient(longBody("林远")),
    });

    expect(out.ok).toBe(true);
    expect(out.contextBudget?.droppedSections.length).toBeGreaterThan(0);
  });

  // 收口洞①（总放大器）：生产出稿路径即便用户没给 contextTokenBudget，也必须套用默认预算，
  // 否则 Phase 0/1 的全部 dynamic 裁剪在真实写作里是死的。这里用一份超大的 timeline（远超默认
  // 预算）+ 省略 contextTokenBudget，断言现在仍会裁掉低优先 dynamic 段。改前=undefined→no-op→不裁（RED）。
  it("省略 contextTokenBudget 时，生产路径仍套用默认预算裁剪超大 dynamic 上下文（洞①通电）", async () => {
    const projectDir = await makeProject("默认预算通电", "林远");
    const bigSummary =
      "林远在这一章里辗转于城北的旧仓库、城南的码头和市中心的写字楼之间，反复核对一份牵涉金额、时间、地点与多方对手的复杂账目，" +
      "每一步都要权衡眼前的证据与背后的压力，生怕走错一步就满盘皆输，于是把每一个细节都记在心里反复掂量。";
    await writeFile(
      join(projectDir, "timeline", "events.json"),
      `${JSON.stringify(Array.from({ length: 400 }, (_, index) => ({
        id: `event-${index + 1}`,
        chapter: index + 1,
        summary: `第${index + 1}章：${bigSummary}`,
        participants: ["guo-xu"],
      })), null, 2)}\n`,
      "utf-8",
    );

    const out = await runGenerateDraftToolLogic({
      projectDir,
      chapter: 1,
      chapterGoal: "第 1 章：主角初入局。",
      // 故意不传 contextTokenBudget —— 模拟 agent 生产路径
      maxTimelineEvents: 400,
      writerClient: mockWriterClient(longBody("林远")),
    });

    expect(out.ok).toBe(true);
    expect(out.contextBudget?.droppedSections.length).toBeGreaterThan(0);
  });

  it("keeps stable prompt prefix cache-safe when the production ranker trims dynamic context", async () => {
    const projectDir = await makeProject("缓存安全", "林远");
    await writeFile(
      join(projectDir, "timeline", "events.json"),
      `${JSON.stringify(Array.from({ length: 8 }, (_, index) => ({
        id: `event-${index + 1}`,
        chapter: index + 1,
        summary: `林远在第${index + 1}章持续追查一条很长的线索，线索包含地点、对手、证据和下一步压力。`,
        participants: ["guo-xu"],
      })), null, 2)}\n`,
      "utf-8",
    );
    const writerClient = mockWriterClient(longBody("林远"));
    const baseline = await runFastDraft({
      projectDir,
      chapter: 1,
      chapterGoal: "第 1 章：主角初入局。",
      writerClient,
      dryRun: true,
      maxTimelineEvents: 8,
    });
    const rankedContext = makeWriterRankContext({ tokenBudget: 1 });

    const ranked = await runFastDraft({
      projectDir,
      chapter: 1,
      chapterGoal: "第 1 章：主角初入局。",
      writerClient,
      dryRun: true,
      maxTimelineEvents: 8,
      rankContext: rankedContext.rankContext,
    });

    expect(rankedContext.droppedSections.length).toBeGreaterThan(0);
    expect(ranked.promptFingerprint.stablePrefixHash).toBe(baseline.promptFingerprint.stablePrefixHash);
    expect(ranked.promptFingerprint.dynamicSuffixHash).not.toBe(baseline.promptFingerprint.dynamicSuffixHash);
  });
});

describe("readDraftBodyWithRetry（L1 回读兜底）", () => {
  it("文件有正文 → 去标题返回正文", async () => {
    const projectDir = await makeProject("回读", "林远");
    const path = defaultDraftPath(projectDir, 2);
    await writeFile(path, "# 第二章\n\n林远走进了房间，停在窗前。", "utf-8");
    const body = await readDraftBodyWithRetry(path, { delayMs: 0 });
    expect(body).toBe("林远走进了房间，停在窗前。");
  });

  it("文件读不到（极少数 FS 抖动模拟）→ 重试后仍空返回空字符串（调用方据此沿用旧稿、不谎报失败）", async () => {
    const body = await readDraftBodyWithRetry("/nonexistent/path/chapter-0001.md", { retries: 3, delayMs: 0 });
    expect(body).toBe("");
  });
});

describe("章序护栏（防穿帮）", () => {
  it("buildSequencingBlockedOutput：ok:false + 结构化 reason + 讲清穿帮原因的 summary", () => {
    const out = buildSequencingBlockedOutput(4, 3, {} as StateOverview);
    expect(out.ok).toBe(false);
    expect(out.blockedReason).toBe("previous_chapter_not_committed");
    expect(out.pendingChapterToCommit).toBe(3);
    expect(out.refreshScope).toBe("full");
    expect(out.summary).toContain("第 3 章");
    expect(out.summary).toContain("第 4 章");
    expect(out.summary).toContain("穿帮");
  });

  it("isChapterCommitted：未入库→false；写入 chapters/N.md→true", async () => {
    const projectDir = await makeProject("护栏测试书");
    expect(await isChapterCommitted(projectDir, 1)).toBe(false);
    const committedPath = defaultCommittedChapterPath(projectDir, 1);
    await mkdir(dirname(committedPath), { recursive: true });
    await writeFile(committedPath, "# 第一章\n\n已入库正文。", "utf-8");
    expect(await isChapterCommitted(projectDir, 1)).toBe(true);
  });
});

describe("advancePastCommittedFrontier（已入库前沿→推进下一章，治章号 off-by-one）", () => {
  it("隐式章号 + 回退章已入库 + 下一章未入库（前沿）→ 推进到下一章", () => {
    expect(advancePastCommittedFrontier({
      explicitChapter: false, resolvedChapter: 6, resolvedCommitted: true, nextChapterCommitted: false,
    })).toBe(7);
  });

  it("显式点名章号 → 一律尊重、绝不推进（哪怕该章已入库，例如要重写它的草稿）", () => {
    expect(advancePastCommittedFrontier({
      explicitChapter: true, resolvedChapter: 6, resolvedCommitted: true, nextChapterCommitted: false,
    })).toBe(6);
  });

  it("隐式章号 + 回退章未入库（有草稿/空章）→ 不推进，接着写本章", () => {
    expect(advancePastCommittedFrontier({
      explicitChapter: false, resolvedChapter: 6, resolvedCommitted: false, nextChapterCommitted: false,
    })).toBe(6);
  });

  it("隐式章号 + 回退章已入库但下一章也已入库（前沿之内的中间章）→ 不推进，避免误改中间章", () => {
    expect(advancePastCommittedFrontier({
      explicitChapter: false, resolvedChapter: 3, resolvedCommitted: true, nextChapterCommitted: true,
    })).toBe(3);
  });
});

describe("写作意图门（防入库后自主续写）", () => {
  type ToolExec = (input: Record<string, unknown>, context: ToolExecutionContext) => Promise<unknown>;
  const execute = generateDraftTool.execute as unknown as ToolExec;

  it("buildNoWriteIntentBlockedOutput：ok:false + 结构化 reason + 面向用户的 summary（不泄工具名）", () => {
    const out = buildNoWriteIntentBlockedOutput(6, {} as StateOverview);
    expect(out.ok).toBe(false);
    expect(out.blockedReason).toBe("no_write_intent_this_turn");
    expect(out.refreshScope).toBe("full");
    expect(out.summary).toContain("第 6 章");
    expect(out.summary).not.toMatch(/generate_draft|commit_apply|commit_preview/u);
  });

  it("本轮原话只有定稿意图（入库后模型擅自续写的场景）→ 拦在调模型之前，不写盘、不烧额度", async () => {
    const projectDir = await makeProject("意图门拦截");
    const llmClientModule = await import("../../lib/llm-client.js");
    const spy = vi.spyOn(llmClientModule, "createConfiguredWriterClient").mockResolvedValue(mockWriterClient(longBody("林远")));

    try {
      const context = {
        requestContext: buildProjectRequestContext(projectDir, 1, undefined, "确认定稿"),
      } as unknown as ToolExecutionContext;

      const out = await execute({}, context) as { ok: boolean; blockedReason?: string; summary: string };
      expect(out.ok).toBe(false);
      expect(out.blockedReason).toBe("no_write_intent_this_turn");
      expect(spy).not.toHaveBeenCalled();
      await expect(readFile(defaultDraftPath(projectDir, 1), "utf-8")).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it("本轮原话带写作意图（含尾部范围限定否定的马拉松原话）→ 放行照常出稿", async () => {
    const projectDir = await makeProject("意图门放行", "林远");
    const llmClientModule = await import("../../lib/llm-client.js");
    const spy = vi.spyOn(llmClientModule, "createConfiguredWriterClient").mockResolvedValue(mockWriterClient(longBody("林远")));

    try {
      const context = {
        requestContext: buildProjectRequestContext(projectDir, 1, undefined, "继续写第1章正文。只写这一章，不要写其他章。"),
      } as unknown as ToolExecutionContext;

      const out = await execute({}, context) as { ok: boolean; chapter: number };
      expect(out.ok).toBe(true);
      expect(out.chapter).toBe(1);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("generate_draft execute 章号回退（currentChapter）", () => {
  type ToolExec = (input: Record<string, unknown>, context: ToolExecutionContext) => Promise<unknown>;
  const execute = generateDraftTool.execute as unknown as ToolExec;

  it("不传 chapter 但注入 currentChapter:5 → 工具用第5章执行（非默认第1章）", async () => {
    const projectDir = await makeProject("章号回退测试");
    // 第4章先入库，让章序护栏放行（第5章的 prior = 第4章需入库）
    const committed4 = defaultCommittedChapterPath(projectDir, 4);
    await mkdir(dirname(committed4), { recursive: true });
    await writeFile(committed4, "# 第四章\n\n" + "已入库。".repeat(20), "utf-8");

    const mockClient: WriterClient = mockWriterClient(longBody("林远"));
    const llmClientModule = await import("../../lib/llm-client.js");
    const spy = vi.spyOn(llmClientModule, "createConfiguredWriterClient").mockResolvedValue(mockClient);

    try {
      const context = {
        requestContext: buildProjectRequestContext(projectDir, 5),
      } as unknown as ToolExecutionContext;

      const out = await execute({}, context) as { ok: boolean; chapter: number };
      // 工具必须作用于第5章，而非第1章
      expect(out.chapter).toBe(5);
    } finally {
      spy.mockRestore();
    }
  });

  it("不传 chapter、currentChapter:6 且第6章已入库（前沿）→ 出稿推进到第7章（治 off-by-one，非重写第6章）", async () => {
    const projectDir = await makeProject("前沿推进测试");
    // 第 1–6 章全部入库，第 6 章是写作前沿（第 7 章还没入库）
    for (let ch = 1; ch <= 6; ch++) {
      const committed = defaultCommittedChapterPath(projectDir, ch);
      await mkdir(dirname(committed), { recursive: true });
      await writeFile(committed, `# 第${ch}章\n\n` + "已入库正文。".repeat(20), "utf-8");
    }

    const mockClient: WriterClient = mockWriterClient(longBody("林远"));
    const llmClientModule = await import("../../lib/llm-client.js");
    const spy = vi.spyOn(llmClientModule, "createConfiguredWriterClient").mockResolvedValue(mockClient);

    try {
      const context = {
        requestContext: buildProjectRequestContext(projectDir, 6),
      } as unknown as ToolExecutionContext;

      const out = await execute({}, context) as { ok: boolean; chapter: number };
      expect(out.chapter).toBe(7);
    } finally {
      spy.mockRestore();
    }
  });

  it("显式 chapter:6 且第6章已入库 → 尊重点名、作用于第6章（不推进；用户要重写其草稿）", async () => {
    const projectDir = await makeProject("显式点名不推进");
    for (let ch = 1; ch <= 6; ch++) {
      const committed = defaultCommittedChapterPath(projectDir, ch);
      await mkdir(dirname(committed), { recursive: true });
      await writeFile(committed, `# 第${ch}章\n\n` + "已入库正文。".repeat(20), "utf-8");
    }

    const mockClient: WriterClient = mockWriterClient(longBody("林远"));
    const llmClientModule = await import("../../lib/llm-client.js");
    const spy = vi.spyOn(llmClientModule, "createConfiguredWriterClient").mockResolvedValue(mockClient);

    try {
      const context = {
        requestContext: buildProjectRequestContext(projectDir, 6),
      } as unknown as ToolExecutionContext;

      const out = await execute({ chapter: 6 }, context) as { ok: boolean; chapter: number };
      expect(out.chapter).toBe(6);
    } finally {
      spy.mockRestore();
    }
  });

  it("不传 chapter 且 context 无 currentChapter → throw 含「缺少章号」", async () => {
    const projectDir = await makeProject("缺章号测试");
    const context = {
      requestContext: buildProjectRequestContext(projectDir),
    } as unknown as ToolExecutionContext;

    await expect(execute({}, context)).rejects.toThrow(/缺少章号/);
  });
});
