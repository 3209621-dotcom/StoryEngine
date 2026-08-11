/**
 * commit_preview — 只读工具：预览把某章草稿入库会产生哪些变更，并做入库前质量门槛检查。
 *
 * 对照 routes/commit.ts 的 /api/commit/preview 编排（进程内复刻，不经 HTTP）：
 *   buildCommitPlanFromProject + checkDraftBeforeCommit + checkCommitPlanSemanticQuality。
 * 只跑引擎的确定性纯函数检查（不调模型），把结果摊给 agent 判断是否可入库。
 *
 * 预览成功（计划 passed）时，把 (项目, 章节, 草稿哈希) 登记成一个 previewToken 存内存，
 * 供 commit_apply 守卫「必须先预览过且草稿未变」。读类工具不建快照、不带 snapshotId。
 */
import { readFile } from "node:fs/promises";
import {
  buildCommitPlanFromProject,
  checkCommitPlanSemanticQuality,
  checkDraftBeforeCommit,
  readArcGoalPool,
  readCharacterBible,
  readHookPool,
  recoverProjectCommitTransactions,
  readThreadPool,
  readTimelineEvents,
  withProjectCommitLock,
  type ChapterDeltaDeclaration,
  type NameDriftFinding,
} from "@actalk/story-engine";
import { createTool } from "@mastra/core/tools";
import type { ToolExecutionContext } from "@mastra/core/tools";
import { z } from "zod";
import { coerceNumber } from "./lenient-args.js";

import { defaultCommittedChapterPath, defaultDraftPath } from "../../lib/project-io.js";
import { readProjectDirFromContext, resolveChapterFromInputOrContext } from "../request-context.js";
import { callConfiguredDeclareModel, declareChapterDelta } from "./chapter-delta-declaration.js";
import { hashDraftContent, recordCommitPreview } from "./commit-preview-store.js";

/**
 * 预览阶段生成章节语义声明的注入点（单测可传假实现；缺省=不声明，走引擎正则）。
 * openThreadTitles：现有未决线索标题——喂给模型，让它回收时对号入座既有线索、而非每章重埋新线索（治线索堆积）。
 */
export type DeclareDeltaFn = (input: {
  readonly chapter: number;
  readonly draft: string;
  readonly openThreadTitles?: readonly string[];
  readonly establishedNames?: readonly string[];
  readonly openGoalTitles?: readonly string[];
  readonly previousChapterEnding?: string;
}) => Promise<ChapterDeltaDeclaration | undefined>;

/** 生产用：调用配置模型声明本章语义；任何失败 → undefined（非致命，降级到引擎正则）。 */
const defaultDeclareDelta: DeclareDeltaFn = async ({ chapter, draft, openThreadTitles, establishedNames, openGoalTitles, previousChapterEnding }) =>
  declareChapterDelta({
    chapter,
    draft,
    callModel: callConfiguredDeclareModel,
    ...(openThreadTitles ? { openThreadTitles } : {}),
    ...(establishedNames ? { establishedNames } : {}),
    ...(openGoalTitles ? { openGoalTitles } : {}),
    ...(previousChapterEnding ? { previousChapterEnding } : {}),
  });

/**
 * 读现有未决的伏笔+线索标题，供声明模型回收时对号入座（回收 targetThreadHint 从这里选、别新造，也别漏收）。
 * 线索=open/touched thread；伏笔=active hook。两者都是「已埋下、还没收口」的东西，一并喂给模型。
 * 读失败/无库 → 忽略该来源，绝不阻断预览。
 */
