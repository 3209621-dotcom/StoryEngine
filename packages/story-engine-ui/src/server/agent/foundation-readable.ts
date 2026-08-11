/**
 * foundation-readable —— 把引擎资料结构（角色册 / 资产 / 地点等）转成「中文可复述」形态，
 * 供 read_foundation 喂给模型。
 *
 * 病根：引擎数据**值是中文**（用户写的「〈角色名〉/主角/男」），但**键是英文**
 * （role/identity/personalityBaseline/trustLevel…），少数字段连值也是英文枚举
 * （asset type:"item"、status:"available"、travel method:"walk"、trust/social 的 low/medium/high）。
 * read_foundation 原样把这份 JSON 喂模型 → 模型一复述就吐英文（「某角色的 role 是主角」），
 * 跟整套中文 UI 对不齐。这里在**读工具边界**把键换成中文标签、把已知英文枚举值换成中文、
 * 丢掉 id/version 这类内部噪音——模型只能复述它读到的东西，读到中文就说中文。
 *
 * 设计约束：
 * - 纯前端/服务端 UI 侧、引擎零改（只读引擎产出、不改其类型与序列化）。
 * - 题材中立：只翻字段名与机械枚举，绝不碰用户内容（值原样透传）。
 * - 只用于 read_foundation 喂模型的 data（前端不消费该字段）；不影响任何写盘或面板渲染。
 */

/** 英文字段名 → 中文标签（角色册 / 角色 state / core / 地点 / 资产 / 各嵌套对象的并集）。 */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  // 容器/包裹键
  characters: "角色",
  assets: "物品",
  containers: "容器",
  locations: "地点",
  // 通用
  id: "资料编号", // slug 值，但 agent 改名/删除要拿它当 targetId（rename/delete 无按名兜底），故保留、给个中文标签
  name: "名称",
  type: "类型",
  status: "状态",
  // 角色册
  role: "角色定位",
  age: "年龄",
  gender: "性别",
  identity: "身份",
  appearanceAnchors: "外貌特征",
  longTermDesire: "长期渴望",
  desire: "核心欲望",
  fear: "恐惧",
  weakness: "弱点",
  contradiction: "内在矛盾",
  moralBoundary: "道德底线",
  privateMotive: "隐秘动机",
  relationshipToProtagonist: "与主角关系",
  relationshipDynamics: "关系动态",
  trustLevel: "信任度",
  hiddenStance: "隐藏立场",
  speechRules: "说话规矩",
  speechStyle: "说话风格",
  speechSamples: "说话示例",
  personalityBaseline: "性格基线",
  socialEnergy: "社交能量",
  behaviorBoundaries: "行为边界",
  knowledgeKnown: "已知信息",
  knowledgeUnknown: "未知信息",
  cannotReveal: "不可透露",
  cannotDo: "不会做的事",
  arcPromise: "成长弧承诺",
  currentStateHint: "当前状态提示",
  // 角色 voice / arc 嵌套
  voice: "语感",
  style: "风格",
  rhythm: "节奏",
  avoidanceTopics: "回避话题",
  sampleLines: "示例台词",
  arc: "成长弧",
  startState: "起点状态",
  currentState: "当前状态",
  projectedDirection: "预期走向",
  // 角色 core 额外
  personality: "性格",
  taboos: "禁忌",
  worldview: "世界观",
  behaviorHabits: "行为习惯",
  // 角色运行时 state
  emotion: "情绪",
  goal: "目标",
  mood: "心情",
  currentGoal: "当前目标",
  recentEvents: "近期事件",
  relationshipToUser: "与主角关系",
  currentArc: "当前阶段",
  currentPhysicalState: "当前身体状态",
  currentMentalState: "当前心理状态",
  currentResourceState: "当前资源状态",
  currentLocationName: "当前位置",
  lastSeenChapter: "最近出场章",
  lastUpdatedChapter: "最近更新章",
  firstSeenChapter: "首次出场章",
  // 地点册
  parentLocation: "上级地点",
  locationType: "地点类型",
  spatialStructure: "空间结构",
  floors: "楼层",
  rooms: "房间",
  entrances: "入口",
  exits: "出口",
  sensoryDetails: "感官细节",
  visual: "视觉",
  sound: "声音",
  smell: "气味",
  touch: "触感",
  currentKnownPosition: "当前已知位置",
  knownFeatures: "已知特征",
  risks: "风险",
  resources: "资源",
  narrativeFunction: "叙事功能",
  possibleConflicts: "可能冲突",
  currentStatus: "当前状态",
  hiddenFacts: "隐藏事实",
  connectedLocations: "连通地点",
  travelRules: "通行规则",
  targetLocation: "目标地点",
  method: "方式",
  durationMinutes: "耗时（分钟）",
  constraint: "限制条件",
  from: "起点",
  secrets: "秘密",
  fixedFacts: "固定事实",
  lastKnownState: "最近已知状态",
  // 资产
  ownerName: "持有人",
  quantity: "数量",
  conditionNote: "状态备注",
  rules: "规则",
  usageRules: "使用规则",
  lossRules: "丢失规则",
  blockedReason: "受阻原因",
  notes: "备注",
  // 角色外貌嵌套对象（CharacterProfile.appearance；read_foundation 主走 bible 不含它，补上保稳健）
  appearance: "外貌",
  body: "体型",
  face: "脸",
  hair: "头发",
  clothing: "衣着",
  distinguishingFeatures: "显著特征",
  // 自定义
  extraFields: "自定义资料",
};

