/**
 * commit_apply — 写类工具：把某章草稿正式入库（章节正文 + 角色/伏笔/线索/时间线等全套状态）。
 *
 * 对照 routes/commit.ts 的 /api/commit/apply 编排（进程内复刻）：
 *   buildCommitPlanFromProject → commitFastDraft（自带事务回滚）。
 *
 * 守卫（铁律：绝不谎报）：必须先对「同一章节」commit_preview 过、且草稿在预览之后没改动
 *   （系统内预览票据/previewToken + 草稿哈希一致），否则诚实拒绝，不入库、不谎称成功。
 * 写类：用 writeTool 包装，入库前自动建快照，可一键撤销。入库成功后消费掉该 token（防重复入库）。
 */
import { readFile } from "node:fs/promises";
import {
  buildCommitPlanFromProject,
  buildStateOverview,
  commitFastDraft,
  recoverProjectCommitTransactions,
  withProjectCommitLock,
  type StateOverview,
} from "@actalk/story-engine";
import { z } from "zod";
import { coerceNumber } from "./lenient-args.js";

import { defaultCommittedChapterPath, defaultDraftPath, extractDraftTitle, stripLeadingMarkdownChapterHeading } from "../../lib/project-io.js";
import { callOpenAICompatibleChatModel, resolveConfiguredChatModel } from "../../lib/llm-client.js";
import { extractAndAppendFacts, type FactCallModel } from "../fact-ledger/fact-ledger.js";
import { writeTool } from "../withSnapshot.js";
import { readUserTurnTextFromContext, resolveChapterFromInputOrContext } from "../request-context.js";
import { appendRecurringUncardedToSummary, updateUncardedCharacterMemo } from "./uncarded-character-memo.js";
import {
  consumeCommitPreview,
  findCommitPreview,
  hashDraftContent,
  verifyCommitPreview,
  type CommitPreviewGuardFailure,
} from "./commit-preview-store.js";
import { userTurnAllowsCommitApply } from "./turn-intent-gate.js";

const inputSchema = z.object({
  chapter: coerceNumber(z.number().int().positive().optional().describe("要入库的章号（必须与之前 commit_preview 的章号一致）。")),
  previewToken: z.string().optional().describe(
    "commit_preview 返回的真实令牌。可省略：系统会优先使用同进程内最近一次有效 commit_preview 票据；没有有效预览时会拒绝入库。",
  ),
});

const outputSchema = z.object({
  snapshotId: z.string().describe("入库前的快照 id，前端凭此可一键撤销整次入库。"),
  ok: z.boolean().describe(
    "统一诚实成功标志：true=真的入库成功（committed）；false=被拒绝或入库未通过。前端结构性防谎报只认这个字段。",
  ),
  committed: z.boolean().describe("是否真的完成了入库。"),
  refused: z.boolean().describe("是否因守卫（未预览/草稿已变/计划不可用）被拒绝。"),
  refusalReason: z.string().optional().describe("被拒绝的原因（诚实回报，不谎称成功）。"),
  blockedReason: z.string().optional().describe("写入前守卫拦截原因，如本轮用户原话没有正式入库意图。"),
  report: z.unknown().optional().describe("入库报告（更新了哪些角色/伏笔/线索/时间线等）。"),
  draftBody: z.string().optional().describe(
    "入库的章节正文（去 Markdown 标题）；入库成功时返回，供前端把正文以 committed 状态载入工作区，避免被占位覆盖、且防 autosave 把已入库章节复活成草稿。",
  ),
  draftTitle: z.string().optional().describe("入库章节标题（成功时）。"),
  overview: z.unknown().describe("入库后（或拒绝时仍读取当前）的 StateOverview，供前端刷新。"),
  summary: z.string().describe("入库结果的自然语言摘要。"),
  refreshScope: z.literal("full"),
  chapter: z.number().int().positive().optional().describe("本次入库的章号。"),
});

const GUARD_FAILURE_MESSAGE: Record<CommitPreviewGuardFailure, string> = {
  no_preview: "尚未对该章执行 commit_preview，按规则不能直接入库；请先预览确认。",
  chapter_mismatch: "预览的章节与本次入库章节不一致；请对该章重新 commit_preview。",
  token_mismatch: "previewToken 无效或与该章不匹配；请先 commit_preview 取得有效令牌。",
  draft_changed_since_preview: "草稿在预览之后又改动过；为避免入库与预览不一致，请重新 commit_preview。",
};