async function readOpenThreadTitles(projectDir: string): Promise<readonly string[]> {
  const hookTitles: string[] = [];
  const threadTitles: { readonly title: string; readonly lastTouchedChapter: number }[] = [];
  try {
    const pool = await readThreadPool(projectDir);
    for (const thread of pool.threads) {
      if (thread.status !== "open" && thread.status !== "touched") continue;
      const title = typeof thread.title === "string" ? thread.title.trim() : "";
      if (title) threadTitles.push({ title, lastTouchedChapter: thread.lastTouchedChapter });
    }
  } catch {
    // 无线索库 → 跳过
  }
  try {
    const pool = await readHookPool(projectDir);
    for (const hook of pool.hooks) {
      if (hook.status !== "active") continue;
      const title = typeof hook.title === "string" ? hook.title.trim() : "";
      if (title) hookTitles.push(title);
    }
  } catch {
    // 无伏笔库 → 跳过
  }
  const unique = new Set<string>();
  const result: string[] = [];
  for (const title of hookTitles) {
    if (unique.has(title)) continue;
    unique.add(title);
    result.push(title);
  }
  for (const { title } of threadTitles
    .sort((left, right) => right.lastTouchedChapter - left.lastTouchedChapter)
    .slice(0, 40)) {
    if (unique.has(title)) continue;
    unique.add(title);
    result.push(title);
  }
  return result;
}

/**
 * 读现有未达成的主线/阶段目标标题，供声明模型推进/达成时对号入座既有目标（targetGoalHint 从这里选、别新造），
 * 治「同一条主线跨章被拆成好几个目标」。只喂 active/touched（还在推进中）的，completed/stale 不喂避免噪声。
 * 读失败/无库 → 空数组，绝不阻断预览。题材中立、纯读盘。
 */
async function readOpenArcGoalTitles(projectDir: string): Promise<readonly string[]> {
  const titles = new Set<string>();
  try {
    const pool = await readArcGoalPool(projectDir);
    for (const goal of pool.goals) {
      if (goal.status !== "active" && goal.status !== "touched") continue;
      const title = typeof goal.title === "string" ? goal.title.trim() : "";
      if (title) titles.add(title);
    }
  } catch {
    // 无目标库 → 跳过
  }
  return [...titles];
}

/**
 * 汇出本书「已确立的角色名」，供①喂给声明模型（逐字沿用、别写形近错名）②引擎名字漂移写前校验。
 * 来源：已登记角色库（character-bible）+ 之前各章时间线里出现过的角色名（跨章累积）。
 * 读失败/无库 → 空数组，绝不阻断预览。题材中立、纯读盘。
 */
async function readEstablishedCharacterNames(projectDir: string, chapter: number): Promise<readonly string[]> {
  const names = new Set<string>();
  try {
    const bible = await readCharacterBible(projectDir);
    for (const character of bible?.characters ?? []) {
      const name = character.name?.trim();
      if (name) names.add(name);
    }
  } catch {
    // 无角色库 → 跳过
  }
  try {
    const events = await readTimelineEvents(projectDir);
    for (const event of events) {
      if (typeof event.chapter === "number" && event.chapter >= chapter) continue;
      const summary = event.effects?.semanticSummary as {
        readonly mentionedCharacterNames?: readonly string[];
        readonly presentCharacterNames?: readonly string[];
      } | undefined;
      // 登记角色出现的名字 + 模型声明并校验通过的出场名（含未登记 prose-only 名，如「妹妹林宁」）。
      for (const name of [...(summary?.mentionedCharacterNames ?? []), ...(summary?.presentCharacterNames ?? [])]) {
        const trimmed = typeof name === "string" ? name.trim() : "";
        if (trimmed) names.add(trimmed);
      }
    }
  } catch {
    // 无时间线 → 跳过
  }
  return [...names];
}

function chapterEndingExcerpt(content: string, maxLength = 500): string | undefined {
  const trimmed = content.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(-maxLength);
}

async function readPreviousChapterEnding(projectDir: string, chapter: number): Promise<string | undefined> {
  if (chapter <= 1) return undefined;
  try {
    const content = await readFile(defaultCommittedChapterPath(projectDir, chapter - 1), "utf-8");
    return chapterEndingExcerpt(content);
  } catch {
    return undefined;
  }
}

const inputSchema = z.object({
  chapter: coerceNumber(z.number().int().positive().optional().describe("要预览入库的章号。")),
});

