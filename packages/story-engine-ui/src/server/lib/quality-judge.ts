import { buildStateOverview, userDisplayCategoryForJudgement } from "@actalk/story-engine";
import type { CommitQualityReport, QualityAiJudgement } from "@actalk/story-engine";
import { resolveConfiguredChatModel, streamChatModelToText } from "./llm-client.js";
import { extractJsonObject, isRecord } from "./project-io.js";

const QUALITY_JUDGE_DRAFT_EXCERPT_CHARS = 6_000;
const QUALITY_JUDGE_MAX_CANDIDATES = 12;

export async function judgeDraftQualityWithModel(input: {
  readonly projectDir: string;
  readonly chapter: number;
  readonly draftContent: string;
  readonly deterministicQuality: CommitQualityReport;
}): Promise<CommitQualityReport> {
  const candidates = input.deterministicQuality.candidates ?? [];
  if (candidates.length === 0) {
    return {
      ...input.deterministicQuality,
      modelJudge: { used: false, fallbackUsed: false, summary: "规则未发现候选问题。" },
    };
  }

  try {
    const [configured, overview] = await Promise.all([
      resolveConfiguredChatModel("qualityCheck"),
      buildStateOverview({ projectDir: input.projectDir, chapter: input.chapter, maxTimelineEvents: 8 }).catch(() => undefined),
    ]);
    // 流式 + 空闲超时：质检长草稿、推理模型思考久，绝不设总时长上限（旧的 25s 死封会把长内容误杀）。
    const { content } = await streamChatModelToText({
      configured,
      responseFormat: { type: "json_object" },
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "你是长篇小说草稿质量判定 Agent。",
            "规则检查只负责扩大候选范围，不是最终结论。你必须结合正文、章节上下文和作者可能意图判断。",
            "不要因为关键词机械命中就判错；如果像伏笔、留白、角色未知、作者故意安排，应标记 author_intent 或 dismissed。",
            "硬结构问题仍应确认，例如空草稿、JSON/tool artifact、只有标题、正文过短。模型解释文字是文本候选，若正文里是正常对白或叙事，应 dismissed。",
            "候选里的 evidence/contextHint 是判定证据；如果已有前文证据和本章证据，不要回答“上下文未提供”。",
            "cross_chapter_pronoun_drift 的前文章节代词就是连续性证据，不需要角色档案另写性别才可判定；解释必须引用前文/本章证据。",
            "只返回 JSON，不要 Markdown。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            chapter: input.chapter,
            task: "Judge rule candidates for draft quality.",
            outputSchema: {
              summary: "string",
              judgements: [{
                candidateId: "string",
                verdict: "confirmed | uncertain | dismissed | author_intent",
                severity: "none | low | medium | high",
                explanation: "string",
                recommendedAction: "ignore | watch | ask_user | revise | require_confirmation",
              }],
            },
            candidates: candidates.slice(0, QUALITY_JUDGE_MAX_CANDIDATES).map((candidate) => ({
              id: candidate.id,
              source: candidate.source,
              type: candidate.type,
              message: candidate.message,
              evidence: candidate.evidence,
              severityHint: candidate.severityHint,
              confidenceHint: candidate.confidenceHint,
              contextHint: candidate.contextHint,
            })),
            context: overview ? buildQualityJudgeContextSummary(overview) : undefined,
            draftExcerpt: input.draftContent.slice(0, QUALITY_JUDGE_DRAFT_EXCERPT_CHARS),
          }, null, 2),
        },
      ],
    });
    const parsed = JSON.parse(extractJsonObject(content) ?? content) as unknown;
    const judgements = readQualityJudgements(parsed);
    return mergeQualityJudgements(input.deterministicQuality, judgements, {
      used: true,
      fallbackUsed: false,
      profileId: configured.profile.id,
      model: configured.profile.model,
      summary: isRecord(parsed) && typeof parsed.summary === "string" ? parsed.summary : undefined,
    });
  } catch (error) {
    return {
      ...input.deterministicQuality,
      modelJudge: {
        used: true,
        fallbackUsed: true,
        error: error instanceof Error ? error.message : String(error),
        summary: "AI 判定未完成，已保留规则候选与默认风险分类。",
      },
    };
  }
}