export interface CommitApplyToolOutput {
  readonly ok: boolean;
  readonly committed: boolean;
  readonly refused: boolean;
  readonly refusalReason?: string;
  readonly blockedReason?: string;
  readonly report?: unknown;
  readonly draftBody?: string;
  readonly draftTitle?: string;
  readonly overview: unknown;
  readonly summary: string;
  readonly refreshScope: "full";
  readonly chapter?: number;
}

// 角色候选自动登记（convertCandidatesToMatrixUpdates）已于 2026-06-24 移除：
// 正则猜的候选会把『耳边轻声』类碎片污染成矩阵候选；用户拍板「新人物只告知、不替我写盘」。
// 新出现人物改由入库后 extractAndAppendFacts 的 newCharacters 显式抽取、拼进 summary 告知（见工具 run）。

/**
 * 纯逻辑：守卫校验 + 入库 + 诚实回报。抽出为可直接单测的函数（不经 writeTool 快照包装）。
 * 任何守卫失败或计划不可用 → refused=true、committed=false，不入库、不谎报。
 */
export async function applyCommitToolLogic(input: {
  readonly projectDir: string;
  readonly chapter: number;
  readonly previewToken?: string;
}): Promise<CommitApplyToolOutput> {
  return withProjectCommitLock(input.projectDir, async () => {
    await recoverProjectCommitTransactions(input.projectDir);
    return applyCommitToolLogicUnlocked(input);
  });
}