const outputSchema = z.object({
  chapter: z.number().int().positive(),
  ok: z.boolean().describe(
    "统一诚实成功标志：等于 canCommit。false=本章暂不可入库（缺草稿/计划不通过/有 error 级问题）。" +
      "前端据此把时间线步骤置 failed，避免「想入库却不可入库」被显示成绿色完成（谎报）。",
  ),
  canCommit: z.boolean().describe("是否可以入库（计划构建通过 + 质量检查无 error 级问题）。"),
  previewToken: z.string().optional().describe("预览通过时签发的一次性令牌；commit_apply 可省略它，由系统使用最近一次有效预览票据。canCommit=false 时省略。"),
  plan: z.unknown().describe("入库计划（角色/伏笔/线索/时间线等将发生的变更）。"),
  draftQualityIssues: z.array(z.object({
    severity: z.string(),
    type: z.string(),
    message: z.string(),
  })).describe("草稿入库前的确定性质量检查问题（error 级会阻止入库）。"),
  semanticQualityIssues: z.array(z.object({
    severity: z.string(),
    type: z.string(),
    message: z.string(),
  })).describe("入库计划语义质量检查问题（含 type=character_name_drift 的人物名近形漂移 warning）。"),
  nameConsistencyWarnings: z.array(z.object({
    establishedName: z.string(),
    driftedVariant: z.string(),
    message: z.string(),
  })).describe(
    "人物名一致性提醒：本章出现的名字与已确立角色名形近、疑似写歪（引擎确定性判定，非模型主观）。" +
      "必须原样转达给用户、不得淡化为『有意设计/无关紧要』；这是写前一致性护栏，不阻断入库。",
  ),
  staleThreadWarnings: z.array(z.object({
    kind: z.string(),
    title: z.string(),
    lastTouchedChapter: z.number().int().nonnegative(),
    chaptersSinceTouched: z.number().int().nonnegative(),
    message: z.string(),
  })).describe(
    "伏笔/线索/目标待收口提醒（引擎确定性判定 + 里程碑制：新停滞头两章提醒、长期停滞每 10 章重提一次，" +
      "不会每章重复刷全量；全量底数见 summary 的 digest）。kind 含 伏笔/线索/主线目标/阶段目标。" +
      "必须原样转达给用户、不得淡化——这是防『埋了不收、开了没下文』的遗漏护栏，只提示、不阻断入库。",
  ),
  blockingReasons: z.array(z.string()).describe("阻止入库的原因（草稿缺失/计划不通过/存在 error 级质量问题等）。"),
  summary: z.string().describe("预览结果的自然语言摘要（用户可见文案，UI 会直接展示；不含内部工具名）。"),
  modelHint: z.string().optional().describe("给你（模型）的行动指引：下一步流程与转达要求。仅你可见，UI 不展示。"),
});

export interface StaleThreadWarningView {
  readonly kind: string;
  readonly title: string;
  readonly lastTouchedChapter: number;
  readonly chaptersSinceTouched: number;
  readonly message: string;
}

export interface CommitPreviewToolOutput {
  readonly chapter: number;
  readonly ok: boolean;
  readonly canCommit: boolean;
  readonly previewToken?: string;
  readonly plan: unknown;
  readonly draftQualityIssues: { severity: string; type: string; message: string }[];
  readonly semanticQualityIssues: { severity: string; type: string; message: string }[];
  readonly nameConsistencyWarnings: { establishedName: string; driftedVariant: string; message: string }[];
  readonly staleThreadWarnings: StaleThreadWarningView[];
  readonly blockingReasons: string[];
  readonly summary: string;
  /** 给模型的行动指引（下一步调 commit_apply、转达要求）；UI 不渲染，summary 保持用户可见纯净。 */
  readonly modelHint?: string;
}

/**
 * 纯逻辑：构建入库预览 + 质量检查 + （通过时）登记 previewToken。抽出以便直接单测。
 * 读草稿失败（缺草稿）→ canCommit=false，blockingReasons 含 missing_draft，不发 token。
 */
export async function buildCommitPreviewToolOutput(input: {
  readonly projectDir: string;
  readonly chapter: number;
  /**
   * 可选：生成本章语义声明的函数。传入时（生产路径）在预览阶段算一次声明，随 previewToken 缓存供 apply 复用；
   * 不传（纯逻辑单测/无模型环境）→ declaration=undefined，完全走引擎正则（旧行为）。
   */
  readonly declareDelta?: DeclareDeltaFn;
}): Promise<CommitPreviewToolOutput> {
  return withProjectCommitLock(input.projectDir, async () => {
    await recoverProjectCommitTransactions(input.projectDir);
    return buildCommitPreviewToolOutputUnlocked(input);
  });
}

