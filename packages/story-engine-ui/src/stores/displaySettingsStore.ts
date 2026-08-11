import { create } from "zustand";

/**
 * displaySettingsStore — 三处字号偏好的唯一来源（聊天 / 界面 / 正文）。
 *
 * 原本三个字号散在各组件本地 useState（WritingWorkspaceCodex 的 chatZoom/readZoom、
 * WritingDeskCodex 的 paperFontSize），设置面板（在 App 层）够不着。上提到这里后，
 * 工作区与设置面板都从同一份状态读写，调一处全局生效。
 *
 *  - chatZoom：右侧 AI 对话区 zoom 倍率（.ai-body）。
 *  - uiZoom：界面字号 = 左侧两栏（书架 .rail + 资料类目 .catrail）+ 资料中心 .read 一起缩放
 *    （原 readZoom，只缩 .read；改名 uiZoom 扩到左栏，语义=界面字号）。
 *  - deskFontSize：正文稿纸字号（px，传给 WritingPaper）。
 *
 * 初始值从 localStorage 读（读不到/越界用默认），每次变更写回 localStorage。
 */

// zoom 倍率上下限（聊天 / 界面共用一档刻度）。
export const ZOOM_MIN = 0.9;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 0.1;

// 正文 px 上下限。
export const DESK_FONT_MIN = 12;
export const DESK_FONT_MAX = 32;
export const DESK_FONT_STEP = 1;

const DEFAULTS = {
  chatZoom: 1.1,
  uiZoom: 1.05,
  deskFontSize: 18,
  rewriteZoom: 1, // 选区改写预览框内字号倍率（框头 A−/A+ 调，1=舒适基准）。
  focusWriting: false, // 专注写作：收起章节栏 + AI 栏（P1-8）。
} as const;

const STORAGE_KEYS = {
  chatZoom: "codex.chatZoom",
  uiZoom: "codex.uiZoom",
  deskFontSize: "codex.deskFontSize",
  rewriteZoom: "codex.rewriteZoom",
  focusWriting: "codex.focusWriting",
} as const;

export type ZoomKey = "chatZoom" | "uiZoom" | "rewriteZoom";
export type DisplaySettingKey = "chatZoom" | "uiZoom" | "deskFontSize" | "rewriteZoom";

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
}

function clampDeskFontSize(value: number): number {
  return Math.min(DESK_FONT_MAX, Math.max(DESK_FONT_MIN, Math.round(value)));
}

function readStoredZoom(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = Number(window.localStorage.getItem(key));
    if (Number.isFinite(saved) && saved >= ZOOM_MIN && saved <= ZOOM_MAX) return saved;
  } catch { /* 隐私模式/无 localStorage：用默认 */ }
  return fallback;
}

function readStoredDeskFontSize(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = Number(window.localStorage.getItem(key));
    if (Number.isFinite(saved) && saved >= DESK_FONT_MIN && saved <= DESK_FONT_MAX) return saved;
  } catch { /* 用默认 */ }
  return fallback;
}

function readStoredBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = window.localStorage.getItem(key);
    if (saved === "1" || saved === "true") return true;
    if (saved === "0" || saved === "false") return false;
  } catch { /* 用默认 */ }
  return fallback;
}

function persist(key: string, value: number | boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  } catch { /* 忽略 */ }
}

export interface DisplaySettingsStore {
  readonly chatZoom: number;
  readonly uiZoom: number;
  readonly deskFontSize: number;
  readonly rewriteZoom: number;
  /** 专注写作：一键收起章节栏 + AI 栏（记住上次状态）。 */
  readonly focusWriting: boolean;
  /** 设某一项字号到指定值（自动夹到合法区间并落盘）。 */
  readonly setDisplaySetting: (key: DisplaySettingKey, value: number) => void;
  /** 在当前值上增减（zoom 用 ±0.1、正文用 ±1，调用方传 delta）。 */
  readonly adjustDisplaySetting: (key: DisplaySettingKey, delta: number) => void;
  /** 开关专注写作并落盘。 */
  readonly setFocusWriting: (value: boolean) => void;
  /** 切换专注写作。 */
  readonly toggleFocusWriting: () => void;
  /** 全部恢复默认（并落盘）。 */
  readonly resetDisplaySettings: () => void;
  /** 单项恢复默认。 */
  readonly resetDisplaySetting: (key: DisplaySettingKey) => void;
}

function clampFor(key: DisplaySettingKey, value: number): number {
  return key === "deskFontSize" ? clampDeskFontSize(value) : clampZoom(value);
}

export const useDisplaySettingsStore = create<DisplaySettingsStore>((set, get) => ({
  chatZoom: readStoredZoom(STORAGE_KEYS.chatZoom, DEFAULTS.chatZoom),
  uiZoom: readStoredZoom(STORAGE_KEYS.uiZoom, DEFAULTS.uiZoom),
  deskFontSize: readStoredDeskFontSize(STORAGE_KEYS.deskFontSize, DEFAULTS.deskFontSize),
  rewriteZoom: readStoredZoom(STORAGE_KEYS.rewriteZoom, DEFAULTS.rewriteZoom),
  focusWriting: readStoredBool(STORAGE_KEYS.focusWriting, DEFAULTS.focusWriting),

  setDisplaySetting: (key, value) => {
    const next = clampFor(key, value);
    persist(STORAGE_KEYS[key], next);
    set({ [key]: next } as Partial<DisplaySettingsStore>);
  },

  adjustDisplaySetting: (key, delta) => {
    get().setDisplaySetting(key, get()[key] + delta);
  },

  setFocusWriting: (value) => {
    persist(STORAGE_KEYS.focusWriting, value);
    set({ focusWriting: value });
  },

  toggleFocusWriting: () => {
    get().setFocusWriting(!get().focusWriting);
  },

  resetDisplaySettings: () => {
    persist(STORAGE_KEYS.chatZoom, DEFAULTS.chatZoom);
    persist(STORAGE_KEYS.uiZoom, DEFAULTS.uiZoom);
    persist(STORAGE_KEYS.deskFontSize, DEFAULTS.deskFontSize);
    persist(STORAGE_KEYS.rewriteZoom, DEFAULTS.rewriteZoom);
    persist(STORAGE_KEYS.focusWriting, DEFAULTS.focusWriting);
    set({ ...DEFAULTS });
  },

  resetDisplaySetting: (key) => {
    get().setDisplaySetting(key, DEFAULTS[key]);
  },
}));

export { DEFAULTS as DISPLAY_SETTINGS_DEFAULTS };