async function applyCommitToolLogicUnlocked(input: {
  readonly projectDir: string;
  readonly chapter: number;
  readonly previewToken?: string;
}): Promise<CommitApplyToolOutput> {
  const { projectDir, chapter, previewToken } = input;
  const draftPath = defaultDraftPath(projectDir, chapter);

  let draftContent: string;
  try {
    draftContent = await readFile(draftPath, "utf-8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return refusal(projectDir, chapter, `第 ${chapter} 章草稿不存在，无法定稿。`);
    }
    throw error;
  }

  // A7 幂等探测：断流后重试（实际已入库、token 已被消费）→ 该章已入库且正文与当前草稿一致，
  // 直接幂等回报「已入库」，不因 token 蒸发误报「尚未预览」、也不重复写入。放在守卫之前。
  const duplicate = await detectAlreadyCommittedDuplicate(projectDir, chapter, draftContent);
  if (duplicate) {
    const overview = await buildStateOverview({ projectDir, chapter, maxTimelineEvents: 8 }).catch(() => undefined);
    return {
      ok: true,
      committed: true,
      refused: false,
      ...(duplicate.body ? { draftBody: duplicate.body } : {}),
      ...(duplicate.title ? { draftTitle: duplicate.title } : {}),
      overview,
      summary: `第 ${chapter} 章此前已定稿，资料已更新（本次为重复请求，未重复写入）。`,
      refreshScope: "full",
      chapter,
    };
  }

  const currentDraftHash = hashDraftContent(draftContent);
  const effectivePreviewToken = resolveEffectivePreviewToken({
    projectDir,
    chapter,
    providedToken: input.previewToken,
  });

  const guard = verifyCommitPreview({
    projectDir,
    chapter,
    token: effectivePreviewToken,
    currentDraftHash,
  });
  if (!guard.ok) {
    return refusal(projectDir, chapter, GUARD_FAILURE_MESSAGE[guard.failure ?? "no_preview"]);
  }

  // 复用预览阶段算好的章节语义声明（不重复调模型）；取不到（进程重启/凭 token 无状态放行）→ undefined，引擎走正则回退。
  const cachedDeclaration = findCommitPreview(projectDir, chapter)?.declaration;
  const commitPlan = await buildCommitPlanFromProject({
    projectDir,
    chapter,
    draftPath,
    draftContent,
    ...(cachedDeclaration ? { declaration: cachedDeclaration } : {}),
  });
  if (!commitPlan.passed || !commitPlan.commitPlan) {
    return refusal(
      projectDir,
      chapter,
      `定稿影响不可用：${commitPlan.issues.length > 0 ? commitPlan.issues.join("；") : "计划未通过"}。请重新 commit_preview。`,
    );
  }

  // 治脏：不再注入正则猜的候选（会把『耳边轻声』类碎片写成矩阵候选）。
  // 新出现人物改由入库后的 extractAndAppendFacts 显式抽取并『告知用户』，不偷偷写盘（见工具 run）。
  const finalCommitPlan = commitPlan.commitPlan;

  const report = await commitFastDraft({ projectDir, chapter, draftPath, draftContent, commitPlan: finalCommitPlan });
  if (!report.passed) {
    const overview = await buildStateOverview({ projectDir, chapter, maxTimelineEvents: 8 });
    // 铁律④·绝不泄露裸 id/path：report.issues 是引擎诊断文本，可能含合成的裸 hook-/char- id（幻影 hook）或
    // 本地绝对路径，进【给用户看的】summary/refusalReason 前先消毒（原始 issues 仍保留在结构化 report 字段）。
    const nameById = new Map(overview.characterMatrix.characters.map((character) => [character.id, character.name]));
    const safeIssues = report.issues.map((issue) => scrubBareEntityIdsFromText(issue, nameById));
    const safeJoined = safeIssues.length > 0 ? safeIssues.join("；") : "引擎报告失败";
    return {
      ok: false,
      committed: false,
      refused: false,
      ...(safeIssues.length > 0 ? { refusalReason: safeJoined } : {}),
      report,
      overview,
      // #6a 诚实性：入库失败=事务已回滚、未产生净改动 → 不再谎称「改动已建快照可撤销」。
      summary: `第 ${chapter} 章定稿未通过：${safeJoined}。本次未定稿、草稿未改动。`,
      refreshScope: "full",
    };
  }

  // 入库成功：消费 token，防止用同一 token 重复入库。
  consumeCommitPreview(projectDir, chapter);
  // Formal bytes are already committed. A supporting overview refresh must
  // never flip that business success into a tool failure.
  const overview = await buildStateOverview({ projectDir, chapter, maxTimelineEvents: 8 }).catch(() => undefined);
  // 入库的章节正文（去标题）+ 标题，供前端以 committed 状态载入工作区——与老路径 handleCommitApply 同构，
  // 防止入库后被 overview 占位覆盖，且 committed 状态让 autosave 不再把已入库章节写回 drafts/fast。
  const committedBody = stripLeadingMarkdownChapterHeading(draftContent).trim();
  const committedTitle = extractDraftTitle(draftContent) ?? undefined;
  // report.updatedCharacters 是引擎的安全 slug ID（中文名会被 toSafeCharacterId 剥成 char-<hash>）；
  // 按 overview 角色 id 映射回真实显示名再点名，绝不把 slug 暴露给用户。
  const updatedIdSet = new Set(report.updatedCharacters);
  const updatedNames = (overview?.characterMatrix.characters ?? [])
    .filter((c) => updatedIdSet.has(c.id))
    .map((c) => c.name);
  return {
    ok: true,
    committed: true,
    refused: false,
    report,
    ...(committedBody ? { draftBody: committedBody } : {}),
    ...(committedTitle ? { draftTitle: committedTitle } : {}),
    overview,
    // r7：自动蛰伏（久未推进的意图/阶段目标）必须折进可见摘要——自动写盘动作绝不静默。
    // 线索池体检：堆积达阈值时在摘要尾部带一行确定性提醒（清理仍需用户点头，这里只补盲区）。
    summary: [
      appendLifecycleNotesToSummary(
        `第 ${chapter} 章已定稿，资料已更新${
          updatedNames.length > 0 ? `（更新：${updatedNames.join("、")}）` : ""
        }。改动已建立存档点，可一键撤销。`,
        report,
      ),
      buildThreadMaintenanceNote(overview),
    ].filter(Boolean).join("\n"),
    refreshScope: "full",
    chapter,
  };
}

/**
 * A7 幂等探测：该章是否「已入库、且已入库正文与当前草稿一致」。
 * 命中=断流后重试 / 重复点入库的同一份草稿——应幂等回报「已入库」，不再因 token 被消费报「尚未预览」、
 * 也绝不重复写入。内容不一致（合法重写已入库章节）→ 返回 null，照常走守卫+入库。
 * 比对：两边都去 Markdown 标题、压掉空白后对比（已入库章节文件就是去标题的纯正文，见 045200/chapters）。
 */