async function buildCommitPreviewToolOutputUnlocked(input: {
  readonly projectDir: string;
  readonly chapter: number;
  readonly declareDelta?: DeclareDeltaFn;
}): Promise<CommitPreviewToolOutput> {
  const { projectDir, chapter } = input;
  const draftPath = defaultDraftPath(projectDir, chapter);

  let draftContent: string | undefined;
  try {
    draftContent = await readFile(draftPath, "utf-8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        chapter,
        ok: false,
        canCommit: false,
        plan: undefined,
        draftQualityIssues: [],
        semanticQualityIssues: [],
        nameConsistencyWarnings: [],
        staleThreadWarnings: [],
        blockingReasons: ["missing_draft"],
        summary: `第 ${chapter} 章还没有草稿，无法预览入库。`,
      };
    }
    throw error;
  }

  // 已确立角色名：喂给声明模型逐字沿用 + 供引擎名字漂移写前校验。读失败 → 空数组，不阻断。
  const establishedCharacterNames = await readEstablishedCharacterNames(projectDir, chapter);
  const previousChapterEnding = await readPreviousChapterEnding(projectDir, chapter);

  // 章节语义声明：预览阶段算一次（失败/未配置模型 → undefined，非致命）。传给引擎优先填 mainEvent/时间线/线索回收；
  // 并随 previewToken 缓存，供 apply 复用、不重复调模型。
  let declaration: ChapterDeltaDeclaration | undefined;
  if (input.declareDelta) {
    try {
      const [openThreadTitles, openGoalTitles] = await Promise.all([
        readOpenThreadTitles(projectDir),
        readOpenArcGoalTitles(projectDir),
      ]);
      declaration = await input.declareDelta({
        chapter,
        draft: draftContent,
        openThreadTitles,
        ...(establishedCharacterNames.length > 0 ? { establishedNames: establishedCharacterNames } : {}),
        ...(openGoalTitles.length > 0 ? { openGoalTitles } : {}),
        ...(previousChapterEnding ? { previousChapterEnding } : {}),
      });
    } catch {
      declaration = undefined;
    }
  }

  const commitPlan = await buildCommitPlanFromProject({
    projectDir,
    chapter,
    draftPath,
    draftContent,
    ...(declaration ? { declaration } : {}),
    ...(establishedCharacterNames.length > 0 ? { establishedCharacterNames } : {}),
  });
  const draftQuality = await checkDraftBeforeCommit({ projectDir, chapter, draftContent });
  const semanticQuality = commitPlan.commitPlan
    ? checkCommitPlanSemanticQuality(commitPlan.commitPlan)
    : undefined;

  const draftQualityIssues = draftQuality.issues.map((issue) => ({
    severity: issue.severity,
    type: issue.type,
    message: issue.message,
  }));
  const baseSemanticQualityIssues = (semanticQuality?.issues ?? []).map((issue) => ({
    severity: issue.severity,
    type: issue.type,
    message: issue.message,
  }));
  const deltaRejectedWarnings = collectDeltaRejectedWarnings(commitPlan);

  // 人物名近形漂移：引擎的确定性发现（结构化）升级成明确 warning，别让模型在回执里把它说软或说没。
  // severity=warning（不阻断入库），type 固定为 character_name_drift，供 UI 固定展示、供模型忠实转述。
  const nameDriftFindings: readonly NameDriftFinding[] = commitPlan.nameDriftFindings ?? [];
  const nameConsistencyWarnings = nameDriftFindings.map((finding) => ({
    establishedName: finding.establishedName,
    driftedVariant: finding.driftedVariant,
    message: `人物名疑似写歪：本章出现「${finding.driftedVariant}」，与已确立角色「${finding.establishedName}」形近。请确认应写作「${finding.establishedName}」，还是「${finding.driftedVariant}」确为另一个角色。`,
  }));
  const continuityBreakWarning = collectContinuityBreakWarning(declaration);
  // 伏笔/线索/目标待收口：引擎按里程碑制（新停滞头两章 + 长期停滞每 10 章重提）确定性选出本章该提醒的条目，
  // 这里合并成一份结构化提醒（含 r7 新接入的停滞目标——此前 staleGoalWarnings 从没到过用户面前），
  // 升级成带类型的 warning，供 UI 固定展示 + 模型忠实转达。全量底数走 staleBacklog 进 digest，绝不静默。题材中立。
  const staleThreadWarnings = collectStaleThreadWarnings(commitPlan);
  const staleBacklog = readStaleBacklog(commitPlan);
  const semanticQualityIssues = [
    ...baseSemanticQualityIssues,
    ...deltaRejectedWarnings,
    ...nameConsistencyWarnings.map((warning) => ({
      severity: "warning",
      type: "character_name_drift",
      message: warning.message,
    })),
    ...staleThreadWarnings.map((warning) => ({
      severity: "warning",
      type: warning.kind.includes("目标") ? "stale_arc_goal" : "stale_thread",
      message: warning.message,
    })),
    ...(continuityBreakWarning ? [continuityBreakWarning] : []),
  ];

  const blockingReasons: string[] = [];
  if (!commitPlan.passed || !commitPlan.commitPlan) {
    blockingReasons.push("commit_plan_not_passed");
    blockingReasons.push(...commitPlan.issues);
  }
  if (draftQualityIssues.some((issue) => issue.severity === "error")) {
    blockingReasons.push("draft_quality_error");
  }
  if (semanticQualityIssues.some((issue) => issue.severity === "error")) {
    blockingReasons.push("semantic_quality_error");
  }

  const canCommit = blockingReasons.length === 0;
  let previewToken: string | undefined;
  if (canCommit) {
    const record = recordCommitPreview({
      projectDir,
      chapter,
      draftHash: hashDraftContent(draftContent),
      ...(declaration ? { declaration } : {}),
    });
    previewToken = record.token;
  }

  const preview = buildPreviewSummary({
    chapter,
    canCommit,
    blockingReasons,
    nameConsistencyWarnings,
    staleThreadWarnings,
    staleBacklog,
    deltaRejectedWarnings,
    continuityBreakWarning,
  });
  return {
    chapter,
    ok: canCommit,
    canCommit,
    ...(previewToken ? { previewToken } : {}),
    plan: commitPlan,
    draftQualityIssues,
    semanticQualityIssues,
    nameConsistencyWarnings,
    staleThreadWarnings,
    blockingReasons,
    summary: preview.summary,
    ...(preview.modelHint ? { modelHint: preview.modelHint } : {}),
  };
}

