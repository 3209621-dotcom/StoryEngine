/**
 * generate_draft — 写工作稿工具：为某章生成一版正文并落到工作稿（drafts/fast）。
 *
 * 对照 routes/draft.ts 的 /api/draft/generate 编排（进程内复刻，不经 HTTP）：
 *   createConfiguredWriterClient("fastDraft") → runFastDraft（dryRun:false, persist:true）。
 *   引擎自带长度门槛与有效性校验：正文过短/无法裁剪等会 passed:false 并拒绝写盘。
 *
 * 快照策略（铁律「直接做+可撤销」的边界）：草稿是「待保存」的工作稿，不是状态入库，
 *   因此**不建 git 快照**（plan 明确：草稿/章节级才入库才建快照；改工作稿走操作历史撤销）。
 *   故本工具用 createTool 而非 writeTool，output 不带 snapshotId。
 *   涉及草稿 → refreshScope:"full"（前端刷新写作区/总览）。
 *
 * 铁律：
 * - 题材中立：description / summary 用中性词。
 * - 绝不静默失败 / 绝不谎报：runFastDraft.passed=false 时如实回报 ok:false + issues，不假装出稿成功。
 */
import { readFile } from "node:fs/promises";
import {
  buildStateOverview,
  runFastDraft,
  type FastDraftReport,
  type StateOverview,
  type WriterClient,
} from "@actalk/story-engine";
import { createTool } from "@mastra/core/tools";
import type { ToolExecutionContext } from "@mastra/core/tools";
import { z } from "zod";
import { coerceBoolean, coerceNumber, coerceStringArray, positiveOrUndefined } from "./lenient-args.js";

// 兼容既有测试导入：positiveOrUndefined 现归位 lenient-args（模型无关 helper 正位），此处再导出。
export { positiveOrUndefined } from "./lenient-args.js";

import { createConfiguredWriterClient } from "../../lib/llm-client.js";
import { defaultCommittedChapterPath, defaultDraftPath, stripLeadingMarkdownChapterHeading } from "../../lib/project-io.js";
import { readProjectDirFromContext, resolveChapterFromInputOrContext, readDraftDeltaSinkFromContext, readUserTurnTextFromContext } from "../request-context.js";
import { userTurnAllowsDraftWrite } from "./turn-intent-gate.js";
import { contextBudgetPayload, makeWriterRankContext, resolveWriterTokenBudget } from "../context-budget/rank-writer-context.js";
import { resolveSelectedCharacterIds, type CharacterPresenceResult } from "../presence/in-scene-detector.js";
import { snapshotBeforeDraftOverwrite } from "./snapshot-on-draft-overwrite.js";
import { evaluateChapterSequencingGuard } from "./chapter-sequencing-guard.js";

/** 某章是否已入库（chapters/N.md 存在且非空）。读盘只读，题材中立。 */
export async function isChapterCommitted(projectDir: string, chapter: number): Promise<boolean> {
  const content = await readFile(defaultCommittedChapterPath(projectDir, chapter), "utf-8").catch(() => undefined);
  return content !== undefined && content.trim().length > 0;
}

/**
 * 已入库前沿 → 推进下一章（治长篇连写的章号 off-by-one，codex 真机 P0：入库第 6 章后说「写第 7 章」
 * 却落回第 6 章）。根因：通过对话入库后前端「当前章」仍停在刚入库那章，模型没显式给章号时回退到
 * currentChapter=已入库章，把「写正文/继续」误解成重写它。
 *
 * 规则：仅当 (a) 用户没显式点名章号（explicitChapter=false，走了 currentChapter 回退）、
 * (b) 回退到的这章【已入库】、(c) 它就是写作前沿（下一章还没入库）时，才把出稿目标推进到下一章——
 * 因为「在刚入库的最新章上写正文」几乎必然是「想写下一章」，而非「重写已入库章的草稿」。
 * 显式点名章号时一律尊重、绝不推进（用户要重写某已入库章的草稿也走这条）；前沿之内的已入库章
 * （下一章也已入库）同样不推进，避免误改中间章。纯逻辑、题材中立、可单测。
 */
