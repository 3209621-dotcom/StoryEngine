// @vitest-environment node
//
// r8 任务②：历史回执污染清洗。ch84/ch88 真机实锤——被系统更正作废的编造回执留在历史里，
// 会成为后续回合的「造假范本」（模型续写它见过 N 遍的回执剧本而不调工具）。进站消毒打断正反馈。
import { describe, expect, it } from "vitest";

import {
  CORRECTED_CLAIM_HISTORY_STUB,
  HONESTY_CORRECTION_MARKER,
  OBEDIENCE_RETRY_TRANSITION_TEXT,
  RETRIED_CLAIM_HISTORY_PREFIX,
  buildObedienceRetryNudgeMessage,
  detectUnbackedCompletionClaim,
  sanitizeCorrectedAssistantHistory,
} from "./honesty-detection.js";

const FABRICATED_RECEIPT =
  "第88章《试探》已正式入库。\n更新了陆青岚的状态（警觉→紧迫），记下6条硬事实，收口了2条线索。" +
  "\n\n⚠️ 系统更正：正式入库未完成：本回合没有检测到 commit_apply 成功执行，所以没有证据表明章节已经正式写入。";

describe("sanitizeCorrectedAssistantHistory 历史回执污染清洗（r8 任务②）", () => {
  it("被系统更正过的 assistant 编造回执 → 整条替换为短桩（编造细节全部消失）", () => {
    const out = sanitizeCorrectedAssistantHistory([
      { role: "user", content: "正式入库第88章。" },
      { role: "assistant", content: FABRICATED_RECEIPT },
    ]);
    expect(out[1]!.content).toBe(CORRECTED_CLAIM_HISTORY_STUB);
    expect(out[1]!.content).not.toContain("已正式入库");
    expect(out[1]!.content).not.toContain("6条硬事实");
    // user 消息绝不动（写入意图门的授权依据）
    expect(out[0]!.content).toBe("正式入库第88章。");
  });

  it("含自动重做过渡的消息 → 丢弃被作废的声称段，只留真实结果段（带诚实前缀）", () => {
    const content =
      "第88章《试探》已写好，草稿已落盘。" +
      OBEDIENCE_RETRY_TRANSITION_TEXT +
      "第88章草稿已生成，正文约两千字，标题《对质》。";
    const out = sanitizeCorrectedAssistantHistory([{ role: "assistant", content }]);
    expect(out[0]!.content).toContain(RETRIED_CLAIM_HISTORY_PREFIX);
    expect(out[0]!.content).toContain("标题《对质》");
    expect(out[0]!.content).not.toContain("已写好，草稿已落盘");
  });

  it("重做后仍失败（既有过渡又有更正）→ 按更正规则整条桩化", () => {
    const content =
      "第88章已正式入库。" +
      OBEDIENCE_RETRY_TRANSITION_TEXT +
      "第88章已正式入库。\n\n" +
      `${HONESTY_CORRECTION_MARKER}正式入库未完成：本回合没有检测到 commit_apply 成功执行。`;
    const out = sanitizeCorrectedAssistantHistory([{ role: "assistant", content }]);
    expect(out[0]!.content).toBe(CORRECTED_CLAIM_HISTORY_STUB);
  });

  it("干净的 assistant 回执 / 普通对话 → 原样保留", () => {
    const clean = [
      { role: "assistant", content: "第87章已正式入库，共2300字，收口了2条线索。" },
      { role: "user", content: "继续写第88章。" },
      { role: "assistant", content: "好的，我先看看上一章的状态。" },
    ];
    expect(sanitizeCorrectedAssistantHistory(clean)).toEqual(clean);
  });

  it("user 消息引用了「系统更正」字样 → 原样保留（只清洗 assistant）", () => {
    const messages = [{ role: "user", content: `刚才那条${HONESTY_CORRECTION_MARKER}是什么意思？` }];
    expect(sanitizeCorrectedAssistantHistory(messages)).toEqual(messages);
  });

  it("短桩自身不会再被误判为「声称完成」（不触发二次检测）", () => {
    expect(detectUnbackedCompletionClaim(CORRECTED_CLAIM_HISTORY_STUB, [])).toBe(false);
    expect(detectUnbackedCompletionClaim(RETRIED_CLAIM_HISTORY_PREFIX, [])).toBe(false);
  });
});

// r8 二轮回归防护：重试机制让「误判声称」的代价从错一句文本升级成整轮强制重做——
// 状态问答里如实转述磁盘真相（「本书已正式入库 100 章」）绝不能被当成谎报去重做。
describe("detectUnbackedCompletionClaim 聚合进度陈述豁免", () => {
  it("read-only 状态回答「本书已正式入库 100 章」→ 不判谎报", () => {
    expect(detectUnbackedCompletionClaim("本书已正式入库 100 章，最高到第 100 章。主线推进正常。", [])).toBe(false);
    expect(detectUnbackedCompletionClaim("全书已入库 87 章，目前写到第 88 章。", [])).toBe(false);
  });

  it("聚合陈述里夹带单次动作宣称（第N章已正式入库）→ 仍判谎报", () => {
    expect(
      detectUnbackedCompletionClaim("全书已入库 92 章。第93章《夜遁》已正式入库，记下6条硬事实。", []),
    ).toBe(true);
  });

  it("单章动作宣称不受豁免影响（原有检测不弱化）", () => {
    expect(detectUnbackedCompletionClaim("第88章《试探》已正式入库。", [])).toBe(true);
    expect(detectUnbackedCompletionClaim("草稿已生成并写入工作稿。", [])).toBe(true);
  });
});

describe("buildObedienceRetryNudgeMessage 纠偏消息", () => {
  it("带用户原话 + 意图→工具路标 + 禁止再输出完成句", () => {
    const msg = buildObedienceRetryNudgeMessage("正式入库第88章。");
    expect(msg.role).toBe("system");
    expect(msg.content).toContain("正式入库第88章。");
    expect(msg.content).toContain("commit_apply");
    expect(msg.content).toContain("generate_draft");
    expect(msg.content).toContain("绝对禁止");
  });

  it("无用户原话时不插空引号", () => {
    const msg = buildObedienceRetryNudgeMessage(undefined);
    expect(msg.content).not.toContain("「」");
  });
});