function collectDeltaRejectedWarnings(commitPlan: { readonly issues?: readonly string[] }): { severity: "warning"; type: "delta_rejected"; message: string }[] {
  return (commitPlan.issues ?? [])
    .filter((issue) => issue.startsWith("章节语义声明被拒（"))
    .map((message) => ({
      severity: "warning",
      type: "delta_rejected",
      message,
    }));
}

function collectContinuityBreakWarning(declaration: ChapterDeltaDeclaration | undefined): { severity: "warning"; type: "continuity_break"; message: string } | undefined {
  const continuity = declaration?.continuityWithPrevious;
  if (!continuity || continuity.connects !== false) return undefined;
  const note = continuity.note?.trim();
  return {
    severity: "warning",
    type: "continuity_break",
    message: `本章开头与上一章结尾疑似衔接断裂${note ? `：${note}` : ""}。请确认这是有意的时间跳转，还是需要改稿补足承接。`,
  };
}

interface PlanStaleWarningLike {
  readonly title: string;
  readonly lastTouchedChapter: number;
  readonly chaptersSinceTouched: number;
  readonly message?: string;
  readonly scope?: string;
}

/**
 * 从 commit plan 收集「伏笔/线索/目标待收口」提醒，合并成一份带中文文案的结构化视图。
 * 伏笔=staleHookWarnings、线索=staleThreadWarnings、目标=staleGoalWarnings（r7 新接入——此前目标停滞从没提醒过用户，
 * 主线「查明师父真相」停 14 章无人知晓）。引擎已按里程碑制选好该提醒的条目并给了中文 message（含主线升级文案），
 * 这里只做归类 + 去重排序，绝不重算、绝不改写引擎判词。
 */
