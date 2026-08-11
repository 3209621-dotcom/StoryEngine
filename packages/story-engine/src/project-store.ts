import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ArcGoalPool,
  AssetLedger,
  CharacterBible,
  CharacterMatrixLedger,
  FactLedger,
  CharacterCore,
  CharacterProfile,
  CharacterState,
  HookPool,
  LocationBible,
  TimelineEvent,
  StoryCalendar,
  StoryBible,
  StoryCore,
  StoryProject,
  ThreadPool,
  WorldBible,
  WorldCore,
  WorldState,
  WritingRules,
} from "./types.js";

export interface CreateStoryProjectInput {
  readonly rootDir: string;
  readonly title: string;
  readonly genre: string;
  readonly premise: string;
  readonly mainCharacterName: string;
}

export interface CreateStoryProjectResult {
  readonly projectDir: string;
  readonly project: StoryProject;
}

export async function createStoryProject(input: CreateStoryProjectInput): Promise<CreateStoryProjectResult> {
  const now = new Date().toISOString();
  const projectIdBase = toSafeId(input.title, "story");
  const projectId = await resolveUniqueProjectId(join(input.rootDir, "story-engine"), projectIdBase);
  const mainCharacterId = toSafeCharacterId(input.mainCharacterName);
  const projectDir = join(input.rootDir, "story-engine", projectId);

  try {
  await Promise.all([
    mkdir(join(projectDir, "characters", mainCharacterId), { recursive: true }),
    mkdir(join(projectDir, "world"), { recursive: true }),
    mkdir(join(projectDir, "story"), { recursive: true }),
    mkdir(join(projectDir, "timeline"), { recursive: true }),
    mkdir(join(projectDir, "time"), { recursive: true }),
    mkdir(join(projectDir, "drafts", "fast"), { recursive: true }),
    mkdir(join(projectDir, "chapters"), { recursive: true }),
  ]);

  const project: StoryProject = {
    id: projectId,
    title: input.title,
    createdAt: now,
    updatedAt: now,
  };
  const profile: CharacterProfile = {
    id: mainCharacterId,
    name: input.mainCharacterName,
    identity: "protagonist",
    appearance: {},
    tags: ["main-character"],
  };
  const core: CharacterCore = {
    characterId: mainCharacterId,
    personality: ["自主行动"],
    speechStyle: "自然",
    taboos: [],
  };
  const state: CharacterState = {
    characterId: mainCharacterId,
    emotion: "平静",
    goal: "进入故事开篇情境",
    relationshipToUser: "本人",
    currentArc: "开篇",
    lastUpdatedChapter: null,
  };
  const worldCore: WorldCore = {
    genre: input.genre,
    premise: input.premise,
    // 故事向法则留给作者/做厚填写；产品约束（如「正式事实只能通过确认提交更新」）不进本书设定。
    rules: [],
    mainConflict: "主角第一次遭遇与故事核心设定相关的明显阻力。",
  };
  const worldState: WorldState = {
    currentPhase: "开篇",
    activeConflicts: [],
    activeHooks: [],
    knownSecrets: [],
    lastUpdatedChapter: null,
  };
  const storyCore: StoryCore = {
    readerPromise: input.premise,
    tone: "沉浸",
    targetEmotion: "好奇",
    pacingStyle: "状态驱动的长篇连载推进",
  };
  const storyBible = createDefaultStoryBible(input);
  const writingRules = createDefaultWritingRules();
  const characterBible = createDefaultCharacterBible(profile);
  const characterMatrix = createDefaultCharacterMatrix();
  const worldBible = createDefaultWorldBible(worldCore);
  const locationBible = createDefaultLocationBible();
  const assetLedger = createDefaultAssetLedger();
  const hooks: HookPool = {
    hooks: [],
  };
  const threads: ThreadPool = {
    threads: [],
  };
  const arcGoals: ArcGoalPool = {
    goals: [],
  };
  const calendar: StoryCalendar = {
    currentStoryDay: 1,
    currentTimeOfDay: "unknown",
  };
  const timelineEvents: TimelineEvent[] = [];

  await Promise.all([
    writeJson(join(projectDir, "project.json"), project),
    writeJson(join(projectDir, "world", "core.json"), worldCore),
    writeJson(join(projectDir, "world", "state.json"), worldState),
    writeJson(join(projectDir, "story", "core.json"), storyCore),
    writeJson(join(projectDir, "story", "bible.json"), storyBible),
    writeJson(join(projectDir, "story", "writing-rules.json"), writingRules),
    writeJson(join(projectDir, "story", "character-bible.json"), characterBible),
    writeJson(join(projectDir, "story", "character-matrix.json"), characterMatrix),
    writeJson(join(projectDir, "story", "world-bible.json"), worldBible),
    writeJson(join(projectDir, "story", "location-bible.json"), locationBible),
    writeJson(join(projectDir, "story", "assets.json"), assetLedger),
    writeJson(join(projectDir, "story", "hooks.json"), hooks),
    writeJson(join(projectDir, "story", "threads.json"), threads),
    writeJson(join(projectDir, "story", "arc-goals.json"), arcGoals),
    writeJson(join(projectDir, "timeline", "events.json"), timelineEvents),
    writeJson(join(projectDir, "time", "calendar.json"), calendar),
    writeJson(join(projectDir, "characters", mainCharacterId, "profile.json"), profile),
    writeJson(join(projectDir, "characters", mainCharacterId, "core.json"), core),
    writeJson(join(projectDir, "characters", mainCharacterId, "state.json"), state),
  ]);

  return { projectDir, project };
  } catch (error) {
    await rm(projectDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readProject(projectDir: string): Promise<StoryProject> {
  return readJson<StoryProject>(join(projectDir, "project.json"));
}

export async function readWorldCore(projectDir: string): Promise<WorldCore> {
  return readJson<WorldCore>(join(projectDir, "world", "core.json"));
}

export async function readWorldState(projectDir: string): Promise<WorldState> {
  return readJson<WorldState>(join(projectDir, "world", "state.json"));
}

export async function readStoryCore(projectDir: string): Promise<StoryCore> {
  return readJson<StoryCore>(join(projectDir, "story", "core.json"));
}

export async function readStoryBible(projectDir: string): Promise<StoryBible | null> {
  return readOptionalJson<StoryBible>(join(projectDir, "story", "bible.json"));
}

export async function readWritingRules(projectDir: string): Promise<WritingRules | null> {
  return readOptionalJson<WritingRules>(join(projectDir, "story", "writing-rules.json"));
}

export async function readCharacterBible(projectDir: string): Promise<CharacterBible | null> {
  return readOptionalJson<CharacterBible>(join(projectDir, "story", "character-bible.json"));
}

export async function readFactLedger(projectDir: string): Promise<FactLedger | null> {
  return readOptionalJson<FactLedger>(join(projectDir, "story", "fact-ledger.json"));
}

export async function readCharacterMatrixLedger(projectDir: string): Promise<CharacterMatrixLedger> {
  return readJson<CharacterMatrixLedger>(join(projectDir, "story", "character-matrix.json")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return createDefaultCharacterMatrix();
    throw error;
  });
}

export async function readWorldBible(projectDir: string): Promise<WorldBible | null> {
  return readOptionalJson<WorldBible>(join(projectDir, "story", "world-bible.json"));
}

export async function readLocationBible(projectDir: string): Promise<LocationBible | null> {
  return readOptionalJson<LocationBible>(join(projectDir, "story", "location-bible.json"));
}

export async function readAssetLedger(projectDir: string): Promise<AssetLedger> {
  return readJson<AssetLedger>(join(projectDir, "story", "assets.json")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return createDefaultAssetLedger();
    throw error;
  });
}

export async function readHookPool(projectDir: string): Promise<HookPool> {
  return readJson<HookPool>(join(projectDir, "story", "hooks.json"));
}

export async function readThreadPool(projectDir: string): Promise<ThreadPool> {
  return readJson<ThreadPool>(join(projectDir, "story", "threads.json")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return { threads: [] };
    throw error;
  });
}

