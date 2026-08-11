/**
 * r3-lib.mjs —— R3「真书端到端验证」共享工具（无 GLM、纯本地 I/O + 文本扫描）。
 *
 * 导出：
 *   seedFoundationR3(targetProjectDir)          种子：从 276c72 真林远资料拷入 story/* + 补 bible 空壳
 *   writeCheckpoint(runDir, label, obj)          落 checkpoint/章完成标记 JSON
 *   readResumeState(runDir)                      扫 chapter-NN.done.json → { lastCommittedChapter }
 *   scanDraft(text, context)                     正文漂移扫描（年龄/楼层/资产/secret 泄露）
 *   classifyRegressionSignals(driftScan, preview, context)  漂移信号分类
 *   buildRegisteredContext(projectDir)           从种子资料构造 scanDraft 用的「已登记上下文」
 *
 * scanDraft/classifyRegressionSignals 从 scripts/longform-regression-smoke.mjs 抽出复用（逐字保形）。
 * 本文件不 import 任何 `.ts`（纯 node 内置 + 文件 I/O），可直接 node 自检导出名。
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 276c72 真林远资料源（只读，不改）。 */
const SEED_SOURCE_DIR = join(homedir(), "StoryEngine-NG", "story-engine", "story-276c72", "story");

// ---------------------------------------------------------------------------
// 种子（seedFoundationR3）
// ---------------------------------------------------------------------------

async function readSourceJson(relName) {
  return JSON.parse(await readFile(join(SEED_SOURCE_DIR, relName), "utf-8"));
}