function collectStaleThreadWarnings(commitPlan: {
  readonly staleHookWarnings?: readonly PlanStaleWarningLike[];
  readonly staleThreadWarnings?: readonly PlanStaleWarningLike[];
  readonly staleGoalWarnings?: readonly PlanStaleWarningLike[];
}): StaleThreadWarningView[] {
  const toView = (kind: string) => (warning: PlanStaleWarningLike): StaleThreadWarningView => ({
    kind,
    title: warning.title,
    lastTouchedChapter: warning.lastTouchedChapter,
    chaptersSinceTouched: warning.chaptersSinceTouched,
    message: warning.message?.trim()
      ? warning.message
      : `${kind}「${warning.title}」已经 ${warning.chaptersSinceTouched} 章没有推进（上次出现在第 ${warning.lastTouchedChapter} 章）。考虑在本章推进或收口，别让它埋了不收。`,
  });
  const merged = [
    ...(commitPlan.staleHookWarnings ?? []).map(toView("伏笔")),
    ...(commitPlan.staleThreadWarnings ?? []).map(toView("线索")),
    ...(commitPlan.staleGoalWarnings ?? []).map((warning) =>
      toView(warning.scope === "main_arc" ? "主线目标" : "阶段目标")(warning),
    ),
  ];
  // 同名去重（伏笔/线索池偶有重叠标题），保留 chaptersSinceTouched 更大的那条（更该提醒），再按停滞最久排前。
  const byKey = new Map<string, StaleThreadWarningView>();
  for (const view of merged) {
    const key = `${view.kind}|${view.title}`;
    const existing = byKey.get(key);
    if (!existing || view.chaptersSinceTouched > existing.chaptersSinceTouched) byKey.set(key, view);
  }
  return [...byKey.values()].sort((a, b) => b.chaptersSinceTouched - a.chaptersSinceTouched);
}

interface StaleBacklogView {
  readonly count: number;
  readonly oldestChaptersSinceTouched?: number;
}

/** 全书停滞线索底数（引擎 hygiene report 提供，不做里程碑过滤）——digest 用它报真话，降噪≠静默。 */
function readStaleBacklog(commitPlan: {
  readonly threadHygieneReport?: {
    readonly staleWarningCount?: number;
    readonly oldestStaleChaptersSinceTouched?: number;
  };
}): StaleBacklogView {
  const report = commitPlan.threadHygieneReport;
  const count = typeof report?.staleWarningCount === "number" ? report.staleWarningCount : 0;
  return {
    count,
    ...(typeof report?.oldestStaleChaptersSinceTouched === "number"
      ? { oldestChaptersSinceTouched: report.oldestStaleChaptersSinceTouched }
      : {}),
  };
}

/**
 * 预览摘要（工具确定性产出），拆两份（2026-08-11 真机走查：summary 曾把「需定稿时调用 commit_apply」
 * 和「请如实转达」这类模型指令原样端到 UI 实时字幕上，泄漏内部工具名，违反铁律④）：
 *  - summary：给用户看的事实文案（UI 实时字幕/步骤卡直接展示）——不出现内部工具名、不出现「请转达」类
 *    模型指令。警示内容本身保留：即便模型偷懒不展开 nameConsistencyWarnings，这句固定摘要也会把
 *    「名字疑似写歪」摆到台面上。
 *  - modelHint：给模型看的行动指引（下一步调用 commit_apply、警示须如实转达勿淡化）。模型读的是完整
 *    工具输出 JSON，指引不丢；UI 不渲染该字段。agent instructions 里另有同款流程铁律兜底。
 */