export function advancePastCommittedFrontier(input: {
  readonly explicitChapter: boolean;
  readonly resolvedChapter: number;
  readonly resolvedCommitted: boolean;
  readonly nextChapterCommitted: boolean;
}): number {
  if (!input.explicitChapter && input.resolvedCommitted && !input.nextChapterCommitted) {
    return input.resolvedChapter + 1;
  }
  return input.resolvedChapter;
}

const inputSchema = z.object({
  chapter: coerceNumber(z.number().int().positive().optional().describe("要出稿的章号。")),
  chapterGoal: z.string().optional().describe(
    "本章方向/目标（一句话即可，如『主角与对手第一次正面交锋』）。省略时默认『继续第 N 章』。",
  ),
  requestedDraftLength: coerceNumber(z.number().int().nonnegative().optional().describe("可选：本章期望字数（中文字符数）；省略或填 0=由写作规则/方向推断。")),
  selectedCharacterIds: coerceStringArray(z.array(z.string()).optional().describe("可选：本章明确在场/相关角色 id 列表，用于收窄写作上下文。")),
  selectedHookIds: coerceStringArray(z.array(z.string()).optional().describe("可选：本章明确相关伏笔 id 列表，用于收窄写作上下文。")),
  mustHitBeats: coerceStringArray(z.array(z.string()).optional().describe(
    "可选但强烈建议：当用户给了本章必须落实的【具体要点】（具体名物 / 数字 / 编号 / 关键动作，如『第三块砖』『债权池A-17』『买胶带』），逐条原样填进来，别压成一句话、别替换具体名词。" +
    "引擎会把这些注入『本章硬约束』让模型逐条落实，并在出稿后确定性核对哪条漏了/写歪了。",
  )),
  maxTimelineEvents: coerceNumber(z.number().int().nonnegative().optional().describe("可选：最多读取多少条时间线事件。")),
  contextTokenBudget: coerceNumber(z.number().int().nonnegative().optional().describe("可选：动态上下文 token 预算；超出时只裁剪低优先动态块。")),
  allowWriteAhead: coerceBoolean(z.boolean().optional().describe(
    "章序护栏的知情 override：默认 false。前一章未入库时本工具会拦下（防穿帮）；仅当用户被告知风险后明确表示『仍要先写本章』，才带 true 再调一次放行。不要默认带 true。",
  )),
});

const outputSchema = z.object({
  ok: z.boolean().describe("是否成功出稿并写入工作稿。引擎拒绝写盘（如正文过短）时为 false。"),
  chapter: z.number().int().positive(),
  draftPath: z.string().optional().describe("工作稿文件路径（成功时）。"),
  draftBody: z.string().optional().describe("生成的正文（不含 Markdown 标题；成功时返回，供前端展示）。"),
  draftTitle: z.string().optional().describe("引擎为本章拟的标题（成功时）。"),
  issues: z.array(z.string()).describe("出稿过程中的问题（失败时含拒绝原因，诚实回报）。"),
  overview: z.unknown().describe("出稿后重新读取的 StateOverview，供前端刷新写作区/总览。"),
  summary: z.string().describe("出稿结果的自然语言摘要。"),
  refreshScope: z.literal("full"),
  snapshotId: z.string().optional().describe("覆盖现有非空草稿前建的快照 id（M6：让『再写一版』可撤销）；首次出稿无此值。"),
  contextBudget: z.object({
    droppedSections: z.array(z.string()),
    droppedDetails: z.array(z.object({ name: z.string(), reason: z.string(), coreImpact: z.boolean() })).optional(),
    coreImpact: z.boolean().optional(),
    issues: z.array(z.string()).optional(),
  }).optional().describe("写作上下文预算裁剪诊断。为空或缺省表示未裁剪。"),
  characterSelection: z.unknown().optional().describe("本章相关角色选择诊断。"),
  blockedReason: z.union([
    z.literal("previous_chapter_not_committed"),
    z.literal("no_write_intent_this_turn"),
  ]).optional().describe(
    "被护栏拦下时为此值（ok=false），别当普通失败重试：" +
      "previous_chapter_not_committed=前一章没入库、现在写本章会穿帮；" +
      "no_write_intent_this_turn=本轮用户原话没有写正文/续写意图（防入库后自主续写），按 summary 向用户讲清并给选项。",
  ),
  pendingChapterToCommit: z.number().int().positive().optional().describe("被章序护栏拦下时，建议先入库的那一章（= 本章号-1）。"),
});

