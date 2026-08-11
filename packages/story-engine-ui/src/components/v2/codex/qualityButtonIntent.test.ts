import { describe, expect, it } from "vitest";

import { detectMissingExecutionForRequest } from "../../../hooks/detectUnbackedCompletion.js";
import { CAPABILITY_GROUPS, QUICK_ACTIONS } from "./ChatCapabilityBar.js";
import { BEFORE_DRAFT, COMMITTED, HAS_DRAFT } from "./ChapterToolRail.js";

/**
 * 契约（修 Bug3 + R2#1）：每个「动作类」快捷按钮发出的中文 intent，在本回合没真调对应工具时，
 * 必须被诚实兜底 detectMissingExecutionForRequest 识别成**正确的目标工具**——
 * 既不能被问句旁路吞掉（如带「有没有/吗」会被当提问、兜底失灵 → 点了没反应也没诚实提示），
 * 也不能误判到别的工具（如审稿误判成 quality_check、会把模型正确调的 ai_review 也盖掉）。
 * 这道测试钉住所有动作按钮文案不再漂回「问句 / 诱导级联 / 误路由」的措辞。
 *
 * 只覆盖有诚实兜底网的「动作类」按钮（key→tool）。做厚/整理/先给方案 等无对应守卫期望（设计如此），不在此约束。
 */
const KEY_TO_TOOL: Record<string, string> = {
  draft: "generate_draft",
  next: "generate_draft",
  review: "ai_review",
  deai: "check_ai_flavor",
  quality: "quality_check",
  // 入库按钮现在走【预览】(入库流程入口)：守卫期望 commit_preview；正式写入由「确认正式入库」另行触发。
  commit: "commit_preview",
};

const allActions = [
  ...QUICK_ACTIONS,
  ...CAPABILITY_GROUPS.flatMap((group) => group.actions),
  ...BEFORE_DRAFT,
  ...HAS_DRAFT,
  ...COMMITTED,
];

const guardedActions = allActions.filter((action) => action.key in KEY_TO_TOOL);

describe("动作按钮意图 → 工具 契约", () => {
  it("覆盖到所有受守卫约束的动作键（防 filter 空过假绿）", () => {
    const keys = new Set(guardedActions.map((a) => a.key));
    for (const key of Object.keys(KEY_TO_TOOL)) {
      expect(keys.has(key), `缺少 key=${key} 的按钮`).toBe(true);
    }
  });

  it("每个动作按钮意图都路由到正确的目标工具（无 quality_check 工具步时）", () => {
    for (const action of guardedActions) {
      const expected = KEY_TO_TOOL[action.key];
      const missing = detectMissingExecutionForRequest(action.intent, []);
      expect(missing, `意图「${action.intent}」应被识别为缺执行`).not.toBeNull();
      expect(missing!.expectedTool, `意图「${action.intent}」应路由到 ${expected}`).toBe(expected);
    }
  });

  it("质检/审稿/查AI味 按钮意图不含会诱导『下结论/级联入库』的尾巴", () => {
    for (const action of guardedActions) {
      if (action.key === "commit") continue; // 入库按钮本就该提入库
      expect(action.intent, `意图「${action.intent}」不应提『入库』`).not.toMatch(/入库/u);
    }
  });
});