export async function readArcGoalPool(projectDir: string): Promise<ArcGoalPool> {
  return readJson<ArcGoalPool>(join(projectDir, "story", "arc-goals.json")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return { goals: [] };
    throw error;
  });
}

export async function readStoryCalendar(projectDir: string): Promise<StoryCalendar> {
  return readJson<StoryCalendar>(join(projectDir, "time", "calendar.json"));
}

export async function readTimelineEvents(projectDir: string): Promise<readonly TimelineEvent[]> {
  return readJson<TimelineEvent[]>(join(projectDir, "timeline", "events.json"));
}

export async function readCharacterProfile(projectDir: string, characterId: string): Promise<CharacterProfile> {
  return readJson<CharacterProfile>(join(projectDir, "characters", toSafeCharacterId(characterId), "profile.json"));
}

export async function readCharacterCore(projectDir: string, characterId: string): Promise<CharacterCore> {
  return readJson<CharacterCore>(join(projectDir, "characters", toSafeCharacterId(characterId), "core.json"));
}

export async function readCharacterState(projectDir: string, characterId: string): Promise<CharacterState> {
  return readJson<CharacterState>(join(projectDir, "characters", toSafeCharacterId(characterId), "state.json"));
}

export function toSafeCharacterId(value: string): string {
  return toSafeId(value, "char");
}

