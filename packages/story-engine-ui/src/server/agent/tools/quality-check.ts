/**
 * quality_check — 只读工具：对某章草稿做入库前质量检查（确定性规则 + AI 判定），不改稿。
 *
 * 对照 routes/draft.ts 的 /api/draft/quality 编排（进程内复刻，不经 HTTP）：
 *   checkDraftBeforeCommit（确定性规则：空稿/JSON 产物/只有标题/正文过短 + 候选问题扩面）
 *   → judgeDraftQualityWithModel（对候选问题做 AI 判定；无候选时短路不调模型，模型失败有安全回退）。
 *   judgeDraftQualityWithModel 已复用 server/lib 的 callOpenAICompatibleChatModel + qualityCheck profile。
 *
 * 只读：不写盘、不建快照、不带 snapshotId / refreshScope（不动磁盘，前端无需刷新面板）。
 * 题材中立 / 诚实回报：直接摊出引擎的质检报告，不夸大也不掩盖问题。
 */
import { readFile } from "node:fs/promises";
import { checkDraftBeforeCommit, type CommitQualityIssue, type CommitQualityReport } from "@actalk/story-engine";
import { createTool } from "@mastra/core/tools";
import type { ToolExecutionContext } from "@mastra/core/tools";
import { z } from "zod";
import { coerceNumber } from "./lenient-args.js";

import {
  chapterWorkspacePath,
  defaultDraftPath,
  hasRealDraftContent,
  isRecord,
  readStringAllowEmpty,
} from "../../lib/project-io.js";
import { judgeDraftQualityWithModel } from "../../lib/quality-judge.js";
import { refineQualityReport, type RefinedQualityReport } from "../../lib/quality-report-refine.js";
import { readProjectDirFromContext, resolveChapterFromInputOrContext } from "../request-context.js";

const inputSchema = z.object({
  chapter: coerceNumber(z.number().int().positive().optional().describe("要质检的章号。")),
  draftContent: z.string().optional().describe("可选：直接给出要质检的草稿正文；省略时读取该章工作稿文件。"),
});

const outputSchema = z.object({
  chapter: z.number().int().positive(),
  // ok=工具是否跑成（检查本身完成即 true）；partialMiss=有阻止级问题（投影成琥珀「部分完成」而非绿「已完成」，
  // 治「质检没通过却显绿、假装全好」A5）。真正的失败（草稿缺失等）走 throw、由上层显红。
  ok: z.boolean().describe("质检工具是否成功执行（跑完即 true；草稿缺失等会 throw 而非 ok:false）。"),
  partialMiss: z.boolean().describe("草稿存在阻止级问题（errorIssueCount>0）→ true，前端显「部分完成」琥珀态、不显绿。"),
  passed: z.boolean().describe("是否通过质检（无未消解的 error 级问题）。"),
  quality: z.unknown().describe("完整质检报告（确定性问题 + AI 判定）。"),
  refined: z.unknown().describe("分层降噪后的报告：硬伤(拦)/软提示(参考)/参考/已降级，每项带中文标签。"),
  errorIssueCount: z.number().int().nonnegative().describe("error 级问题数（会阻止入库）。"),
  summary: z.string().describe("质检结果的自然语言摘要（已分层降噪）。"),
});

export interface QualityCheckToolOutput {
  readonly chapter: number;
  readonly ok: boolean;
  readonly partialMiss: boolean;
  readonly passed: boolean;
  readonly quality: CommitQualityReport;
  readonly refined: RefinedQualityReport;
  readonly errorIssueCount: number;
  readonly summary: string;
}

/** AI 判定层：默认 judgeDraftQualityWithModel；单测注入确定性桩（不触网）。 */
export type QualityJudge = (input: {
  readonly projectDir: string;
  readonly chapter: number;
  readonly draftContent: string;
  readonly deterministicQuality: CommitQualityReport;
}) => Promise<CommitQualityReport>;

