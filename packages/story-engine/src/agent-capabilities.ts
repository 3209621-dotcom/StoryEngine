export type AgentCapabilityId =
  | "chapterSteeringAgent"
  | "contextPackAgent"
  | "draftWriterAgent"
  | "draftEditAgent"
  | "qualityAgent"
  | "reviewAgent"
  | "revisionAgent"
  | "foundationAgent"
  | "satelliteUpdateAgent"
  | "commitPreviewAgent"
  | "commitApplyAgent";

export type AgentCapabilityPermission =
  | "safe_read"
  | "model_call"
  | "draft_write"
  | "draft_patch"
  | "foundation_patch"
  | "formal_state_preview"
  | "formal_state_write";

export type AgentConfirmationPolicy =
  | "none"
  | "draft_save_reject"
  | "confirm_before_foundation_write"
  | "confirm_before_formal_state_write";

export interface AgentStatusLabels {
  readonly queued: string;
  readonly running: string;
  readonly completed: string;
  readonly failed: string;
}

export interface AgentCapability {
  readonly id: AgentCapabilityId;
  readonly label: string;
  readonly purpose: string;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly permissions: readonly AgentCapabilityPermission[];
  readonly confirmation: AgentConfirmationPolicy;
  readonly userTriggerHints: readonly string[];
  readonly statusLabels: AgentStatusLabels;
}

const DEFAULT_STATUS_LABELS: AgentStatusLabels = {
  queued: "等待中",
  running: "处理中",
  completed: "已完成",
  failed: "处理失败",
};

export const STORY_ENGINE_AGENT_CAPABILITIES: readonly AgentCapability[] = [
  {
    id: "chapterSteeringAgent",
    label: "剧情方案",
    purpose: "读取当前状态，生成本章推进方向和写作任务。",
    reads: ["StateOverview", "story/bible.json", "story/writing-rules.json", "recent timeline"],
    writes: ["chapter steering result"],
    permissions: ["safe_read", "model_call"],
    confirmation: "none",
    userTriggerHints: ["这一章怎么写", "给我一个方案", "下一步剧情怎么走"],
    statusLabels: {
      ...DEFAULT_STATUS_LABELS,
      running: "正在分析章节方向",
      completed: "章节方案已生成",
    },
  },
  {
    id: "contextPackAgent",
    label: "上下文准备",
    purpose: "组装当前章节工作窗口，避免把全书长上下文硬塞给写手模型。",
    reads: ["previous chapter summaries", "current chapter task", "relevant foundation files", "writing rules"],
    writes: ["writing context package"],
    permissions: ["safe_read"],
    confirmation: "none",
    userTriggerHints: ["准备写作上下文", "检查当前上下文", "读取本章资料"],
    statusLabels: {
      ...DEFAULT_STATUS_LABELS,
      running: "正在调取写作上下文",
      completed: "写作上下文已准备",
    },
  },
  {
    id: "draftWriterAgent",
    label: "正文生成",
    purpose: "按用户方向、本章方案和工作窗口生成左侧工作稿。",
    reads: ["writing context package", "current chapter steering", "writing rules"],
    writes: ["drafts/fast/chapter-{chapter}.md"],
    permissions: ["safe_read", "model_call", "draft_write"],
    confirmation: "draft_save_reject",
    userTriggerHints: ["开始写", "按这个写", "生成草稿", "续写这一章"],
    statusLabels: {
      ...DEFAULT_STATUS_LABELS,
      running: "正在写作草稿",
      completed: "草稿已生成，等待保存或拒绝",
    },
  },
  {
    id: "draftEditAgent",
    label: "草稿修改",
    purpose: "按自然语言直接修改左侧工作稿，包括新增、删除、替换和局部改写。",
    reads: ["current draft", "targeted context", "writing rules"],
    writes: ["draft patch"],
    permissions: ["safe_read", "model_call", "draft_patch"],
    confirmation: "draft_save_reject",
    userTriggerHints: ["删掉这一章", "把这里改成", "补一段", "重写这几段"],
    statusLabels: {
      ...DEFAULT_STATUS_LABELS,
      running: "正在修改草稿",
      completed: "草稿改动已生成，等待保存或拒绝",
    },
  },
  {
    id: "qualityAgent",
    label: "草稿质检",
    purpose: "检查草稿连续性、穿帮、硬规则、知识边界、资产和地点问题。",
    reads: ["current draft", "StateOverview", "foundation files", "writing context package"],
    writes: ["quality report"],
    permissions: ["safe_read", "model_call"],
    confirmation: "none",
    userTriggerHints: ["质检", "检查穿帮", "看看有没有问题"],
    statusLabels: {
      ...DEFAULT_STATUS_LABELS,
      running: "正在质检草稿",
      completed: "质检完成",
    },
  },
  {
    id: "reviewAgent",
    label: "审稿建议",
    purpose: "以编辑视角给出建议，不自动修改草稿。",
    reads: ["current draft", "writing rules", "StateOverview"],
    writes: ["review advice"],
    permissions: ["safe_read", "model_call"],
    confirmation: "none",
    userTriggerHints: ["审稿", "从编辑角度看看", "给我修改建议"],
    statusLabels: {
      ...DEFAULT_STATUS_LABELS,
      running: "正在审稿",
      completed: "审稿完成",
    },
  },
  {
    id: "revisionAgent",
    label: "修订预览",
    purpose: "只在质检或审稿产生明确修订任务后，把问题清单转成修订预览。",
    reads: ["current draft", "quality report", "review advice"],
    writes: ["revision preview"],
    permissions: ["safe_read", "model_call", "draft_patch"],
    confirmation: "draft_save_reject",
    userTriggerHints: ["按质检结果修", "按审稿意见修", "应用这条修订"],
    statusLabels: {
      ...DEFAULT_STATUS_LABELS,
      running: "正在准备修订",
      completed: "修订预览已生成",
    },
  },
  {
    id: "foundationAgent",
    label: "资料助手",
    purpose: "查询、补全和修改本书范围内的角色、地点、世界观、资产和写作规则资料。",
    reads: [
      "story/bible.json",
      "story/world-bible.json",
      "story/character-bible.json",
      "story/location-bible.json",
      "story/assets.json",
      "story/writing-rules.json",
      "world/core.json",
      "world/state.json",
      "characters/*",
    ],
    writes: ["structured foundation patches"],
    permissions: ["safe_read", "model_call", "foundation_patch"],
    confirmation: "confirm_before_foundation_write",
    userTriggerHints: ["补角色", "改世界观", "新增地点", "写入资产", "补写作规则"],
    statusLabels: {
      ...DEFAULT_STATUS_LABELS,
      running: "正在整理资料设定",
      completed: "资料设定草案已生成",
    },
  },
  {
    id: "satelliteUpdateAgent",
    label: "状态更新建议",
    purpose: "草稿保存或章节入库后，提取角色、地点、资产、伏笔和时间线的后续更新建议。",
    reads: ["saved draft or formal chapter", "existing satellite files", "StateOverview"],
    writes: ["proposed satellite patches"],
    permissions: ["safe_read", "model_call", "foundation_patch"],
    confirmation: "confirm_before_foundation_write",
    userTriggerHints: ["同步状态", "更新角色状态", "更新资产和地点"],
    statusLabels: {
      ...DEFAULT_STATUS_LABELS,
      running: "正在提取状态变化",
      completed: "状态更新建议已生成",
    },
  },
  {
    id: "commitPreviewAgent",
    label: "入库预览",
    purpose: "把当前草稿转成正式故事状态变更预览，不直接写入。",
    reads: ["current draft", "quality result", "StateOverview"],
    writes: ["commit preview"],
    permissions: ["safe_read", "formal_state_preview"],
    confirmation: "none",
    userTriggerHints: ["入库预览", "准备入库", "确认会写入什么"],
    statusLabels: {
      ...DEFAULT_STATUS_LABELS,
      running: "正在生成入库预览",
      completed: "入库预览已生成",
    },
  },
  {
    id: "commitApplyAgent",
    label: "正式入库",
    purpose: "在用户确认入库预览后，写入正式故事状态。",
    reads: ["confirmed commit preview", "current draft"],
    writes: ["formal story state", "chapter archive"],
    permissions: ["safe_read", "formal_state_write"],
    confirmation: "confirm_before_formal_state_write",
    userTriggerHints: ["确认入库", "提交本章", "写入正式状态"],
    statusLabels: {
      ...DEFAULT_STATUS_LABELS,
      running: "正在写入正式状态",
      completed: "正式状态已写入",
    },
  },
];