export interface GenerateDraftToolOutput {
  readonly ok: boolean;
  readonly chapter: number;
  readonly draftPath?: string;
  readonly draftBody?: string;
  readonly draftTitle?: string;
  readonly issues: readonly string[];
  readonly overview: StateOverview;
  readonly summary: string;
  readonly refreshScope: "full";
  readonly snapshotId?: string;
  readonly contextBudget?: ReturnType<typeof contextBudgetPayload>;
  readonly characterSelection?: CharacterPresenceResult;
  readonly blockedReason?: "previous_chapter_not_committed" | "no_write_intent_this_turn";
  readonly pendingChapterToCommit?: number;
}

/**
 * 回读工作稿正文，去 Markdown 章节标题。刚写盘的文件偶发读空（FS 抖动）→ 重试几次兜底（L1）。
 * 全部取不到才返回空（调用方据此沿用旧 draft，不谎报失败）。retries/delayMs 仅为单测可注入。
 */
export async function readDraftBodyWithRetry(
  draftPath: string,
  opts: { readonly retries?: number; readonly delayMs?: number } = {},
): Promise<string> {
  const retries = opts.retries ?? 3;
  const delayMs = opts.delayMs ?? 60;
  for (let attempt = 0; attempt < retries; attempt++) {
    const fileContent = await readFile(draftPath, "utf-8").catch(() => "");
    const body = stripLeadingMarkdownChapterHeading(fileContent).trim();
    if (body.length > 0) return body;
    if (attempt < retries - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return "";
}

/** 章序护栏拦截时的工具输出（ok:false + 结构化 reason + 讲清穿帮原因的 summary）。纯逻辑、可测。 */
export function buildSequencingBlockedOutput(
  chapter: number,
  priorChapter: number,
  overview: StateOverview,
): GenerateDraftToolOutput {
  return {
    ok: false,
    chapter,
    blockedReason: "previous_chapter_not_committed",
    pendingChapterToCommit: priorChapter,
    issues: [`第 ${priorChapter} 章还没入库`],
    overview,
    summary:
      `第 ${priorChapter} 章还没入库——它的新状态（人物变化/伏笔/世界事实）还没写进故事，` +
      `现在直接写第 ${chapter} 章会读到旧状态、容易前后穿帮。` +
      `建议先把第 ${priorChapter} 章入库（commit_preview → commit_apply）再写第 ${chapter} 章；` +
      `若确认要冒险先写，请明确说「知道风险，仍要先写第 ${chapter} 章」。`,
    refreshScope: "full",
  };
}

/**
 * 本轮无写作意图被意图门拦下时的输出（ok:false + 结构化 reason + 面向用户的中性 summary）。
 * summary 是给用户看的（会进实时字幕/步骤卡），不含内部工具名（铁律④）。纯逻辑、可测。
 */
export function buildNoWriteIntentBlockedOutput(
  chapter: number,
  overview: StateOverview,
): GenerateDraftToolOutput {
  return {
    ok: false,
    chapter,
    blockedReason: "no_write_intent_this_turn",
    issues: ["本轮用户原话没有写正文/续写的意图"],
    overview,
    summary:
      `这一轮我没收到明确要写正文的指令，就没有自动生成第 ${chapter} 章正文——避免擅自往下写，也不白费你的额度。` +
      `想写就直接说「写这一章」或「写下一章」；如果你是想改设定/资料或做别的，告诉我就行。`,
    refreshScope: "full",
  };
}

/**
 * 纯逻辑：复刻路由编排——runFastDraft（注入 writerClient）→ 读回工作稿 → 诚实回报。
 * writerClient 作为参数注入，便于单测用 mock model；真实 execute 注入
 * createConfiguredWriterClient("fastDraft")。草稿待保存：不建 git 快照。
 */
export async function runGenerateDraftToolLogic(input: {
  readonly projectDir: string;
  readonly chapter: number;
  readonly chapterGoal?: string;
  readonly requestedDraftLength?: number;
  readonly selectedCharacterIds?: readonly string[];
  readonly selectedHookIds?: readonly string[];
  readonly mustHitBeats?: readonly string[];
  readonly maxTimelineEvents?: number;
  readonly contextTokenBudget?: number;
  readonly writerClient: WriterClient;
}): Promise<GenerateDraftToolOutput> {
  const { projectDir, chapter, writerClient } = input;
  const chapterGoal = input.chapterGoal?.trim() || `继续第 ${chapter} 章。`;
  // 模型无关：模型常把 maxTimelineEvents/contextTokenBudget 传成 `0`（当"默认/不限"用），而 `0` 在
  // 引擎里是"显式锁定/极限裁剪"——会静默砍掉时间线 + 全部非保护上下文段（长篇慢性失忆，真机 ch2/ch3
  // 已被 contextTokenBudget:"0" 触发）。这里把模型面的非正数一律当"未提供→默认"，绝不当显式锁定。
  // （resolveWriterTokenBudget(0)=0 极限裁剪的内部契约保留给路由/内部调用，只在模型入参层归一。）
  const maxTimelineEvents = positiveOrUndefined(input.maxTimelineEvents) ?? 8;
  // 洞①修复：生产路径即便没显式给预算，也套用默认预算（resolveWriterTokenBudget），
  // 让 dynamic 裁剪真正生效；正常短篇 dynamic 远低于默认值=自然 no-op，仅长篇超额时才裁。
  const contextRanking = makeWriterRankContext({ tokenBudget: resolveWriterTokenBudget(positiveOrUndefined(input.contextTokenBudget)) });
  const characterSelection = await resolveSelectedCharacterIds({
    projectDir,
    chapter,
    chapterGoal,
    explicit: input.selectedCharacterIds,
  });
  const selectedCharacterIds = characterSelection.selectedCharacterIds.length > 0 ? characterSelection.selectedCharacterIds : undefined;

  const report: FastDraftReport = await runFastDraft({
    projectDir,
    chapter,
    chapterGoal,
    writerClient,
    dryRun: false,
    persist: true,
    ...(positiveOrUndefined(input.requestedDraftLength) !== undefined ? { requestedDraftLength: positiveOrUndefined(input.requestedDraftLength) } : {}),
    ...(selectedCharacterIds !== undefined ? { selectedCharacterIds } : {}),
    ...(input.selectedHookIds !== undefined ? { selectedHookIds: input.selectedHookIds } : {}),
    ...(input.mustHitBeats && input.mustHitBeats.length > 0 ? { mustHitBeats: input.mustHitBeats } : {}),
    maxTimelineEvents,
    rankContext: contextRanking.rankContext,
  });

  const overview = await buildStateOverview({ projectDir, chapter, maxTimelineEvents });
  const contextBudget = optionalContextBudget(contextRanking);

  if (!report.passed || !report.draftPath) {
    return {
      ok: false,
      chapter,
      issues: report.issues,
      overview,
      summary:
        `第 ${chapter} 章出稿未通过，未写入工作稿：` +
        `${report.issues.length > 0 ? report.issues.join("；") : "引擎拒绝写盘"}。${characterSelection.summary}。请重试或调整本章方向。`,
      refreshScope: "full",
      characterSelection,
      ...contextBudget,
    };
  }

  // L1：草稿已写盘，但回读那一刻偶发 FS 读失败会得空稿，前端这次就不刷新（草稿其实在磁盘，切走再回来就有）。
  // 重试回读兜底（刚写盘的文件、读空多是极少数 FS 抖动，重试即得）；仍取不到才退回空——
  // ⚠ 绝不因此判 ok:false：稿子是真写成功的，谎报失败会诱导用户重写覆盖好稿。
  const draftBody = await readDraftBodyWithRetry(report.draftPath);

  // 出稿后保真软警告：用户给的必命中要点里有具体锚点漏写/被改写 → 如实提示、让用户决定改不改（绝不静默放过、也不阻塞）。
  const missingBeats = report.beatFidelity?.missingBeats ?? [];
  const beatWarning = missingBeats.length > 0
    ? `⚠ 首稿核对：这几条要点可能漏写或被改写了——${missingBeats.join("、")}。要不要我改稿补回？`
    : "";

  return {
    ok: true,
    chapter,
    draftPath: report.draftPath,
    draftBody,
    ...(report.title ? { draftTitle: report.title } : {}),
    issues: report.issues,
    overview,
    summary:
      `第 ${chapter} 章已生成正文并写入工作稿${report.title ? `《${report.title}》` : ""}。` +
      `${characterSelection.summary}。草稿尚未入库，可在写作区查看修改；满意后再走 commit_preview / commit_apply 入库。` +
      (beatWarning ? `\n${beatWarning}` : "") +
      // A11：回读为空是偶发 FS 抖动、正文确已写盘——加一句可见性提示，别让用户以为没生成而重写覆盖好稿。
      (draftBody.trim().length === 0
        ? "（注：正文已写盘，但本次未能载入到写作区显示——切到别的章再切回本章即可看到，不用重写。）"
        : ""),
    refreshScope: "full",
    characterSelection,
    ...contextBudget,
  };
}

export const generateDraftTool = createTool({
  id: "generate_draft",
  description:
    "为某章生成一版正文并写入工作稿（drafts/fast，不入库）。当用户说『写第 N 章 / 出一版正文 / 把方案写成正文』时调用。" +
    "草稿是待保存的工作稿，不建 git 快照（改坏了走操作历史撤销）；满意后再用 commit_preview / commit_apply 正式入库。" +
    "正文过短等被引擎拒绝时会如实回报，不假装出稿成功。",
  inputSchema,
  outputSchema,
  execute: async (input: z.infer<typeof inputSchema>, context: ToolExecutionContext) => {
    const projectDir = readProjectDirFromContext(context);
    if (!projectDir) {
      throw new Error(
        "generate_draft 缺少 projectDir：请确认调用 agent 时通过 RequestContext 注入了 projectDir。",
      );
    }
    const resolvedFromInputOrContext = resolveChapterFromInputOrContext(input.chapter, context);
    if (resolvedFromInputOrContext === undefined) {
      throw new Error("generate_draft 缺少章号：LLM 未给出章号，且前端未注入 currentChapter。请明确指定章号。");
    }
    // 已入库前沿 → 推进下一章（治 off-by-one：入库后 currentChapter 仍停在刚入库那章，隐式出稿会重写它）。
    // 仅在「模型没显式给章号」且「回退到的章已入库、且是前沿（下一章未入库）」时推进；显式章号一律尊重。
    const explicitChapter = Number.isInteger(input.chapter) && (input.chapter as number) > 0;
    const resolvedChapter = advancePastCommittedFrontier({
      explicitChapter,
      resolvedChapter: resolvedFromInputOrContext,
      resolvedCommitted: explicitChapter ? false : await isChapterCommitted(projectDir, resolvedFromInputOrContext),
      nextChapterCommitted: explicitChapter ? false : await isChapterCommitted(projectDir, resolvedFromInputOrContext + 1),
    });
    // A（写作意图门，防「入库后自主续写」）：那一轮用户原话只有定稿/审稿等意图、没有任何写作意图时，
    // 模型不得擅自 generate_draft 往下写整章（纪律 145「出稿不越权」的确定性护栏——不赌弱模型守规矩）。
    // 缺原话放行（向后兼容/前端按钮直调）；组合意图「定稿并接着写下一章」含写作意图仍放行。拦在调模型之前。
    const userTurnText = readUserTurnTextFromContext(context);
    if (userTurnText !== undefined && !userTurnAllowsDraftWrite(userTurnText)) {
      console.warn("[turn-intent-gate] 拦下未授权 generate_draft（本轮用户原话无写作意图，防入库后自主续写）");
      const overview = await buildStateOverview({ projectDir, chapter: resolvedChapter, maxTimelineEvents: 8 });
      return buildNoWriteIntentBlockedOutput(resolvedChapter, overview);
    }
    // B（章序护栏，防穿帮）：入库会把这章的跨章状态写进故事，下一章靠读它才不穿帮。
    // 前一章没入库就写本章 → 默认拦下（强护栏），知情后带 allowWriteAhead 再调才放行。
    // 拦在建快照/调模型之前——不浪费、不偷偷写。
    const priorChapterCommitted = resolvedChapter <= 1 ? true : await isChapterCommitted(projectDir, resolvedChapter - 1);
    const guard = evaluateChapterSequencingGuard({
      chapter: resolvedChapter,
      allowWriteAhead: input.allowWriteAhead ?? false,
      priorChapterCommitted,
    });
    if (guard.blocked) {
      const prior = guard.pendingChapterToCommit ?? resolvedChapter - 1;
      const overview = await buildStateOverview({ projectDir, chapter: resolvedChapter, maxTimelineEvents: 8 });
      return buildSequencingBlockedOutput(resolvedChapter, prior, overview);
    }
    // M6：覆盖现有非空草稿前建快照，让「再写一版」可撤销（首次出稿无旧稿可丢则不建）。
    const snapshotId = await snapshotBeforeDraftOverwrite(projectDir, resolvedChapter, `第${resolvedChapter}章再次出稿前快照`);
    // 出稿流式：路由注入了 sink 就把正文 delta 逐字喂前端编辑器（带本次章号，前端只往当前章追）；缺失=不流式。
    const draftDeltaSink = readDraftDeltaSinkFromContext(context);
    const writerClient = await createConfiguredWriterClient(
      "fastDraft",
      draftDeltaSink ? (delta) => draftDeltaSink({ chapter: resolvedChapter, text: delta }) : undefined,
    );
    const result = await runGenerateDraftToolLogic({
      projectDir,
      chapter: resolvedChapter,
      ...(input.chapterGoal !== undefined ? { chapterGoal: input.chapterGoal } : {}),
      ...(input.requestedDraftLength !== undefined ? { requestedDraftLength: input.requestedDraftLength } : {}),
      ...(input.selectedCharacterIds !== undefined ? { selectedCharacterIds: input.selectedCharacterIds } : {}),
      ...(input.selectedHookIds !== undefined ? { selectedHookIds: input.selectedHookIds } : {}),
      ...(input.mustHitBeats !== undefined ? { mustHitBeats: input.mustHitBeats } : {}),
      ...(input.maxTimelineEvents !== undefined ? { maxTimelineEvents: input.maxTimelineEvents } : {}),
      ...(input.contextTokenBudget !== undefined ? { contextTokenBudget: input.contextTokenBudget } : {}),
      writerClient,
    });
    // 只在真出稿成功时挂 snapshotId（失败=未覆盖旧稿，无需撤销点）。
    return result.ok && snapshotId ? { ...result, snapshotId } : result;
  },
});

function optionalContextBudget(contextRanking: ReturnType<typeof makeWriterRankContext>): { readonly contextBudget: ReturnType<typeof contextBudgetPayload> } | Record<string, never> {
  return contextRanking.droppedSections.length > 0 || contextRanking.coreImpact || contextRanking.issues.length > 0
    ? { contextBudget: contextBudgetPayload(contextRanking) }
    : {};
}