async function detectAlreadyCommittedDuplicate(
  projectDir: string,
  chapter: number,
  draftContent: string,
): Promise<{ readonly body: string; readonly title?: string } | null> {
  const committed = await readFile(defaultCommittedChapterPath(projectDir, chapter), "utf-8").catch(() => undefined);
  if (committed === undefined || committed.trim().length === 0) return null;
  const norm = (text: string): string => stripLeadingMarkdownChapterHeading(text).replace(/\s+/gu, "");
  if (norm(committed) !== norm(draftContent)) return null; // 内容不同=合法重写，不走幂等
  const body = stripLeadingMarkdownChapterHeading(draftContent).trim();
  const title = extractDraftTitle(draftContent) ?? undefined;
  return { body, ...(title ? { title } : {}) };
}

async function refusal(projectDir: string, chapter: number, reason: string): Promise<CommitApplyToolOutput> {
  const overview = await buildStateOverview({ projectDir, chapter, maxTimelineEvents: 8 }).catch(() => undefined);
  // 铁律④·绝不泄露裸 id/path：拒绝原因可能来自引擎 commitPlan.issues（含裸 id/路径），统一在此消毒。
  const nameById = new Map((overview?.characterMatrix.characters ?? []).map((character) => [character.id, character.name]));
  const safeReason = scrubBareEntityIdsFromText(reason, nameById);
  return {
    ok: false,
    committed: false,
    refused: true,
    refusalReason: safeReason,
    overview,
    summary: `未定稿：${safeReason}`,
    refreshScope: "full",
  };
}

/** 把入库成功后抽到的硬事实摘要折进入库摘要（空则原样返回）。 */
export function appendFactNoteToSummary(summary: string, factSummary: string): string {
  return factSummary.trim() ? `${summary} ${factSummary.trim()}` : summary;
}

/** 未收口线索堆到这个数，入库摘要就带体检提醒（长篇实测：10 章即可积到近 30 条而作者毫无察觉）。 */
export const OPEN_THREADS_HINT_THRESHOLD = 20;
/** 引擎标记的低价值/过期线索达到这个数也提醒（数量不多但已经该清了）。 */
export const CLEANUP_VISIBLE_HINT_THRESHOLD = 3;

/**
 * 入库后的线索池体检提示（确定性，不赌模型自觉）：线索堆积到阈值就在入库摘要里带一行提醒。
 * 只提醒、不动手——清理本身仍要用户点头（清理意图门拦着），这里补的是「用户不知道积了多少」的盲区。
 * 「未收口」= open + touched（touched 只是被提到过、同样没完结——评审加固：只数 open 会在
 * 全 touched 的堆积下完全沉默）。文案面向用户：不出现工具名/英文行话（铁律④）。
 * overview 缺失（刷新失败）→ 不提醒，绝不因提醒功能影响入库回报。
 */
export function buildThreadMaintenanceNote(overview: StateOverview | undefined): string {
  const unresolved = (overview?.threads.open ?? 0) + (overview?.threads.touched ?? 0);
  const cleanupVisible = overview?.threads.cleanupVisibleCount ?? 0;
  if (unresolved < OPEN_THREADS_HINT_THRESHOLD && cleanupVisible < CLEANUP_VISIBLE_HINT_THRESHOLD) return "";
  const detail = cleanupVisible > 0
    ? `未收口的线索已积到 ${unresolved} 条，其中 ${cleanupVisible} 条已经低价值或过期`
    : `未收口的线索已积到 ${unresolved} 条`;
  return `另外，${detail}——积多了会拖累后面的章节方向。想清就说「清理线索」，我会先归并整理、建好存档点，可一键撤销。`;
}

interface ExpiredEntryLike {
  readonly title?: string;
}

/**
 * r7·蛰伏披露：本次入库若自动蛰伏了久未推进的意图线索 / 阶段目标（引擎确定性生命周期），
 * 必须折进给用户看的 summary——自动动作绝不静默。数据未删除、正文再写到会自动恢复。
 */
