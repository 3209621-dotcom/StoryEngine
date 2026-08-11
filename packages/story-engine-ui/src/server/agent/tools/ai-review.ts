/**
 * ai_review — 只读工具：对某章草稿做 AI 深度审稿（剧情/节奏/人物/对白/连续性/读者钩子），不改稿。
 *
 * 对照 routes/draft.ts 的 /api/draft/ai-review 编排（进程内复刻，不经 HTTP）：
 *   checkDraftBeforeCommit（确定性质检作为审稿上下文）+ buildStateOverview + buildWritingContextPack
 *   → buildDraftAIReviewPrompt → callModel(draftReview) → parseDraftAIReviewReport，
 *   模型/解析失败时 fallbackDraftAIReviewReport（不抛、诚实标 blocked + ai-review-format-error）。
 *
 * 只读：不写盘、不建快照、不带 snapshotId / refreshScope。
 * 题材中立 / 诚实回报：直接摊出审稿报告与 usedFallback 标志，不掩盖「审稿未完成」。
 */
import {
  buildDraftAIReviewPrompt,
  buildStateOverview,
  buildWritingContextPack,
  checkDraftBeforeCommit,
  fallbackDraftAIReviewReport,
  parseDraftAIReviewReport,
  type DraftAIReviewReport,
} from "@actalk/story-engine";
import { createTool } from "@mastra/core/tools";
import type { ToolExecutionContext } from "@mastra/core/tools";
import { z } from "zod";
import { coerceNumber } from "./lenient-args.js";

import { resolveConfiguredChatModel, streamChatModelToText } from "../../lib/llm-client.js";
import { readProjectDirFromContext, resolveChapterFromInputOrContext } from "../request-context.js";
import { resolveDraftContentForQualityCheck } from "./quality-check.js";
import { countTextWords } from "../../../utils/textUtils.js";

/** 把服务端实测字数钉进审稿 prompt，禁止模型瞎估（dogfood 问题 10）。 */
export function appendActualWordCountToReviewPrompt(prompt: string, actualWordCount: number): string {
  return [
    prompt,
    "",
    `【服务端计量·禁止估算】正文实际 ${actualWordCount} 字。报告 summary 与任何字数相关评价必须引用此实际字数，禁止自行估计、约数或「大概一千字」这类猜测。`,
  ].join("\n");
}

const inputSchema = z.object({
  chapter: coerceNumber(z.number().int().positive().optional().describe("要审稿的章号。")),
  draftContent: z.string().optional().describe("可选：直接给出要审的草稿正文；省略时读取该章工作稿文件。"),
  chapterGoal: z.string().optional().describe("可选：本章目标/方向，作为审稿参照。"),
  userDirection: z.string().optional().describe("可选：用户对本章的额外要求，作为审稿参照。"),
});

const outputSchema = z.object({
  chapter: z.number().int().positive(),
  // ok=审稿是否真审成。走安全回退（usedFallback）= 没真审成 → ok:false → 前端显红，不再假装绿「已完成」（治 A5）。
  ok: z.boolean().describe("审稿是否真正完成（走安全回退 usedFallback 时为 false，诚实不掩盖审稿未完成）。"),
  review: z.unknown().describe("审稿报告（评分/裁决/优点/问题清单/各维度笔记/是否建议入库）。"),
  usedFallback: z.boolean().describe("是否因模型不可用/输出不合规走了安全回退（诚实标注，不掩盖审稿未完成）。"),
  summary: z.string().describe("审稿结论的自然语言摘要。"),
});

export interface AIReviewToolOutput {
  readonly chapter: number;
  readonly ok: boolean;
  readonly review: DraftAIReviewReport;
  readonly usedFallback: boolean;
  readonly summary: string;
}

const VERDICT_LABEL: Record<DraftAIReviewReport["verdict"], string> = {
  ready_to_commit: "可以定稿",
  needs_minor_revision: "需小修",
  needs_major_revision: "需大改",
  blocked: "被阻止",
};

/**
 * 纯逻辑：复刻路由编排——读草稿 → 确定性质检 + 上下文 → 组 prompt → callModel → 解析（失败回退）→ 摘要。
 * callModel 作为参数注入（返回模型原始内容字符串），便于单测 mock；真实 execute 注入
 * callOpenAICompatibleChatModel(draftReview)。只读，不建快照。
 */