/**
 * 哨兵词 id：模型/退化输入常把 id 给成 "none"/"null"/"undefined" 等占位词（真书里真有角色 id 字面量="none"）。
 * 这些是危险 id——与代码里到处的哨兵值（confirmation:"none" 等）有碰撞隐患、且不同实体撞同一个 → 误合并。
 * 当 id 归一后命中哨兵词，视同「没给 id」，由调用方回落到 name（有意义、不同实体不碰撞）或 hash。
 */
// 只收「明确是占位词、几乎不可能是真名罗马音」的：na/nan/nil 是真实姓名罗马音（如「娜」），剔除以免误伤。
const SENTINEL_SAFE_IDS = new Set(["none", "null", "undefined", "n-a", "unknown", "tbd", "todo"]);

/**
 * id 是否为哨兵占位词（缺省/空白，或归一后命中哨兵集如 none/null/undefined）。题材中立、纯确定性。
 * 注意：只认「哨兵词」——CJK 名字归一后为空不算哨兵（它是有效名、只是非 Latin），由 toSafeId 自己走 hash。
 */
export function isSentinelEntityId(value: string | undefined): boolean {
  if (!value || value.trim() === "") return true;
  return SENTINEL_SAFE_IDS.has(normalizeToSafeIdCore(value));
}

function normalizeToSafeIdCore(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['’]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");
}

// ⚠️ toSafeId 必须向后兼容：它既用于「生成新 id」也用于「归一已有 id 去读文件」（readCharacterProfile
// 等内部对已存 id 再调一次）。绝不能在这里做哨兵→hash 改写——否则旧书里 id/目录恰为 "none" 的角色
// 会被算成 char-<hash> 读不到文件而崩（2026-06-26 真机回归实锤）。哨兵兜底只在「生成侧」做（见
// foundation-write-gateway 的 rawId 解析用 isSentinelEntityId 跳过哨兵 id 回落 name）。
function toSafeId(value: string, fallback: string): string {
  const safe = normalizeToSafeIdCore(value);
  return safe || `${fallback}-${shortHash(value)}`;
}

async function resolveUniqueProjectId(rootDir: string, baseId: string): Promise<string> {
  let candidate = baseId;
  let suffix = 2;
  while (await pathExists(join(rootDir, candidate))) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 6);
}

function createDefaultStoryBible(input: CreateStoryProjectInput): StoryBible {
  return {
    version: "v0",
    projectLogline: input.premise,
    premise: input.premise,
    genre: input.genre,
    subgenres: [],
    readerPromise: input.premise,
    longFormGoals: [],
    centralConflicts: [],
    coreMysteries: [],
    forbiddenChanges: [],
    canonFacts: [],
    openQuestions: [],
  };
}

function createDefaultWritingRules(): WritingRules {
  return {
    version: "v0",
    narrativePerspective: "第三人称有限视角",
    proseStyle: ["沉浸", "状态感知"],
    chapterLength: {
      targetWords: 1800,
    },
    pacing: "中等",
    revealPolicy: "均衡",
    genreRequirements: [],
    suspenseRules: [],
    payoffRules: [],
    reversalRules: [],
    readerExperienceRules: [],
    forbiddenContent: [],
    doNotDo: [
      "草稿阶段不要改写正式状态。",
      "没有正文证据时不要解决长期伏笔。",
    ],
  };
}

function createDefaultCharacterBible(profile: CharacterProfile): CharacterBible {
  return {
    version: "v0",
    characters: [
      {
        id: profile.id,
        name: profile.name,
        role: profile.identity === "protagonist" ? "主角" : profile.identity ?? "主角",
        desire: "进入开篇情境并面对核心变化",
        speechRules: [],
        behaviorBoundaries: [],
      },
    ],
  };
}

function createDefaultCharacterMatrix(): CharacterMatrixLedger {
  return {
    version: "v0",
    entries: [],
  };
}

function createDefaultWorldBible(worldCore: WorldCore): WorldBible {
  return {
    version: "v0",
    rules: worldCore.rules,
    factions: [],
    powerOrSurvivalSystems: [],
    historyFacts: [],
    socialOrder: [],
  };
}

function createDefaultLocationBible(): LocationBible {
  return {
    version: "v0",
    locations: [],
  };
}

function createDefaultAssetLedger(): AssetLedger {
  return {
    version: "v0",
    assets: [],
    containers: [],
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(tmpPath, filePath);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf-8")) as T;
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  return readJson<T>(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}