export function appendLifecycleNotesToSummary(summary: string, report: unknown): string {
  const root = (typeof report === "object" && report !== null ? report : {}) as {
    readonly threadTracking?: { readonly expiredIntentThreads?: readonly ExpiredEntryLike[] };
    readonly arcGoalTracking?: { readonly expiredArcGoals?: readonly ExpiredEntryLike[] };
  };
  const formatTitles = (entries: readonly ExpiredEntryLike[]): string => {
    const titles = entries
      .map((entry) => (typeof entry.title === "string" ? entry.title.trim() : ""))
      .filter((title) => title.length > 0);
    const shown = titles.slice(0, 3).map((title) => `「${title}」`).join("");
    const rest = titles.length - Math.min(titles.length, 3);
    return `${shown}${rest > 0 ? `等 ${titles.length} 条` : ""}`;
  };
  const parts: string[] = [];
  const expiredIntents = root.threadTracking?.expiredIntentThreads ?? [];
  if (expiredIntents.length > 0) {
    parts.push(`意图线索 ${expiredIntents.length} 条（${formatTitles(expiredIntents)}）`);
  }
  const expiredGoals = root.arcGoalTracking?.expiredArcGoals ?? [];
  if (expiredGoals.length > 0) {
    parts.push(`阶段目标 ${expiredGoals.length} 条（${formatTitles(expiredGoals)}）`);
  }
  if (parts.length === 0) return summary;
  return `${summary} 本次还自动蛰伏了久未推进的条目：${parts.join("；")}。数据未删除，正文再写到会自动恢复；想重新捡起来推进就说一声。`;
}

/** 把入库后抽到的「新出现人物」折进入库摘要（空则原样返回）——只告知、不写盘。 */
export function appendNewCharactersToSummary(summary: string, newCharacters: readonly string[]): string {
  if (newCharacters.length === 0) return summary;
  return `${summary} 这章还出现了新人物：${newCharacters.join("、")}——要给谁正式建卡就说一声。`;
}

/**
 * 用用户配置的模型做一次 JSON 输出调用（结算搭车在硬事实抽取上）。
 * 强制关思考：结算只机械抽 JSON、不需推理链——不跟随任务旁路默认，
 * 否则推理模型先吐 6~9k 思考 token 拖慢入库回报。短超时（20s）：抽不到就算了（非致命）。
 */
const callConfiguredFactModel: FactCallModel = async (messages) => {
  const configured = await resolveConfiguredChatModel("chapterSteering");
  const { content } = await callOpenAICompatibleChatModel({
    configured: { ...configured, thinking: false },
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    responseFormat: { type: "json_object" },
    timeoutMs: 20000,
  });
  return content;
};

