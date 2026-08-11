/**
 * revise_draft — 草稿局部修订工具：对工作稿里某段原文做「确定性替换」的局部改写。
 *
 * 对照 routes/draft-revision.ts 的 preview→apply 编排（进程内合一复刻，不经 HTTP）：
 *   buildDraftRevisionPrompt → callOpenAICompatibleChatModel(repair) → parseDraftRevisionPreview
 *   → applyDraftRevisionToContent（确定性替换：原文必须在草稿中唯一出现）→ 写回工作稿。
 *
 * 安全/诚实（铁律）：
 * - 原文须唯一命中：缺失/出现多次 → applyDraftRevisionToContent 抛错，本工具捕获后诚实回报
 *   applied:false，绝不写坏草稿、绝不谎称改了。
 * - 模型输出格式不全（缺 afterText）→ parseDraftRevisionPreview 抛错 → 走 fallback，applied:false。
 * 快照策略：草稿是「待保存」工作稿，不建 git 快照（同 generate_draft）；故用 createTool 而非 writeTool，
 *   output 不带 snapshotId。涉及草稿 → refreshScope:"full"。
 * - 题材中立：description / summary 用中性词。
 */
import { readFile, writeFile } from "node:fs/promises";
import {
  buildDraftRevisionPrompt,
  buildStateOverview,
  buildWritingContextPack,
  parseDraftRevisionPreview,
  type DraftRevisionPreview,
  type DraftRevisionTask,
  type StateOverview,
} from "@actalk/story-engine";
import { createTool } from "@mastra/core/tools";
import type { ToolExecutionContext } from "@mastra/core/tools";
import { z } from "zod";
import { coerceEnum, coerceNumber, coerceStringArray } from "./lenient-args.js";

import { callOpenAICompatibleChatModel, resolveConfiguredChatModel } from "../../lib/llm-client.js";
import { defaultDraftPath, stripLeadingMarkdownChapterHeading } from "../../lib/project-io.js";
import { readProjectDirFromContext, resolveChapterFromInputOrContext } from "../request-context.js";
import { snapshotBeforeDraftOverwrite } from "./snapshot-on-draft-overwrite.js";

const inputSchema = z.object({
  chapter: coerceNumber(z.number().int().positive().optional().describe("要修订的章号（工作稿所在章）。")),
  targetText: z.string().describe(
    "要修订的原文片段，必须**逐字**取自当前工作稿且在稿中只出现一次（确定性替换的锚点）。出现多次会被拒绝。",
  ),
  revisionGoal: z.string().describe("修订目标：希望把这段改成什么样（如『语气更克制』『补一个动作细节』）。"),
  // afterfix·精确替换：用户给了「替换成的确切文本」时带上它——工具会**原样落地、不再让模型改写**（治真机：
  // 模型拿到精确文本却自行改写成别的）。仅做精确 find-replace 时用；要 AI 改写/润色时省略，走模型路。
  replacementText: z.string().optional().describe(
    "可选：用户指定的【精确替换文本】。给了就把 targetText 原样替换成它（确定性、不调模型改写）；"
    + "用户说『把这句换成「……」』这种点名了确切新文本时填它。要 AI 自行改写/润色则不要填。",
  ),
  // 模型无关：枚举大小写宽容（模型传 "DeAI"/"DEAI" 不再硬失败）。
  style: coerceEnum(z.enum(["deai"]).optional().describe(
    "可选风格模板。deai=去 AI 味改写：自动注入去 AI 腔的写作手法（删空泛形容词/套路排比升华/被滥用的过渡抒情，改用具体动作与可感细节）。"
    + "用户看完 check_ai_flavor 体检后要求『改掉 AI 味/去 AI 腔』时，对命中句逐句调本工具并设 style:deai（仍一次一句、targetText 逐字取自草稿）。",
  )),
  problemSummary: z.string().optional().describe("可选：这段当前的问题一句话概括。"),
  constraints: coerceStringArray(z.array(z.string()).optional().describe("可选：修订约束（如『保留人物关系』『不新增剧情』）。")),
});

/** 去 AI 味改写手法（服务端版；与前端 selectionRevisionTemplates 的 deai 模板同源，因 import 边界不跨包共享）。 */
const DEAI_CRAFT_GUIDANCE =
  "改写这段文字，去掉常见的 AI 腔：删掉空泛的形容词堆砌、套路化的排比与升华总结句、"
  + "「仿佛 / 似乎 / 不禁 / 那一刻 / 心中五味杂陈」之类被滥用的过渡与抒情；"
  + "改用具体的动作、可感的细节和有长短变化的句子，让它读起来像人写的、有呼吸和留白。";

