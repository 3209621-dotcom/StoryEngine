/**
 * edit_fact_ledger —— 写类工具：增删改硬事实账本（story/fact-ledger.json）。
 * 用户在对话里说「把第7章那条改成…/删掉…/记一条…」时由 agent 调用。写前自动建快照，可撤销。
 */
import { buildStateOverview } from "@actalk/story-engine";
import { z } from "zod";
import { coerceEnum, coerceNumber } from "./lenient-args.js";
import { writeTool } from "../withSnapshot.js";
import { applyFactEdit, readFactLedger, CorruptFactLedgerError } from "../fact-ledger/fact-ledger.js";

const inputSchema = z.object({
  // 模型无关：枚举大小写宽容（模型常传 "Add"/"REMOVE"），否则核心写分发偶发硬 InputValidationError。
  op: coerceEnum(z.enum(["add", "update", "remove", "supersede"]).describe(
    "add=新增一条；update=改某条（要 id+text）；remove=删某条（要 id）；" +
    "supersede=标记某条旧事实从某章起被取代（合法演进，用户说『主角的钱现在能动了/某设定变了』时用，要 id+chapter=从第几章起失效）。",
  )),
  id: z.string().optional().describe("update/remove/supersede 的目标条目 id（形如 fact-7-0）。不知道 id 时 supersede 用 targetText 描述即可。"),
  chapter: coerceNumber(z.number().int().positive().optional().describe("add 时该事实属于第几章；supersede 时=从第几章起失效（通常填用户当前所在章）。")),
  text: z.string().optional().describe("add/update 的事实内容（一句话、具体可核对）。"),
  targetText: z.string().optional().describe("supersede 时：要取代的那条旧事实的描述/关键词（如『资金被冻结』），系统据此在账本里找到它，无需你知道 id。"),
  supersededByFactId: z.string().optional().describe("supersede 时可选：被哪条新事实取代（登记演进链）。"),
});

const outputSchema = z.object({
  snapshotId: z.string().describe("写前快照 id，可一键撤销本次改动。"),
  ok: z.boolean(),
  summary: z.string(),
  facts: z.unknown().describe("改后的账本条目，供回答用户。"),
  refreshScope: z.literal("foundation"),
});

export async function editFactLedgerLogic(input: {
  readonly projectDir: string;
  readonly op: "add" | "update" | "remove" | "supersede";
  readonly id?: string;
  readonly chapter?: number;
  readonly text?: string;
  readonly targetText?: string;
  readonly supersededByFactId?: string;
}): Promise<{ readonly ok: boolean; readonly summary: string; readonly facts: unknown }> {
  // 修 P1·3：add 缺章号时从当前章 context 解析（解析不到则交给 applyFactEdit 如实 ok:false，不再默认第 0 章）。
  let chapter = input.chapter;
  if (input.op === "add" && chapter === undefined) {
    const overview = await buildStateOverview({ projectDir: input.projectDir, maxTimelineEvents: 8 }).catch(() => undefined);
    const cur = overview?.project?.currentChapter;
    if (typeof cur === "number" && Number.isInteger(cur) && cur > 0) chapter = cur;
  }
  const { ok, summary } = await applyFactEdit(input.projectDir, input.op, {
    ...(input.id ? { id: input.id } : {}),
    ...(chapter !== undefined ? { chapter } : {}),
    ...(input.text ? { text: input.text } : {}),
    ...(input.targetText ? { targetText: input.targetText } : {}),
    ...(input.supersededByFactId ? { supersededByFactId: input.supersededByFactId } : {}),
  });
  // 末尾重读账本供回答；损坏时 applyFactEdit 已 ok:false，这里不再抛、给空（修 P1·2）。
  let facts: unknown = [];
  try {
    facts = (await readFactLedger(input.projectDir)).facts;
  } catch (error) {
    if (!(error instanceof CorruptFactLedgerError)) throw error;
  }
  return { ok, summary, facts };
}

export const editFactLedgerTool = writeTool({
  id: "edit_fact_ledger",
  description:
    "增删改『硬事实账本』。当用户说『把第N章那条硬事实改成…/删掉某条硬事实/帮我记一条硬事实』时调用；" +
    "当用户说某条旧设定『现在变了/不成立了/已经能…了』(合法演进)时，用 op=supersede 把那条标记为从本章起被取代——" +
    "旧设定从此不再喂正文、但不删除可撤销。写前自动建快照、可一键撤销。" +
    "只记客观已确认的事实（地点/物件/编号/谁做了什么），不要把角色台词里的威胁/猜测/未证实说法" +
    "（如『你碰了就回不了头』『他肯定是凶手』）直接当成世界规则记进账本——除非正文已独立证实它是真的。",
  inputSchema,
  outputSchema,
  run: async ({ input, projectDir }) => {
    const result = await editFactLedgerLogic({
      projectDir,
      op: input.op,
      ...(input.id ? { id: input.id } : {}),
      ...(input.chapter ? { chapter: input.chapter } : {}),
      ...(input.text ? { text: input.text } : {}),
      ...(input.targetText ? { targetText: input.targetText } : {}),
      ...(input.supersededByFactId ? { supersededByFactId: input.supersededByFactId } : {}),
    });
    return { ...result, refreshScope: "foundation" as const };
  },
});