async function writeJson(targetProjectDir, relativePath, value) {
  const full = join(targetProjectDir, relativePath);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

/**
 * 把 276c72 的真林远世界观/角色/地点/写作规则拷进目标书 story/，并补 bible.json 空壳
 * （longFormGoals/centralConflicts/firstChapterSetup），让 envelope 的 chapterTask/conflictSources
 * 拿到真实信号（关键事实 6：276c72 的 bible 是默认空壳）。
 */
export async function seedFoundationR3(targetProjectDir) {
  if (!existsSync(SEED_SOURCE_DIR)) {
    throw new Error(`R3 种子源不存在：${SEED_SOURCE_DIR}（需要 276c72 真林远资料）`);
  }

  // (a) 直接拷贝的真资料文件（结构与引擎读取一致，原样写入 story/）。
  const [worldBible, characterBible, locationBible, writingRules, srcCore] = await Promise.all([
    readSourceJson("world-bible.json"),
    readSourceJson("character-bible.json"),
    readSourceJson("location-bible.json"),
    readSourceJson("writing-rules.json"),
    readSourceJson("core.json"),
  ]);

  const protagonist = characterBible.characters?.[0] ?? {};
  const protagonistId = protagonist.id ?? "char-ffe5af";
  const protagonistName = protagonist.name ?? "林远";

  // (b) bible.json：276c72 是空壳 → 补 longFormGoals/centralConflicts/firstChapterSetup（照 smoke 的 bible 段形态，主角林远/千亿富豪意外揭示）。
  const bible = {
    version: "v0",
    projectLogline:
      "穷了 24 年的大学毕业生林远，毕业当天被父母摊牌——家里其实是千亿富豪，账上十亿现金，父母随即出国 4-5 年准备公司上市。",
    premise:
      "现代都市真实世界，无系统无金手指；核心看点是穷小子暴富后的真实反差体验与消费观念落差。",
    genre: "都市爽文 / 暴富反差",
    subgenres: ["都市", "纯享型爽文"],
    readerPromise: "看一个节俭惯了的普通人，如何在十亿存款与穷人惯性之间，靠自己闯出一番天地。",
    longFormGoals: [
      "林远留在国内沿海城市明海发展，用自己的方式（而非父母资源）闯出一番天地。",
      "在暴富的落差中校准消费观与身份认同，不被人当成纨绔富二代。",
    ],
    centralConflicts: [
      "穷了 24 年突然有十亿，消费观念完全跟不上存款余额。",
      "想靠自己、不依赖父母，与唾手可得的千亿家底之间的张力。",
    ],
    coreMysteries: ["父母公司的具体业务和规模", "家里的产业细节"],
    forbiddenChanges: [
      "不要让林远一夜之间变成挥金如土的纨绔。",
      "不要凭空出现系统/金手指/超自然。",
      "正式事实只能通过确认提交更新。",
    ],
    canonFacts: [
      "林远 24 岁，大学刚毕业。",
      "林远家庭实为千亿富豪，父母因公司准备上市出国 4-5 年。",
      "林远银行卡里有 10 亿现金。",
    ],
    openQuestions: [],
    protectedSecrets: [],
    setupAssets: {
      initialAssets: ["银行卡（10 亿现金）"],
      keyItems: ["银行卡（10 亿现金）"],
      resourceLimits: ["穷惯了的节约本能，消费观念跟不上余额"],
    },
    firstChapterSetup: {
      goal: "毕业当天，林远被父母摊牌家里是千亿富豪、账上十亿，父母随即出国。",
      openingScene: "明海（对标上海的沿海一线城市），林远毕业当天",
      hook: "穷了 24 年，突然多出十亿与千亿家底，消费观念完全跟不上。",
      conflict: "想靠自己闯，却被千亿家底与暴富落差冲击。",
    },
  };

  // (c) world/core.json、character core/state、profile —— 与 createStoryProject 既有目录结构对齐，
  //     用真资料覆写，保证 buildStateOverview 读到林远而非默认占位。
  const worldCore = {
    genre: bible.genre,
    premise: bible.premise,
    rules: worldBible.rules ?? [],
    mainConflict: bible.centralConflicts[0] ?? "",
  };
  const worldState = {
    currentPhase: "开篇",
    activeConflicts: bible.centralConflicts,
    activeHooks: [bible.firstChapterSetup.hook],
    knownSecrets: [],
    hiddenTruths: worldBible.hiddenFacts ?? [],
  };

  await Promise.all([
    writeJson(targetProjectDir, "story/bible.json", bible),
    writeJson(targetProjectDir, "story/world-bible.json", worldBible),
    writeJson(targetProjectDir, "story/character-bible.json", characterBible),
    writeJson(targetProjectDir, "story/location-bible.json", locationBible),
    writeJson(targetProjectDir, "story/writing-rules.json", writingRules),
    writeJson(targetProjectDir, "story/core.json", {
      ...srcCore,
      projectLogline: bible.projectLogline,
      premise: bible.premise,
      genre: bible.genre,
    }),
    writeJson(targetProjectDir, "world/core.json", worldCore),
    writeJson(targetProjectDir, "world/state.json", worldState),
    writeJson(targetProjectDir, `characters/${protagonistId}/profile.json`, {
      id: protagonistId,
      name: protagonistName,
      identity: protagonist.identity ?? "",
      age: protagonist.age ?? "",
      gender: protagonist.gender ?? "",
      appearance: {},
    }),
    writeJson(targetProjectDir, `characters/${protagonistId}/core.json`, {
      characterId: protagonistId,
      personality: protagonist.personalityBaseline ?? [],
      speechStyle: protagonist.speechStyle ?? "",
      taboos: protagonist.cannotDo ?? [],
    }),
    writeJson(targetProjectDir, `characters/${protagonistId}/state.json`, {
      characterId: protagonistId,
      emotion: "兴奋又有点不真实感",
      goal: protagonist.desire ?? "",
      currentLocation: locationBible.locations?.[0]?.name ?? "明海",
      currentPhysicalState: "毕业当天，状态正常",
      currentMentalState: "兴奋、不真实感、对钱仍有节约本能",
      currentResourceState: "账上十亿现金，但消费观念跟不上",
    }),
  ]);

  return { protagonistId, protagonistName };
}

/**
 * 从种子资料构造 scanDraft 用的「已登记上下文」（地点/资产/受保护机密名单）。
 * 与 longform-regression-smoke.mjs:buildRegisteredContext 同构，但数据来自真林远种子（题材中立、读盘得到）。
 */
export async function buildRegisteredContext(projectDir) {
  const read = async (rel) => {
    try {
      return JSON.parse(await readFile(join(projectDir, rel), "utf-8"));
    } catch {
      return null;
    }
  };
  const [locationBible, worldBible, bible] = await Promise.all([
    read("story/location-bible.json"),
    read("story/world-bible.json"),
    read("story/bible.json"),
  ]);
  const locations = (locationBible?.locations ?? []).map((l) => l.name).filter(Boolean);
  const setupAssets = bible?.setupAssets ?? {};
  const assets = [
    ...(setupAssets.initialAssets ?? []),
    ...(setupAssets.keyItems ?? []),
  ];
  return {
    floors: [],
    unregisteredFloorPatterns: [/4楼|四楼|四层楼/u, /5楼|五楼|五层楼/u, /六楼|6楼|六层楼/u],
    locations,
    travelTargets: locations,
    assets: [...new Set(assets)],
    protectedSecrets: [
      ...(worldBible?.protectedSecrets ?? []),
      ...(worldBible?.hiddenFacts ?? []),
      ...(bible?.protectedSecrets ?? []),
    ],
  };
}

// ---------------------------------------------------------------------------
// checkpoint / 断点续跑
// ---------------------------------------------------------------------------

/** 落一份 JSON 到 runDir/<label>.json（checkpoint 或 chapter-NN.done 标记）。 */
export async function writeCheckpoint(runDir, label, obj) {
  await mkdir(runDir, { recursive: true });
  const path = join(runDir, `${label}.json`);
  await writeFile(path, `${JSON.stringify(obj, null, 2)}\n`, "utf-8");
  return path;
}

/**
 * 扫 runDir 下已存在的 chapter-NN.done.json，返回 { lastCommittedChapter }（无则 0）。
 * 主驱动脚本据此从 lastCommittedChapter+1 续跑。
 */
export async function readResumeState(runDir) {
  let names = [];
  try {
    names = await readdir(runDir);
  } catch {
    return { lastCommittedChapter: 0 };
  }
  const chapters = names
    .map((n) => /^chapter-(\d+)\.done\.json$/u.exec(n))
    .filter(Boolean)
    .map((m) => Number.parseInt(m[1], 10))
    .filter((n) => Number.isFinite(n));
  return { lastCommittedChapter: chapters.length > 0 ? Math.max(...chapters) : 0 };
}

// ---------------------------------------------------------------------------
// 漂移扫描（从 longform-regression-smoke.mjs:441 / :471 抽出复用，逐字保形）
// ---------------------------------------------------------------------------

function stripMarkdown(text) {
  return String(text ?? "").replace(/^#{1,6} .+$/gmu, "").trim();
}

function splitSentences(body) {
  return body
    .replace(/\r\n/g, "\n")
    .split(/(?<=[。！？!?；;])|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function matchingSentence(body, pattern) {
  return splitSentences(body).find((sentence) => pattern.test(sentence));
}

export function scanDraft(text, context) {
  const body = stripMarkdown(text);
  const ageMentions = [...body.matchAll(/(\d{1,3})岁/g)].map((match) => match[1]);
  const unregisteredFloors = context.unregisteredFloorPatterns
    .map((pattern) => matchingSentence(body, pattern))
    .filter(Boolean);
  const assetSignals = [
    ["money", /(?:\d+(?:\.\d+)?元|\d+(?:\.\d+)?块钱?|[一二三四五六七八九十百千万]+块[一二三四五六七八九十]?毛|现金|钱包|余额)/u],
    ["food_or_water", /压缩饼干|矿泉水|午餐肉|罐头|食物|饮用水/u],
    ["phone_online", /欠费手机.{0,24}(?:联网|上网|连上|刷新|通话|打电话)|(?:手机).{0,24}(?:联网|上网|连上|刷新|通话|打电话)/u],
    ["vehicle_or_taxi", /(?:开车|骑上|骑着|开着|发动|拿出车钥匙|坐上出租|上了出租|打车去|叫了车|拦了车|打了一辆|网约车)/u],
  ]
    .map(([type, pattern]) => ({ type, evidence: matchingSentence(body, pattern) }))
    .filter((item) => item.evidence);
  const locationSignals = (context.locationSignalNames ?? ["便利店", "老邮局", "公共电话", "药店", "地下车库"])
    .map((name) => ({ name, evidence: matchingSentence(body, new RegExp(name, "u")) }))
    .filter((item) => item.evidence)
    .filter((item) => !context.locations.some((known) => known.includes(item.name) || item.name.includes(known)));
  return {
    registeredFloorsMentioned: context.floors.filter((floor) => body.includes(floor)),
    unregisteredFloors,
    registeredTravelTargetsMentioned: context.travelTargets.filter((location) => body.includes(location)),
    assetSignals,
    locationSignals,
    hiddenTruthLeak: context.protectedSecrets.filter((term) => term && body.includes(term)),
    ageMentions,
    ageDrift: ageMentions.some((age) => age !== "24"),
    genericCharacterStatePollution: /engaged|use the new advantage|unknown advantage|active protagonist/iu.test(body),
  };
}

function flattenCandidateNames(group) {
  if (!group) return [];
  return Object.values(group)
    .flat()
    .filter(Boolean)
    .flatMap((candidate) => [candidate.name, candidate.evidence].filter(Boolean));
}

function candidateMatchesSignal(candidates, signal) {
  return candidates.some((candidate) => {
    if (signal.type === "money") return /现金|余额|钱|元|块|毛/u.test(candidate);
    if (signal.type === "food_or_water") return /压缩饼干|矿泉水|午餐肉|罐头|食物|饮用水/u.test(candidate);
    if (signal.type === "phone_online") return /手机|联网/u.test(candidate);
    if (signal.type === "vehicle_or_taxi") return /交通工具|打车|出租|车辆|车/u.test(candidate);
    return false;
  });
}

function candidateMatchesName(candidates, name) {
  return candidates.some((candidate) => candidate.includes(name));
}

export function classifyRegressionSignals(driftScan, commitPreview, context) {
  const spatialWarnings = [
    ...(commitPreview?.locationChanges?.spatialViolationWarnings ?? []),
    ...(commitPreview?.quality?.issues ?? []),
  ];
  const previewAssetNames = flattenCandidateNames(commitPreview?.assetChanges);
  const previewLocationNames = flattenCandidateNames(commitPreview?.locationChanges);
  const detectedAssetSignals = driftScan.assetSignals.filter((signal) => candidateMatchesSignal(previewAssetNames, signal));
  const uncontrolledAssetSignals = driftScan.assetSignals.filter((signal) => !candidateMatchesSignal(previewAssetNames, signal));
  const detectedLocationSignals = driftScan.locationSignals.filter((signal) => candidateMatchesName(previewLocationNames, signal.name));
  const uncontrolledLocationSignals = driftScan.locationSignals.filter(
    (signal) => !candidateMatchesName(previewLocationNames, signal.name) && !context.locations.includes(signal.name),
  );
  return {
    uncontrolledFloorDrift: driftScan.unregisteredFloors.length > 0 && spatialWarnings.length === 0,
    detectedSpatialWarning: spatialWarnings.length > 0,
    detectedAssetCandidate: detectedAssetSignals.length > 0,
    uncontrolledAssetDrift: uncontrolledAssetSignals.length > 0,
    detectedLocationCandidate: detectedLocationSignals.length > 0,
    uncontrolledLocationDrift: uncontrolledLocationSignals.length > 0,
    hiddenTruthLeak: driftScan.hiddenTruthLeak.length > 0,
    ageDrift: driftScan.ageDrift,
    detectedAssetSignals,
    uncontrolledAssetSignals,
    detectedLocationSignals,
    uncontrolledLocationSignals,
  };
}
