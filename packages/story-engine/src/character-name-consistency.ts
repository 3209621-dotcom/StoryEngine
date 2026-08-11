/**
 * 角色名一致性 —— 题材中立的「近形名漂移」确定性检测器。
 *
 * 背景（真机实锤）：写第 N 章时，模型把上一章已确立的角色名写歪了（例：妹妹「林宁」被写成「林棠」）。
 * 现有写稿后连续性校验只查「有没有引用旧角色/线索」，没有「本章用到的名字是不是把旧名写歪了」这一项，
 * 于是漂移静默通过，只能靠模型自己事后发现——这正是「当时没拦住、事后才发现」的根。
 *
 * 设计取向（延续 ChapterDelta：模型声明、引擎只做确定性校验）：
 * 引擎**不去正文里猜哪些词是人名**（那会把「林家」「林间」这类普通词误判成人名漂移）。
 * 而是接收一份「本章实际用到的角色名清单」（来自模型声明的人物名册 / 已登记角色），
 * 再和「本书已确立的角色名（含别名）」逐一做**纯字符串形近比对**：
 * 当某个已确立角色的所有正确称呼本章都没用到、却用到了一个形近变体时，判为疑似写歪。
 *
 * 纯字符串比对、无任何题材词表、不做语义猜测、不阻塞入库，只产出可供写前提示的告警。
 * 纯函数、无 LLM、无磁盘依赖（LLM 调用留在 UI server 层）。
 */

/** 一个已在本书确立身份的角色：规范名 + 别名（同一人的不同称呼）。 */
export interface EstablishedCharacter {
  /** 规范名（用于展示与告警）。 */
  readonly canonicalName: string;
  /** 别名/其它称呼（如小名、尊称）；与规范名同属一个身份，任一用到都算「正确名字在场」。 */
  readonly aliases?: readonly string[];
  /** 可选的稳定身份键（角色 id / 关系锚点）；仅透传到告警，便于上层归位。 */
  readonly identityKey?: string;
}

/** 一条疑似名字漂移。 */
export interface NameDriftFinding {
  /** 被写歪的那个已确立规范名。 */
  readonly establishedName: string;
  /** 本章用到的形近变体（疑似写错的名字）。 */
  readonly driftedVariant: string;
  /** 该已确立角色的稳定身份键（若提供）。 */
  readonly identityKey?: string;
}

export interface DetectNameDriftInput {
  /**
   * 本章实际用到的角色名清单（来自模型声明的人物名册；或已登记角色名的子集）。
   * 引擎只在这份**干净的候选名清单**上做比对，绝不扫描原文去猜人名。
   */
  readonly chapterNames: readonly string[];
  /** 本书已确立的角色（含别名）。 */
  readonly established: readonly EstablishedCharacter[];
  /**
   * 可选：本章草稿正文。给了就要求「形近变体」确实逐字出现在正文里才告警，
   * 过滤掉模型声明了却没真正写进正文的幽灵名。
   */
  readonly draft?: string;
  /** 最多返回多少条告警（避免刷屏）。默认 8。 */
  readonly maxFindings?: number;
}

const DEFAULT_MAX_FINDINGS = 8;

/** 归一化：压掉所有空白（空格/换行/制表符/全角空格）。 */
function stripWhitespace(text: string): string {
  return text.replace(/[\s\u3000]+/gu, "");
}

function normalizeName(name: string): string {
  return stripWhitespace(name ?? "");
}

const LATIN_ONLY = /^[A-Za-z]+$/u;

function isLatinName(name: string): boolean {
  return LATIN_ONLY.test(name);
}

/**
 * 两个 CJK 名字是否「形近到像把同一个名字写歪了」：
 * 长度相同（2–4 字，覆盖绝大多数中文人名）、首字相同（保住姓氏/领头字）、且仅有 1 个字不同，
 * 不同的位置不在首字（首字不同多半是另一个人，不算写歪）。
 */
function cjkLooksLikeDrift(variant: string, known: string): boolean {
  if (variant === known) return false;
  if (variant.length !== known.length) return false;
  if (variant.length < 2 || variant.length > 4) return false;
  if (variant[0] !== known[0]) return false;
  // 「老赵/老周」「小王/小李」「阿强/阿明」这类二字称呼共享的是通用前缀，
  // 第二字通常才是姓/名锚点；不同不能当作同一人写歪。
  if (variant.length === 2 && ["老", "小", "阿", "大"].includes(variant[0] ?? "")) return false;
  let diffCount = 0;
  for (let index = 1; index < known.length; index += 1) {
    if (variant[index] !== known[index]) diffCount += 1;
    if (diffCount > 1) return false;
  }
  return diffCount === 1;
}