function buildQualityJudgeContextSummary(overview: Awaited<ReturnType<typeof buildStateOverview>>): Record<string, unknown> {
  return {
    project: {
      title: overview.project.title,
      genre: overview.project.genre,
      currentChapter: overview.project.currentChapter,
    },
    storyStatus: {
      stage: overview.storyStatus.currentStage,
      location: overview.storyStatus.currentLocation,
      objective: overview.storyStatus.currentObjective,
    },
    characters: overview.characters.knownCharacters.slice(0, 8).map((character) => ({
      name: character.name,
      role: character.role,
      status: character.status,
    })),
    writingRules: {
      perspective: overview.writingRules.narrativePerspective,
      proseStyle: overview.writingRules.proseStyle.slice(0, 6),
      doNotDo: overview.writingRules.doNotDo.slice(0, 8),
      forbiddenContent: overview.writingRules.forbiddenContent.slice(0, 8),
    },
    activeHooks: overview.hooks.activeItems.slice(0, 6).map((item) => item.title),
    openThreads: overview.threads.keyOpenItems.slice(0, 6).map((item) => item.title),
    arcGoals: overview.arcGoals.activeItems.slice(0, 6).map((item) => item.title),
  };
}

export function mergeQualityJudgements(
  report: CommitQualityReport,
  judgements: readonly QualityAiJudgement[],
  modelJudge: NonNullable<CommitQualityReport["modelJudge"]>,
): CommitQualityReport {
  const judgementMap = new Map(judgements.map((judgement) => [judgement.candidateId, judgement]));
  const candidates = report.candidates ?? [];
  const judgedIssues = candidates.map((candidate) => {
    const judgement = judgementMap.get(candidate.id) ?? candidateDefaultJudgement(report, candidate.id);
    const modelJudgement = judgement;
    const safeJudgement = isHardDraftBlocker(candidate.type)
      ? {
        candidateId: candidate.id,
        verdict: "confirmed" as const,
        severity: "high" as const,
        explanation: modelJudgement.explanation || "硬结构问题不能由语义判定忽略。",
        recommendedAction: "require_confirmation" as const,
      }
      // 代词漂移：只有**点出指代对象**的实质解释（如"这里的他指主角、非某配角"）的 dismissed 才放行——治"他/她"指代误报；
      // 泛泛的"可能是作者意图/上下文未提供"草率忽略仍焊回待确认（防漏真的他/她笔误）。
      : isNonDismissibleQualityCandidate(candidate.type) && isDismissiveJudgement(modelJudgement) && !isReferentBackedPronounDismissal(modelJudgement.explanation)
        ? {
          candidateId: candidate.id,
          verdict: "uncertain" as const,
          severity: candidate.severityHint === "high" ? "high" as const : "medium" as const,
          explanation: evidenceBackedContinuityExplanation(candidate),
          recommendedAction: "ask_user" as const,
        }
      : isNonDismissibleQualityCandidate(candidate.type) && hasWeakContinuityExplanation(modelJudgement.explanation)
        ? {
          ...modelJudgement,
          explanation: evidenceBackedContinuityExplanation(candidate),
          recommendedAction: modelJudgement.recommendedAction === "ignore" ? "ask_user" as const : modelJudgement.recommendedAction,
        }
      : modelJudgement;
    return {
      ...candidate,
      status: "judged" as const,
      judgement: safeJudgement,
      userDisplayCategory: userDisplayCategoryForJudgement(safeJudgement),
    };
  });
  const enrichedIssues = report.issues.map((issue, index) => {
    const judged = judgedIssues[index];
    return judged ? {
      ...issue,
      judgement: judged.judgement,
      userDisplayCategory: judged.userDisplayCategory,
    } : issue;
  });
  return {
    ...report,
    passed: !enrichedIssues.some((issue) => issue.severity === "error" && issue.userDisplayCategory !== "dismissed"),
    issues: enrichedIssues,
    judgedIssues,
    modelJudge,
  };
}