export const commitApplyTool = writeTool({
  id: "commit_apply",
  description:
    "把某章草稿正式入库（写入章节正文与角色/伏笔/线索/时间线等全套状态，自带事务回滚）。" +
    "必须先对同一章 commit_preview 过、且草稿未改动；否则会被拒绝、不会入库。" +
    "previewToken 可省略，系统会使用最近一次有效入库预览票据；如果看到了真实 previewToken 可以带上，但绝不编造 token_placeholder。" +
    "入库前自动建快照，可一键撤销。本工具有写入前守卫：本轮用户原话没有明确正式入库意图会被拒绝。",
  inputSchema,
  outputSchema,
  preflight: async ({ input, projectDir, context }) => {
    const userTurnText = readUserTurnTextFromContext(context);
    if (userTurnText === undefined || userTurnAllowsCommitApply(userTurnText)) return undefined;

    console.warn("[turn-intent-gate] 拦下未授权 commit_apply（本轮用户原话无对应意图）");
    const resolvedChapter = resolveChapterFromInputOrContext(input.chapter, context);
    const overview = await buildStateOverview({ projectDir, chapter: resolvedChapter ?? 1, maxTimelineEvents: 8 }).catch(() => undefined);
    return {
      ok: false,
      committed: false,
      refused: true,
      blockedReason: "user_turn_no_commit_intent",
      refusalReason: "本回合用户没有明确要求定稿，已拦下自动定稿（写入前守卫）。",
      overview,
      summary: "本回合用户没有明确要求定稿，已拦下自动定稿（写入前守卫）。请把当前进展如实转告用户；用户说『确认定稿』我才会真正写入；旧说法『确认正式入库』也仍然有效。",
      refreshScope: "full" as const,
      ...(resolvedChapter ? { chapter: resolvedChapter } : {}),
    };
  },
  run: async ({ input, projectDir, context }) => {
    const resolvedChapter = resolveChapterFromInputOrContext(input.chapter, context);
    if (resolvedChapter === undefined) {
      throw new Error("commit_apply 缺少章号：LLM 未给出章号，且前端未注入 currentChapter。请明确指定章号。");
    }
    const result = await applyCommitToolLogic({
      projectDir,
      chapter: resolvedChapter,
      previewToken: input.previewToken,
    });
    if (!result.committed || !result.draftBody) return result;
    try {
      // 入库成功后非致命地抽硬事实 + 新出现人物，透明折进回报；抽取整体失败也绝不影响已成功的入库、绝不编造。
      // knownNames 用 overview 的真实显示名【全量】角色：report.updatedCharacters 是 slug ID（中文名会变 char-<hash>）、
      // 且只含本章被改的——拿它当已知名单会让中文名整条排不掉，主角可能被 LLM 误报为「新出现」。
      const ov = result.overview as
        | { readonly characterMatrix?: { readonly characters?: readonly { readonly name?: string }[] } }
        | undefined;
      const knownNames = (ov?.characterMatrix?.characters ?? [])
        .map((c) => c.name)
        .filter((n): n is string => typeof n === "string" && n.length > 0);
      const fact = await extractAndAppendFacts({
        projectDir,
        chapter: resolvedChapter,
        draftText: result.draftBody,
        callModel: callConfiguredFactModel,
        knownNames,
      });
      const withFacts = appendFactNoteToSummary(result.summary, fact.summary);
      const withNew = appendNewCharactersToSummary(withFacts, fact.newCharacters);
      // 反复出场未建卡 → 确定性升级点名一次（50 章实测：每章一句「要建卡就说一声」没人接茬，需要升级语气）。
      // 备忘失败自扛（评审加固：让它抛进外层 catch 会把已成功的硬事实/新人物摘要一并吞掉）。
      const recurring = await updateUncardedCharacterMemo(projectDir, resolvedChapter, fact.newCharacters)
        .catch((error) => {
          console.warn("[commit_apply] 未建卡角色备忘更新失败（不影响入库与摘要）", error);
          return [] as readonly string[];
        });
      return { ...result, summary: appendRecurringUncardedToSummary(withNew, recurring) };
    } catch {
      return result;
    }
  },
});

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

const BARE_ENTITY_ID_PLACEHOLDER: Readonly<Record<string, string>> = {
  char: "「某角色」",
  hook: "「某条伏笔」",
  thread: "「某条线索」",
  fact: "「某条硬事实」",
};

/**
 * 失败摘要消毒（铁律④·绝不泄露裸 id/path）：引擎 report.issues / commitPlan.issues 是给引擎看的诊断文本，
 * 可能含 commit-engine 合成的裸 hook-<hash>（幻影 hook）/char-/thread-/fact- 或本地绝对路径。进【给用户看的】
 * summary/refusalReason 前必须清洗：裸 id → 角色/条目名（解析得到）或中性占位（解析不到），绝对路径 → 占位。
 */
export function scrubBareEntityIdsFromText(text: string, nameById: ReadonlyMap<string, string>): string {
  return text
    // 先剥本地绝对路径（含引号包裹），避免把磁盘路径漏给用户。
    .replace(/'?\/(?:Users|home|var|tmp|private)\/[^'"\s]*'?/gu, "(本地路径)")
    // 再把裸 entity id → 名字 / 中性占位。
    .replace(/\b(char|hook|thread|fact)-[a-z0-9]{4,}\b/giu, (match, prefix: string) => {
      const name = nameById.get(match);
      if (name) return name;
      return BARE_ENTITY_ID_PLACEHOLDER[prefix.toLowerCase()] ?? "「内部条目」";
    });
}

function resolveEffectivePreviewToken(input: {
  readonly projectDir: string;
  readonly chapter: number;
  readonly providedToken?: string;
}): string | undefined {
  const record = findCommitPreview(input.projectDir, input.chapter);
  if (record) return record.token;

  const normalized = input.providedToken?.trim();
  if (!normalized || isPlaceholderPreviewToken(normalized)) return undefined;
  return normalized;
}

function isPlaceholderPreviewToken(token: string): boolean {
  return /^(?:token[_-]?placeholder|placeholder[_-]?token|preview[_-]?token[_-]?placeholder)$/iu.test(token.trim());
}