/**
 * 按字段的英文枚举值 → 中文。location 的 type 是中文自由值（如「室内」）→ 不在表里、自然原样透传。
 * ⚠️ 反向极小概率误伤：同一张 type/status 表同时服务 asset（英文枚举）与 location（中文自由值），
 * 若用户硬把某 location 的 type 写成字面英文枚举词（如 "container"）会被误翻成「容器」。
 * 用户几乎只写中文，故不为此把表按实体上下文拆开；记此风险，真撞上再治。
 */
const VALUE_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  trustLevel: { low: "低", medium: "中", high: "高" },
  socialEnergy: { low: "低", medium: "中", high: "高" },
  type: { item: "物品", vehicle: "载具", property: "房产", money: "钱款", document: "文件", container: "容器", keyItem: "关键物品", consumable: "消耗品" },
  status: { available: "可用", damaged: "受损", lost: "遗失", locked: "锁住", consumed: "已消耗", unknown: "未知" },
  method: { walk: "步行", taxi: "打车", bus: "公交", elevator: "电梯", stairs: "楼梯" },
};

/**
 * 内部/技术键：值是英文 slug（跨引用 id）、版本号、布尔标志——复述给用户是噪音，直接丢弃。
 * 注意：实体**自身的 `id`** 不在此列（rename/delete 要拿它当 targetId，已在 FIELD_LABELS 标成「资料编号」）；
 * 这里丢的都是指向**别的**实体的 id 引用（parentId / currentLocationId / locationId / ownerCharacterId…）。
 */
const DROP_KEYS: ReadonlySet<string> = new Set<string>([
  "characterId",
  "version",
  "parentId",
  "currentLocationId",
  "locationId",
  "ownerCharacterId",
  "carriedByCharacterId",
  "containerId",
  "containsAssetIds",
  "canAiModify",
  "isConsumable",
  "isPlotCritical",
  "requiresUserConfirm",
]);

/**
 * 递归把资料结构转成中文可复述形态：键换中文标签、已知英文枚举值换中文、丢内部键。
 * 用户内容（字段的中文值、extraFields 里用户自起的键）一律原样透传。
 * 入参 null/基础类型原样返回（不崩、不静默吞）。
 */
export function localizeFoundationForReading(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => localizeFoundationForReading(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_KEYS.has(key) || v === undefined || v === null) continue;
      const label = FIELD_LABELS[key] ?? key;
      const valueMap = VALUE_LABELS[key];
      if (valueMap && typeof v === "string") {
        out[label] = valueMap[v] ?? v; // 枚举值换中文，非枚举（含中文自由值）原样
      } else if (key === "extraFields") {
        out[label] = v; // 用户自定义字段：键是用户自起的（多为中文），整块原样保留
      } else {
        out[label] = localizeFoundationForReading(v);
      }
    }
    return out;
  }
  return value;
}

/** 资料完整度报告的就绪等级英文枚举 → 中文（供 read_foundation 的 summary）。 */
export function readinessLevelLabel(level: string): string {
  const map: Readonly<Record<string, string>> = { ready: "达标", warning: "有风险", high_risk: "高风险" };
  return map[level] ?? level;
}