export function getAgentCapability(id: AgentCapabilityId): AgentCapability {
  const capability = STORY_ENGINE_AGENT_CAPABILITIES.find((item) => item.id === id);
  if (!capability) {
    throw new Error(`Unknown StoryEngine agent capability: ${id}`);
  }
  return capability;
}

export interface DescribeAgentCapabilitiesOptions {
  /**
   * 是否在每条能力后渲染「确认策略」行。默认 true（保持历史行为）。
   *
   * 设为 false 用于「直接做」口径的总控 agent：那种 agent 的 instructions 自己
   * 已经声明了统一的确认口径（写类直接做 + 可撤销），不能再把含
   * confirm_before_foundation_write 的策略措辞塞进去，否则会和铁律自相矛盾，
   * 让模型有概率在落盘前反向要求用户确认。
   */
  readonly includeConfirmationPolicy?: boolean;
}

export function describeAgentCapabilitiesForPrompt(
  chapter: number | null,
  options: DescribeAgentCapabilitiesOptions = {},
): string {
  const includeConfirmationPolicy = options.includeConfirmationPolicy ?? true;
  const draftPath = chapter === null
    ? "drafts/fast/chapter-当前章节.md"
    : `drafts/fast/chapter-${String(chapter).padStart(4, "0")}.md`;

  return STORY_ENGINE_AGENT_CAPABILITIES.map((capability) => {
    const writes = capability.writes
      .map((target) => target === "drafts/fast/chapter-{chapter}.md" ? draftPath : target)
      .join("、");
    const lines = [
      `- ${capability.id}（${capability.label}）：${capability.purpose}`,
      `  读取：${capability.reads.join("、")}`,
      `  写入/产物：${writes}`,
      `  用户说法示例：${capability.userTriggerHints.join("、")}`,
    ];
    if (includeConfirmationPolicy) {
      lines.push(`  确认策略：${describeConfirmationPolicy(capability.confirmation)}`);
    }
    return lines.join("\n");
  }).join("\n");
}

function describeConfirmationPolicy(policy: AgentConfirmationPolicy): string {
  switch (policy) {
    case "none":
      return "不需要确认，但不能声称已写入正式状态";
    case "draft_save_reject":
      return "只生成左侧待保存改动，用户保存后才落盘，可拒绝";
    case "confirm_before_foundation_write":
      return "资料写入前必须给用户确认";
    case "confirm_before_formal_state_write":
      return "正式状态写入前必须给用户确认";
  }
}