const outputSchema = z.object({
  ok: z.boolean().describe("是否成功修订并写回工作稿。"),
  applied: z.boolean().describe("是否真的把改动写进了草稿（诚实回报，未命中/格式不全时为 false）。"),
  preview: z.unknown().describe("修订预览（beforeText/afterText/改动说明等）。"),
  draftBody: z.string().optional().describe(
    "修订后的完整草稿正文（去 Markdown 章节标题）；成功时返回，供前端把真正文载入工作区（防占位覆盖+autosave 抹稿）。",
  ),
  overview: z.unknown().describe("修订后重新读取的 StateOverview，供前端刷新写作区/总览。"),
  summary: z.string().describe("修订结果的自然语言摘要。"),
  refreshScope: z.literal("full"),
  snapshotId: z.string().optional().describe("修订覆盖草稿前建的快照 id（M6：让修订可撤销）；未命中/未写回时无此值。"),
  chapter: z.number().int().positive().optional().describe("被修订草稿的章号。"),
});

export interface ReviseDraftToolOutput {
  readonly ok: boolean;
  readonly applied: boolean;
  readonly preview: DraftRevisionPreview;
  readonly draftBody?: string;
  readonly overview: StateOverview;
  readonly summary: string;
  readonly refreshScope: "full";
  readonly snapshotId?: string;
  readonly chapter?: number;
}

/** 由本工具输入组装一个 DraftRevisionTask（与路由 readDraftRevisionTask 等价的最小构造）。 */
function buildRevisionTask(input: {
  readonly chapter: number;
  readonly targetText: string;
  readonly revisionGoal: string;
  readonly problemSummary?: string;
  readonly constraints?: readonly string[];
}): DraftRevisionTask {
  return {
    id: `revision-${Date.now().toString(36)}`,
    chapter: input.chapter,
    targetType: "paragraph",
    targetText: input.targetText,
    problemSummary: input.problemSummary?.trim() || "局部修订",
    revisionGoal: input.revisionGoal,
    constraints: input.constraints ?? [],
    status: "pending",
  };
}

export type RevisionTargetSpan = { readonly start: number; readonly end: number };

/**
 * 引号归一表（afterfix·改稿可用性）：模型常把对白连引号一起当 target 传，且引号风格与磁盘不一致
 * （磁盘 curly “”，模型回 ASCII "" 或 CJK 「」）→ 精确/空白归一都失配、locate 报 not_found、改稿「不可用」。
 * 把各种成对引号归成一个 canonical 字符（保持长度 1↔1，origIndex 映射不变）。双引号家族→"，单引号家族→'。
 */
const QUOTE_CANON: Readonly<Record<string, string>> = {
  "“": "\"", "”": "\"", "「": "\"", "」": "\"", "『": "\"", "』": "\"",
  "„": "\"", "‟": "\"", "＂": "\"", "«": "\"", "»": "\"",
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "＇": "'",
};
const canonChar = (ch: string): string => QUOTE_CANON[ch] ?? ch;

/**
 * B4 改写定位：先精确子串匹配（唯一→span / 多次→ambiguous）；精确未命中时用「空白+引号归一」兜底——
 * 把目标里的空白运行（含全/半角空格、换行）当作任意空白、各种成对引号当等价，回原文匹配真实区间。
 * 纯确定性、题材中立。只归一空白与引号（最常见的对白改写失配源），不碰其它标点（易过度匹配）。
 */
export function locateTargetSpan(
  draftContent: string,
  target: string,
): RevisionTargetSpan | "not_found" | "ambiguous" {
  // 1) 精确子串匹配优先（保持原行为：唯一→span / 多次→ambiguous）。
  const first = draftContent.indexOf(target);
  if (first >= 0) {
    if (draftContent.indexOf(target, first + target.length) >= 0) return "ambiguous";
    return { start: first, end: first + target.length };
  }
  // 2) 空白+引号归一兜底：剥空白、引号归 canonical 后比对，命中再映射回原文真实区间——覆盖模型回吐片段
  //    空白「多了/少了/全半角不一致」+ 引号风格不一致（“”/""/「」）全部情况（精确 indexOf 对这些一律失败）。
  const strippedChars: string[] = [];
  const origIndex: number[] = []; // strippedChars[i] 对应原文位置 origIndex[i]
  for (let i = 0; i < draftContent.length; i += 1) {
    const ch = draftContent[i]!;
    if (!/\s/u.test(ch)) {
      strippedChars.push(canonChar(ch));
      origIndex.push(i);
    }
  }
  const strippedDraft = strippedChars.join("");
  const strippedTarget = target.replace(/\s+/gu, "").split("").map(canonChar).join("");
  if (strippedTarget.length === 0) return "not_found";
  const sIdx = strippedDraft.indexOf(strippedTarget);
  if (sIdx < 0) return "not_found";
  if (strippedDraft.indexOf(strippedTarget, sIdx + strippedTarget.length) >= 0) return "ambiguous";
  return { start: origIndex[sIdx]!, end: origIndex[sIdx + strippedTarget.length - 1]! + 1 };
}