function buildPreviewSummary(input: {
  readonly chapter: number;
  readonly canCommit: boolean;
  readonly blockingReasons: readonly string[];
  readonly nameConsistencyWarnings: readonly { readonly establishedName: string; readonly driftedVariant: string }[];
  readonly staleThreadWarnings: readonly StaleThreadWarningView[];
  readonly staleBacklog?: StaleBacklogView;
  readonly deltaRejectedWarnings?: readonly { readonly message: string }[];
  readonly continuityBreakWarning?: { readonly message: string };
}): { readonly summary: string; readonly modelHint?: string } {
  const base = input.canCommit
    ? `第 ${input.chapter} 章可以定稿：定稿影响预览已生成、质量检查通过。说「确认定稿」即可写入。`
    : `第 ${input.chapter} 章暂不可定稿：${input.blockingReasons.join("；")}。`;
  let summary = base;
  if (input.nameConsistencyWarnings.length > 0) {
    const detail = input.nameConsistencyWarnings
      .map((warning) => `「${warning.driftedVariant}」疑似应为已确立角色「${warning.establishedName}」`)
      .join("；");
    summary += `【人物名一致性提醒】${detail}。请确认是否写错名字。`;
  }
  // r7：逐条只列本章该提醒的（引擎里程碑制已选好，最多再截 5 条防刷屏）；全量底数一行报真话（降噪≠静默）。
  const backlogCount = input.staleBacklog?.count ?? 0;
  if (input.staleThreadWarnings.length > 0 || backlogCount > 0) {
    const visibleWarnings = input.staleThreadWarnings.slice(0, 5);
    const detail = visibleWarnings
      .map((warning) => `${warning.kind}「${warning.title}」已 ${warning.chaptersSinceTouched} 章没推进`)
      .join("；");
    const backlogNote = backlogCount > 0
      ? `全书共 ${backlogCount} 条线索超 3 章未推进${
        input.staleBacklog?.oldestChaptersSinceTouched !== undefined
          ? `（最旧已停 ${input.staleBacklog.oldestChaptersSinceTouched} 章）`
          : ""
      }，需要批量处理可对我说『清理旧线索』或『归并相关线索』。`
      : "";
    summary += `【伏笔/线索待收口】${detail ? `本章提醒：${detail}。` : ""}${backlogNote}`;
  }
  if ((input.deltaRejectedWarnings?.length ?? 0) > 0) {
    const detail = input.deltaRejectedWarnings
      ?.slice(0, 3)
      .map((warning) => warning.message)
      .join("；");
    summary += `【章节语义声明被拒】${detail}。已回退安全路径处理。`;
  }
  if (input.continuityBreakWarning) {
    summary += `【跨章衔接提醒】${input.continuityBreakWarning.message}`;
  }
  const hints: string[] = [];
  if (input.canCommit) {
    hints.push("用户明确确认定稿后再调用 commit_apply 正式写入（可省略 token，系统用最近一次有效预览票据）；未确认前不得自行入库。");
  }
  if (summary !== base) {
    hints.push("summary 里【】内的提醒须如实转达给用户，勿淡化、勿隐去。");
  }
  return { summary, ...(hints.length > 0 ? { modelHint: hints.join(" ") } : {}) };
}

export const commitPreviewTool = createTool({
  id: "commit_preview",
  description:
    "预览把某章草稿正式入库会产生的变更，并做入库前的质量门槛检查（不修改任何文件）。" +
    "当用户想把某章入库、或想知道入库会带来哪些状态变更时，先调用本工具。" +
    "预览通过会返回 previewToken；正式入库必须随后调用 commit_apply。commit_apply 可省略 token，由系统使用最近一次有效预览票据。",
  inputSchema,
  outputSchema,
  execute: async (input: z.infer<typeof inputSchema>, context: ToolExecutionContext) => {
    const projectDir = readProjectDirFromContext(context);
    if (!projectDir) {
      throw new Error(
        "commit_preview 缺少 projectDir：请确认调用 agent 时通过 RequestContext 注入了 projectDir。",
      );
    }
    const resolvedChapter = resolveChapterFromInputOrContext(input.chapter, context);
    if (resolvedChapter === undefined) {
      throw new Error("commit_preview 缺少章号：LLM 未给出章号，且前端未注入 currentChapter。请明确指定章号。");
    }
    return buildCommitPreviewToolOutput({ projectDir, chapter: resolvedChapter, declareDelta: defaultDeclareDelta });
  },
});

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