function hasWeakContinuityExplanation(explanation: string): boolean {
  return /上下文未提供|未提供.*性别|角色表未.*性别|缺少.*性别/u.test(explanation);
}

/**
 * 代词漂移的 dismiss 是否"实质"——点出了指代对象（如"这里的他指主角""指的是另一个角色"），
 * 而非泛泛"可能是作者意图/上下文未提供"。只有实质 dismiss 才放行，治"他/她"指代别人的误报。
 */
function isReferentBackedPronounDismissal(explanation: string): boolean {
  // 去掉引号/括号干扰（"『他』指" → "他指"），再匹配。
  const text = (explanation ?? "").replace(/[『』「」“”"'（）()]/gu, "");
  if (/另一(?:个|位)?(?:人|角色|男人|女人|男性|女性)/u.test(text)) return true;
  if (/(?:他|她|它)(?:其实|实际|这里|此处)?指/u.test(text)) return true;
  if (/指(?:的)?(?:是)?[\p{Script=Han}]{2,6}(?:[，、。；]|不是|而非|本人|自己)/u.test(text)) return true;
  return false;
}

function evidenceBackedContinuityExplanation(candidate: { readonly evidence?: string; readonly message: string }): string {
  const evidence = candidate.evidence?.trim() || candidate.message.trim();
  return evidence
    ? `前文/本章证据已经显示称谓不一致，需要作者确认这是笔误还是刻意伏笔。${evidence}`
    : "跨章连续性候选不能由模型直接忽略，必须交给作者确认。";
}

function candidateDefaultJudgement(report: CommitQualityReport, candidateId: string): QualityAiJudgement {
  const existing = report.judgedIssues?.find((item) => item.id === candidateId)?.judgement
    ?? report.issues.find((issue) => issue.candidateId === candidateId)?.judgement;
  return existing ?? {
    candidateId,
    verdict: "uncertain",
    severity: "medium",
    explanation: "模型未返回该候选的判定，保留为待确认。",
    recommendedAction: "ask_user",
  };
}

function isHardDraftBlocker(type: string): boolean {
  return [
    "empty_draft",
    "tool_or_json_artifact",
    "title_only",
    "too_short",
  ].includes(type);
}

function isNonDismissibleQualityCandidate(type: string): boolean {
  return [
    "cross_chapter_pronoun_drift",
  ].includes(type);
}

function isDismissiveJudgement(judgement: QualityAiJudgement): boolean {
  return judgement.verdict === "dismissed"
    || judgement.verdict === "author_intent"
    || judgement.severity === "none"
    || judgement.recommendedAction === "ignore";
}

function readQualityJudgements(value: unknown): readonly QualityAiJudgement[] {
  if (!isRecord(value) || !Array.isArray(value.judgements)) return [];
  return value.judgements.map((item): QualityAiJudgement | null => {
    if (!isRecord(item)) return null;
    const candidateId = typeof item.candidateId === "string" ? item.candidateId : "";
    const verdict = readQualityVerdict(item.verdict);
    const severity = readQualitySeverity(item.severity);
    const recommendedAction = readQualityAction(item.recommendedAction);
    if (!candidateId || !verdict || !severity || !recommendedAction) return null;
    return {
      candidateId,
      verdict,
      severity,
      explanation: typeof item.explanation === "string" && item.explanation.trim()
        ? item.explanation.trim()
        : "模型未给出详细解释。",
      recommendedAction,
    };
  }).filter((item): item is QualityAiJudgement => item !== null);
}

function readQualityVerdict(value: unknown): QualityAiJudgement["verdict"] | null {
  return value === "confirmed" || value === "uncertain" || value === "dismissed" || value === "author_intent" ? value : null;
}

function readQualitySeverity(value: unknown): QualityAiJudgement["severity"] | null {
  return value === "none" || value === "low" || value === "medium" || value === "high" ? value : null;
}

function readQualityAction(value: unknown): QualityAiJudgement["recommendedAction"] | null {
  return value === "ignore" || value === "watch" || value === "ask_user" || value === "revise" || value === "require_confirmation" ? value : null;
}