/**
 * 纯逻辑：复刻 preview+apply 编排。callModel 注入（返回模型原始内容字符串），便于单测 mock；
 * 真实 execute 注入 callOpenAICompatibleChatModel(repair)。草稿类不建 git 快照。
 *
 * 守卫顺序与路由一致：先校验原文非空、在稿中唯一出现 → 再调模型预览 → applyDraftRevisionToContent
 * （二次确定性守卫）→ 写回。任何一步不满足都 applied:false 诚实回报、不写坏草稿。
 */
export async function runReviseDraftToolLogic(input: {
  readonly projectDir: string;
  readonly chapter: number;
  readonly targetText: string;
  readonly revisionGoal: string;
  readonly style?: "deai";
  readonly problemSummary?: string;
  readonly constraints?: readonly string[];
  /** afterfix·精确替换：用户给的确切新文本——给了就原样落地、跳过模型改写。 */
  readonly replacementText?: string;
  readonly callModel: (prompt: string) => Promise<string>;
}): Promise<ReviseDraftToolOutput> {
  const { projectDir, chapter } = input;
  const draftPath = defaultDraftPath(projectDir, chapter);
  const draftContent = await readFile(draftPath, "utf-8");

  // B3：style=deai 时把去 AI 味手法注入修订目标——让 agent 看完 check_ai_flavor 后能直接经本工具去 AI 味，
  // 不再退化成普通润色（前端「改掉这句」那条 deai 路 agent 够不到的洞，从此 agent 也能驱动去 AI 味改写）。
  const revisionGoal = input.style === "deai"
    ? `${DEAI_CRAFT_GUIDANCE}${input.revisionGoal.trim() ? `\n另外按这条具体要求改：${input.revisionGoal.trim()}` : ""}`
    : input.revisionGoal;

  let task = buildRevisionTask({
    chapter,
    targetText: input.targetText,
    revisionGoal,
    ...(input.problemSummary !== undefined ? { problemSummary: input.problemSummary } : {}),
    ...(input.constraints !== undefined ? { constraints: input.constraints } : {}),
  });

  const target = task.targetText.trim();
  if (!target) {
    return refusal(projectDir, chapter, task, "修订任务缺少原文片段，请先指明要修的那段文字。");
  }
  // B4：先精确匹配；失败再用「空白归一」兜底定位回原文真实区间（治模型回吐片段多/少一个空格、全/半角
  // 空格不一致导致长目标 / 批量改稿频繁「未找到」）。命中后用真实原文重建任务，保证下游 prompt 与引擎二次
  // 守卫都精确命中（引擎 draft-revision 零改，靠喂它真实存在的 beforeText 来满足其 indexOf 精确匹配）。
  const span = locateTargetSpan(draftContent, target);
  if (span === "not_found") {
    return refusal(projectDir, chapter, task, "未在当前草稿中找到要修的原文片段，请逐字确认目标段落。");
  }
  if (span === "ambiguous") {
    return refusal(projectDir, chapter, task, "原文片段在草稿中出现多次，请改用更精确、只出现一次的片段。");
  }
  const resolvedTarget = draftContent.slice(span.start, span.end);
  if (resolvedTarget !== target) {
    task = buildRevisionTask({
      chapter,
      targetText: resolvedTarget,
      revisionGoal,
      ...(input.problemSummary !== undefined ? { problemSummary: input.problemSummary } : {}),
      ...(input.constraints !== undefined ? { constraints: input.constraints } : {}),
    });
  }

  // 精确替换快路（afterfix·真机：模型拿到精确文本却自行改写成别的）：用户给了确切新文本 → 按目标 span 原样落地、
  // 跳过模型改写，保证「换成你说的那句」。空/与原文一致则诚实拒（no-op）。
  const exactReplacement = input.replacementText?.trim();
  if (exactReplacement) {
    if (exactReplacement === resolvedTarget.trim()) {
      return refusal(projectDir, chapter, task, "给的替换文本与原句一致，等于没改；草稿未改动。");
    }
    const replaced = draftContent.slice(0, span.start) + exactReplacement + draftContent.slice(span.end);
    await writeFile(draftPath, `${replaced.trimEnd()}\n`, "utf-8");
    const overviewAfter = await buildStateOverview({ projectDir, chapter, maxTimelineEvents: 8 });
    return {
      ok: true,
      applied: true,
      preview: {
        taskId: task.id,
        beforeText: resolvedTarget,
        afterText: exactReplacement,
        changeSummary: "按你给的精确文本替换",
        rationale: "用户指定了确切替换文本，确定性原样落地（未经模型改写）。",
        riskNotes: [],
        preservedFacts: [],
        warnings: [],
      },
      draftBody: stripLeadingMarkdownChapterHeading(replaced).trim(),
      overview: overviewAfter,
      summary: `已在第 ${chapter} 章工作稿上按你给的精确文本替换了该句。草稿未入库，可继续修改或撤销。`,
      refreshScope: "full",
      chapter,
    };
  }

  const [overviewBefore, writingContextPack] = await Promise.all([
    buildStateOverview({ projectDir, chapter, maxTimelineEvents: 8 }),
    buildWritingContextPack({
      projectDir,
      chapter,
      userDirection: "",
      currentChapterGoal: task.revisionGoal,
      maxTimelineEvents: 3,
    }).catch(() => undefined),
  ]);

  const prompt = buildDraftRevisionPrompt({
    task,
    draftContent,
    stateOverview: overviewBefore,
    ...(writingContextPack ? { writingContextPack } : {}),
  });

  let preview: DraftRevisionPreview;
  try {
    const raw = await input.callModel(prompt);
    preview = parseDraftRevisionPreview(raw, task);
  } catch (error) {
    return refusal(
      projectDir,
      chapter,
      task,
      `修订模型输出不可用，未改动草稿：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 定位模型回吐的 beforeText 的真实区间（容忍引号/空白变体——对白引号风格常与磁盘不一致：磁盘 curly “”、
  // 模型回 ASCII "" 或 「」，旧的精确 indexOf 会失配致改稿「未找到原文/不可用」，afterfix 真机正是此症）。
  const beforeSpan = locateTargetSpan(draftContent, preview.beforeText);
  if (beforeSpan === "not_found" || beforeSpan === "ambiguous") {
    return refusal(
      projectDir,
      chapter,
      task,
      "模型回吐的原句没法在草稿里唯一定位，未改动草稿。请重试或把要改的原文说得更精确。",
      preview,
    );
  }
  // 漂移守卫（afterfix·改稿谎报根治）：模型 beforeText 的区间必须与用户点名的目标区间重叠，否则=模型去动了
  // 别处（漂移）→ 诚实拒、不落盘，绝不报「这处改好了」（Codex 真机：目标句仍逐字在盘却报已改）。
  const overlaps = beforeSpan.start < span.end && span.start < beforeSpan.end;
  if (!overlaps) {
    return refusal(
      projectDir,
      chapter,
      task,
      "模型改写的不是你指定的那段（它去动了别处），草稿未改动。请把要改的原文逐字说清，或重试。",
      preview,
    );
  }
  // 按 beforeText 的真实区间落点替换（afterText 收尾去空白）——不再靠精确 indexOf，引号/空白风格不一致也能真落地。
  const updatedContent = draftContent.slice(0, beforeSpan.start) + preview.afterText.trim() + draftContent.slice(beforeSpan.end);

  // no-op 守卫（铁律④：改了等于没改不许报成功）：替换后内容与原稿逐字相同=没有任何修改——不写盘、诚实回报。
  if (updatedContent === draftContent) {
    return refusal(
      projectDir,
      chapter,
      task,
      "模型回吐的片段与原文一致，等于没有任何修改；草稿未改动。",
      preview,
    );
  }

  // 目标级诚实守卫（afterfix·改稿谎报根治）：成功必须 =「用户点名的那段真被改动」。resolvedTarget 在草稿里唯一
  // （ambiguous 已拦），改后它若仍原样存在（空白+引号归一比对）= 目标没真被动 → 诚实拒、不落盘，绝不报「已修订」。
  const normForCheck = (text: string): string => text.replace(/\s+/gu, "").split("").map(canonChar).join("");
  if (normForCheck(updatedContent).includes(normForCheck(resolvedTarget))) {
    return refusal(
      projectDir,
      chapter,
      task,
      "改写后你点名的那句仍原样留在草稿里，等于没真改到；草稿未改动。请重试或把要改的原文逐字说清。",
      preview,
    );
  }

  await writeFile(draftPath, `${updatedContent.trimEnd()}\n`, "utf-8");
  const overview = await buildStateOverview({ projectDir, chapter, maxTimelineEvents: 8 });
  return {
    ok: true,
    applied: true,
    preview,
    // 修订后的完整草稿正文（去标题），供前端把真正文载入工作区，与 generate_draft 的 draftBody 同构。
    draftBody: stripLeadingMarkdownChapterHeading(updatedContent).trim(),
    overview,
    summary: `已在第 ${chapter} 章工作稿上完成局部修订：${preview.changeSummary}。草稿未入库，可继续修改或撤销。`,
    refreshScope: "full",
    chapter,
  };
}

async function refusal(
  projectDir: string,
  chapter: number,
  task: DraftRevisionTask,
  reason: string,
  preview?: DraftRevisionPreview,
): Promise<ReviseDraftToolOutput> {
  const overview = await buildStateOverview({ projectDir, chapter, maxTimelineEvents: 8 });
  return {
    ok: false,
    applied: false,
    preview: preview ?? {
      taskId: task.id,
      beforeText: task.targetText,
      afterText: task.targetText,
      changeSummary: "未应用任何修改。",
      rationale: reason,
      riskNotes: [reason],
      preservedFacts: [],
      warnings: ["未应用任何修改。"],
    },
    overview,
    summary: `未修订：${reason}`,
    refreshScope: "full",
  };
}

export const reviseDraftTool = createTool({
  id: "revise_draft",
  description:
    "对某章工作稿里某段原文做局部修订（确定性替换：原文必须逐字取自草稿且只出现一次）。" +
    "当用户说『把这段改成…… / 修一下这一句 / 这段语气太冲，改克制点』时调用。" +
    "草稿是待保存的工作稿，不建 git 快照（改坏了走操作历史撤销）。原文未命中或出现多次会被拒绝、不写坏草稿。",
  inputSchema,
  outputSchema,
  execute: async (input: z.infer<typeof inputSchema>, context: ToolExecutionContext) => {
    const projectDir = readProjectDirFromContext(context);
    if (!projectDir) {
      throw new Error(
        "revise_draft 缺少 projectDir：请确认调用 agent 时通过 RequestContext 注入了 projectDir。",
      );
    }
    const resolvedChapter = resolveChapterFromInputOrContext(input.chapter, context);
    if (resolvedChapter === undefined) {
      throw new Error("revise_draft 缺少章号：LLM 未给出章号，且前端未注入 currentChapter。请明确指定章号。");
    }
    const configured = await resolveConfiguredChatModel("repair");
    const callModel = async (prompt: string): Promise<string> => {
      const { content, raw, response } = await callOpenAICompatibleChatModel({
        configured,
        messages: [{ role: "user", content: prompt }],
        temperature: configured.profile.temperature ?? 0.45,
        responseFormat: { type: "json_object" },
      });
      if (!response.ok) {
        throw new Error(`修订模型请求失败：${response.status} ${raw.slice(0, 180)}`);
      }
      if (!content) throw new Error("修订模型返回了空内容。");
      return content;
    };
    // M6：修订会覆盖现有草稿，覆盖前建快照让修订可撤销（修订必有非空草稿）。
    const snapshotId = await snapshotBeforeDraftOverwrite(projectDir, resolvedChapter, `第${resolvedChapter}章修订前快照`);
    const result = await runReviseDraftToolLogic({
      projectDir,
      chapter: resolvedChapter,
      targetText: input.targetText,
      revisionGoal: input.revisionGoal,
      ...(input.style !== undefined ? { style: input.style } : {}),
      ...(input.problemSummary !== undefined ? { problemSummary: input.problemSummary } : {}),
      ...(input.constraints !== undefined ? { constraints: input.constraints } : {}),
      ...(input.replacementText !== undefined ? { replacementText: input.replacementText } : {}),
      callModel,
    });
    // 只在真改了草稿时挂 snapshotId（未命中/未写回=没覆盖，无需撤销点）。
    return result.ok && result.applied && snapshotId ? { ...result, snapshotId } : result;
  },
});