export async function buildAIReviewToolOutput(input: {
  readonly projectDir: string;
  readonly chapter: number;
  readonly draftContent?: string;
  readonly chapterGoal?: string;
  readonly userDirection?: string;
  readonly callModel: (prompt: string) => Promise<string>;
  readonly retries?: number;
  readonly delayMs?: number;
}): Promise<AIReviewToolOutput> {
  const { projectDir, chapter } = input;
  // 模型无关取稿（与 quality_check 同源）：真显式正文 → 文件(带重试) → workspace 原始草稿。
  // 治孪生 bug：模型多塞 `draftContent:""`（或文件暂空/占位）时，旧 `?? readFile` 会审一份空稿并
  // ok:true 谎报「审了」。三处皆无真稿 → 诚实回报「还没正文可审」，绝不审空稿。
  const resolved = await resolveDraftContentForQualityCheck({
    projectDir,
    chapter,
    ...(input.draftContent !== undefined ? { explicitDraftContent: input.draftContent } : {}),
    ...(input.retries !== undefined ? { retries: input.retries } : {}),
    ...(input.delayMs !== undefined ? { delayMs: input.delayMs } : {}),
  });
  if (!resolved.hasRealDraft) {
    return {
      chapter,
      ok: false,
      review: fallbackDraftAIReviewReport("本章还没有可审的正文（草稿为空或还没生成）。"),
      usedFallback: true,
      summary: `第 ${chapter} 章还没有可审的正文（草稿为空或还没生成）。请先生成本章正文，再来审稿。`,
    };
  }
  const draftContent = resolved.content;
  const actualWordCount = countTextWords(draftContent);

  const deterministicQuality = await checkDraftBeforeCommit({ projectDir, chapter, draftContent });
  const [overview, writingContextPack] = await Promise.all([
    buildStateOverview({ projectDir, chapter, maxTimelineEvents: 8 }),
    buildWritingContextPack({
      projectDir,
      chapter,
      userDirection: input.userDirection ?? "",
      ...(input.chapterGoal !== undefined ? { currentChapterGoal: input.chapterGoal } : {}),
      maxTimelineEvents: 3,
    }).catch(() => undefined),
  ]);

  const prompt = appendActualWordCountToReviewPrompt(
    buildDraftAIReviewPrompt({
      chapter,
      draftContent,
      ...(input.chapterGoal !== undefined ? { chapterGoal: input.chapterGoal } : {}),
      ...(input.userDirection !== undefined ? { userDirection: input.userDirection } : {}),
      deterministicQuality,
      stateOverview: overview,
      ...(writingContextPack ? { writingContextPack } : {}),
    }),
    actualWordCount,
  );

  const review = await runReviewModel(prompt, input.callModel);
  const usedFallback = review.verdict === "blocked"
    && review.issues.some((issue) => issue.id === "ai-review-format-error");

  return {
    chapter,
    ok: !usedFallback, // 走回退=没真审成→ok:false→显红；真审完→ok:true
    review,
    usedFallback,
    summary: usedFallback
      ? `第 ${chapter} 章 AI 审稿未完成（模型不可用），未改任何内容；请稍后重试或人工检查。`
      : `第 ${chapter} 章 AI 审稿：${VERDICT_LABEL[review.verdict]}（评分 ${review.score}；正文实际 ${actualWordCount} 字）。${review.summary}`,
  };
}

/** 调模型并解析；任何失败（请求/空内容/解析）都走 fallback，绝不抛、不谎称审稿通过。 */
async function runReviewModel(
  prompt: string,
  callModel: (prompt: string) => Promise<string>,
): Promise<DraftAIReviewReport> {
  try {
    const content = await callModel(prompt);
    return parseDraftAIReviewReport(content);
  } catch (error) {
    return fallbackDraftAIReviewReport(error instanceof Error ? error.message : String(error));
  }
}

export const aiReviewTool = createTool({
  id: "ai_review",
  description:
    "对某章草稿做 AI 深度审稿（剧情/节奏/人物/对白/连续性/读者钩子），给出评分、裁决、问题清单与修改建议，不修改任何文件。" +
    "当用户问『帮我深度审一下这章 / 这章写得怎么样 / 有哪些可以改进』时调用。" +
    "审稿不改稿、不入库；模型不可用时会诚实标注审稿未完成，不假装通过。",
  inputSchema,
  outputSchema,
  execute: async (input: z.infer<typeof inputSchema>, context: ToolExecutionContext) => {
    const projectDir = readProjectDirFromContext(context);
    if (!projectDir) {
      throw new Error(
        "ai_review 缺少 projectDir：请确认调用 agent 时通过 RequestContext 注入了 projectDir。",
      );
    }
    const resolvedChapter = resolveChapterFromInputOrContext(input.chapter, context);
    if (resolvedChapter === undefined) {
      throw new Error("ai_review 缺少章号：LLM 未给出章号，且前端未注入 currentChapter。请明确指定章号。");
    }
    const configured = await resolveConfiguredChatModel("draftReview");
    const callModel = async (prompt: string): Promise<string> => {
      // 流式 + 空闲超时：审稿内容多、推理模型思考久，绝不设总时长上限——有任何字节（正文/思考 token）
      // 就续命，只有连接彻底静默才判死（streamChatModelToText 内部 abort 并抛错）。
      const { content } = await streamChatModelToText({
        configured,
        messages: [{ role: "user", content: prompt }],
        temperature: configured.profile.temperature ?? 0.35,
        responseFormat: { type: "json_object" },
      });
      if (!content) throw new Error("审稿模型返回了空内容。");
      return content;
    };
    return buildAIReviewToolOutput({
      projectDir,
      chapter: resolvedChapter,
      ...(input.draftContent !== undefined ? { draftContent: input.draftContent } : {}),
      ...(input.chapterGoal !== undefined ? { chapterGoal: input.chapterGoal } : {}),
      ...(input.userDirection !== undefined ? { userDirection: input.userDirection } : {}),
      callModel,
    });
  },
});