/**
 * 健壮解析「这章要质检的真草稿」——治真机 QA bug：新书写完立刻质检误报「正文为空/过短」。
 * 根因：草稿落盘有时序竞争窗口，裸 readFile 会读到空（FS 抖动）或显示用占位符（约50字→误报过短），
 * 把用户在编辑器/写作区明明看得见的真稿当没写。按可靠度取真稿：
 *   ① 显式正文（仅当是真稿；空串/占位符不算，治 generate_draft 偶发回空被透传当空稿）
 *   ② 工作稿文件 drafts/fast/*.md（带 FS 抖动重试：刚写盘偶发读空/读到占位符，重试即得真稿）
 *   ③ workspace 原始 draftContent（编辑器看到的就是它；文件暂空/占位时它常已有真稿）
 *   ④ 三处皆无真稿 → hasRealDraft=false，上层诚实回报「还没正文可质检」（不喂占位符给引擎误报）。
 * retries/delayMs 仅为单测可注入（默认 3×60ms，与 generate_draft 的 readDraftBodyWithRetry 同源）。
 */
export async function resolveDraftContentForQualityCheck(input: {
  readonly projectDir: string;
  readonly chapter: number;
  readonly explicitDraftContent?: string;
  /**
   * 是否信任 explicitDraftContent 为权威真稿（afterfix·Codex 真机：质检读了模型臆想的正文）。
   * - true：编辑器/路由传的【用户实时正文】，可能比盘新 → 顶格优先（draft.ts 路由用）。
   * - false（默认）：**agent 工具路**——模型给的正文不可信（可能臆想/过期），一律不盖过磁盘真稿，
   *   只在磁盘+workspace 都无真稿（FS 抖动）时才作末位兜底。质检/审稿评的必须是「真要入库的盘上正文」。
   */
  readonly trustExplicit?: boolean;
  readonly retries?: number;
  readonly delayMs?: number;
}): Promise<{ readonly content: string; readonly hasRealDraft: boolean }> {
  // 可信显式正文（编辑器实时稿）→ 顶格优先。
  if (input.trustExplicit && input.explicitDraftContent !== undefined && hasRealDraftContent(input.explicitDraftContent)) {
    return { content: input.explicitDraftContent, hasRealDraft: true };
  }

  const retries = input.retries ?? 3;
  const delayMs = input.delayMs ?? 60;
  const draftPath = defaultDraftPath(input.projectDir, input.chapter);
  let fileContent = "";
  for (let attempt = 0; attempt < retries; attempt++) {
    fileContent = await readFile(draftPath, "utf-8").catch(() => "");
    if (hasRealDraftContent(fileContent)) return { content: fileContent, hasRealDraft: true };
    if (attempt < retries - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const workspaceDraft = await readWorkspaceDraftContent(input.projectDir, input.chapter);
  if (hasRealDraftContent(workspaceDraft)) return { content: workspaceDraft!, hasRealDraft: true };

  // explicitDraftContent 末位兜底（不可信源/agent 路）：仅磁盘+workspace 都无真稿时才用，绝不盖过盘上真稿。
  if (input.explicitDraftContent !== undefined && hasRealDraftContent(input.explicitDraftContent)) {
    return { content: input.explicitDraftContent, hasRealDraft: true };
  }

  return { content: fileContent, hasRealDraft: false };
}

/** 直读 workspace 记录的原始 draftContent 字段（编辑器/写作区显示用的草稿，绕开 readChapterWorkspaceSnapshot 的文件优先解析）。 */
async function readWorkspaceDraftContent(projectDir: string, chapter: number): Promise<string | undefined> {
  const parsed = await readFile(chapterWorkspacePath(projectDir, chapter), "utf-8")
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => null);
  return isRecord(parsed) ? readStringAllowEmpty(parsed.draftContent) : undefined;
}

/** 三处都没真稿时的诚实输出：明确「还没正文可质检」，不把空/占位符喂引擎误报「正文为空/过短」（铁律④诚实回报）。 */
function buildNoDraftQualityOutput(chapter: number): QualityCheckToolOutput {
  const issue: CommitQualityIssue = {
    severity: "error",
    type: "draft_not_found_for_check",
    message: "No draft body found to check for this chapter yet.",
  };
  const quality: CommitQualityReport = { passed: false, issues: [issue] };
  const refined = refineQualityReport(quality);
  return {
    chapter,
    ok: true,
    partialMiss: true,
    passed: false,
    quality,
    refined,
    errorIssueCount: refined.blocking.length,
    summary: `第 ${chapter} 章还没有可质检的正文（草稿为空或还没生成）。请先生成本章正文，再来质检。`,
  };
}

/**
 * 纯逻辑：复刻路由编排——取真草稿 → checkDraftBeforeCommit → judge（AI 判定）→ 摘要。
 * judge 作为参数注入：真实 execute 用 judgeDraftQualityWithModel（复用 server/lib 的
 * callOpenAICompatibleChatModel + qualityCheck profile，模型失败自带安全回退）；单测注入桩避免触网。
 */
export async function buildQualityCheckToolOutput(input: {
  readonly projectDir: string;
  readonly chapter: number;
  readonly draftContent?: string;
  readonly judge?: QualityJudge;
  readonly retries?: number;
  readonly delayMs?: number;
}): Promise<QualityCheckToolOutput> {
  const { projectDir, chapter } = input;
  const resolved = await resolveDraftContentForQualityCheck({
    projectDir,
    chapter,
    ...(input.draftContent !== undefined ? { explicitDraftContent: input.draftContent } : {}),
    ...(input.retries !== undefined ? { retries: input.retries } : {}),
    ...(input.delayMs !== undefined ? { delayMs: input.delayMs } : {}),
  });
  if (!resolved.hasRealDraft) {
    return buildNoDraftQualityOutput(chapter);
  }
  const draftContent = resolved.content;
  const judge = input.judge ?? judgeDraftQualityWithModel;

  const deterministicQuality = await checkDraftBeforeCommit({ projectDir, chapter, draftContent });
  const quality = await judge({ projectDir, chapter, draftContent, deterministicQuality });

  // 分层 + 软误报降级（UI 侧·引擎零改）：把一堆 warning/info 噪音归类，硬伤亮出来、软提示不淹真问题。
  const refined = refineQualityReport(quality);
  const errorIssueCount = refined.blocking.length;

  // 铁律④·绝不静默失败：AI 语义判定层走 fallback（超时/网络失败/输出不合规）时，确定性规则照常出结论，
  // 但必须诚实披露「AI 语义判定本轮未完成」——否则 agent 会把它当『通过、可入库』转告，掩盖判定层没跑。
  const aiJudgeFallbackNote = quality.modelJudge?.fallbackUsed === true
    ? "（注意：AI 语义判定本轮未完成，仅按确定性规则分级；可重试或切换质检模型再判一次）"
    : "";

  return {
    chapter,
    ok: true, // 跑到这里=质检确实执行完了（草稿缺失会在上面 readFile 时 throw、不到这里）
    // 有阻止级硬伤、或 AI 判定 confirmed+high 的严重问题(severe)→琥珀「部分完成」，不再假装绿「已完成」
    // （afterfix：severe 虽不硬拦入库，但绝不让质检步骤显绿误导用户以为全好了）。
    partialMiss: errorIssueCount > 0 || refined.severe.length > 0,
    passed: refined.passed,
    quality,
    refined,
    errorIssueCount,
    summary: `第 ${chapter} 章质检：${refined.summary}${aiJudgeFallbackNote}`,
  };
}

export const qualityCheckTool = createTool({
  id: "quality_check",
  description:
    "对某章草稿做入库前质量检查（确定性规则 + AI 判定），不修改任何文件。" +
    "当用户问『这章草稿有没有问题 / 能入库吗 / 帮我检查一下质量』时调用。" +
    "返回质检报告（含 error 级阻止项），但不改稿、不入库。",
  inputSchema,
  outputSchema,
  execute: async (input: z.infer<typeof inputSchema>, context: ToolExecutionContext) => {
    const projectDir = readProjectDirFromContext(context);
    if (!projectDir) {
      throw new Error(
        "quality_check 缺少 projectDir：请确认调用 agent 时通过 RequestContext 注入了 projectDir。",
      );
    }
    const resolvedChapter = resolveChapterFromInputOrContext(input.chapter, context);
    if (resolvedChapter === undefined) {
      throw new Error("quality_check 缺少章号：LLM 未给出章号，且前端未注入 currentChapter。请明确指定章号。");
    }
    return buildQualityCheckToolOutput({
      projectDir,
      chapter: resolvedChapter,
      ...(input.draftContent !== undefined ? { draftContent: input.draftContent } : {}),
    });
  },
});