/** Levenshtein 编辑距离（用于拉丁名的「差一个字母」判断）。 */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dist[i]![0] = i;
  for (let j = 0; j < cols; j += 1) dist[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i]![j] = Math.min(
        dist[i - 1]![j]! + 1,
        dist[i]![j - 1]! + 1,
        dist[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dist[rows - 1]![cols - 1]!;
}

/**
 * 两个拉丁名字是否形近（差一个字母）：不区分大小写、首字母相同、长度 ≥ 3、编辑距离恰为 1。
 * 覆盖 Aaron→Aron（漏字母）、Alan→Alen（换字母）这类跨题材通用写错。
 */
function latinLooksLikeDrift(variant: string, known: string): boolean {
  const v = variant.toLowerCase();
  const k = known.toLowerCase();
  if (v === k) return false;
  if (k.length < 3 && v.length < 3) return false;
  if (v[0] !== k[0]) return false;
  return editDistance(v, k) === 1;
}

function looksLikeDrift(variant: string, known: string): boolean {
  if (isLatinName(known) && isLatinName(variant)) return latinLooksLikeDrift(variant, known);
  if (!isLatinName(known) && !isLatinName(variant)) return cjkLooksLikeDrift(variant, known);
  return false;
}

/** 收集某身份的所有称呼（规范名 + 别名），去空白去重。 */
function surfaceFormsOf(character: EstablishedCharacter): string[] {
  const forms = [character.canonicalName, ...(character.aliases ?? [])]
    .map(normalizeName)
    .filter((form) => form.length > 0);
  return [...new Set(forms)];
}

/** 一个名字（归一后）用于「是否同名」比较的键：拉丁小写、其余原样。 */
function identityForm(name: string): string {
  return isLatinName(name) ? name.toLowerCase() : name;
}

/**
 * 题材中立的名字漂移检测：只在「某已确立角色的任何正确称呼本章都没用到、却用到了一个形近变体」时告警。
 * 「正确名字在场」直接跳过该角色——避免把新登场的同姓角色（如另有其人「林枫」）误判成写歪。
 * 只在传入的干净候选名清单上比对，绝不扫描原文去猜人名。
 */
export function detectNameDrift(input: DetectNameDriftInput): NameDriftFinding[] {
  const characters = input.established.filter((character) => normalizeName(character.canonicalName).length > 0);
  if (characters.length === 0) return [];

  const chapterNames = [...new Set(
    input.chapterNames.map(normalizeName).filter((name) => name.length > 0),
  )];
  if (chapterNames.length === 0) return [];

  // 所有身份的所有称呼（归一），用于「候选名本身是不是另一个已知合法名字」的排除。
  const knownForms = new Set<string>();
  for (const character of characters) {
    for (const form of surfaceFormsOf(character)) knownForms.add(identityForm(form));
  }

  const strippedDraft = input.draft !== undefined ? stripWhitespace(input.draft) : undefined;
  const draftContains = (name: string): boolean => {
    if (strippedDraft === undefined) return true;
    if (isLatinName(name)) {
      const tokens = (input.draft ?? "").match(/[A-Za-z]+/gu) ?? [];
      return tokens.some((token) => token.toLowerCase() === name.toLowerCase());
    }
    return strippedDraft.includes(name);
  };

  const findings: NameDriftFinding[] = [];
  const seen = new Set<string>();
  const maxFindings = input.maxFindings ?? DEFAULT_MAX_FINDINGS;

  for (const character of characters) {
    const forms = surfaceFormsOf(character);
    if (forms.length === 0) continue;
    // 正确名字（任一称呼）本章已用到 → 视为正确引用了该角色，不判漂移。
    const correctNameUsed = forms.some((form) => chapterNames.includes(form));
    if (correctNameUsed) continue;

    for (const candidate of chapterNames) {
      // 候选名本身是另一个已确立合法名 → 是别的角色，不算写歪。
      if (knownForms.has(identityForm(candidate))) continue;
      const isDrift = forms.some((form) => looksLikeDrift(candidate, form));
      if (!isDrift) continue;
      if (!draftContains(candidate)) continue;
      const key = `${character.canonicalName}\u0000${candidate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        establishedName: character.canonicalName,
        driftedVariant: candidate,
        ...(character.identityKey ? { identityKey: character.identityKey } : {}),
      });
      if (findings.length >= maxFindings) return findings;
    }
  }

  return findings;
}
