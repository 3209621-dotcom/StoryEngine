import { create } from "zustand";

/** 中间区视图：资料中心 / 写作台 / 操作历史。 */
export type CenterView = "library" | "desk" | "history";

export interface NavigationStore {
  readonly workspaceReady: boolean;
  readonly projectPath: string | null;
  readonly activeBookId: string | null;
  readonly openProjectError: string | null;
  readonly openProjectLoading: boolean;
  readonly settingsOpen: boolean;
  readonly usageOpen: boolean;
  readonly usageLoading: boolean;
  readonly usageError: string | null;
  readonly usageSummary: import("../api/types.js").UsageSummary | null;
  readonly toast: string | null;
  /** 一次性「请切到中间区某视图」信号：出稿/续写时置 "desk"，WritingWorkspaceCodex 消费后清空。 */
  readonly pendingCenterView: CenterView | null;

  readonly setWorkspaceReady: (value: boolean) => void;
  readonly setProjectPath: (path: string | null) => void;
  readonly setActiveBookId: (id: string | null) => void;
  readonly setOpenProjectError: (error: string | null) => void;
  readonly setOpenProjectLoading: (loading: boolean) => void;
  readonly openSettings: () => void;
  readonly closeSettings: () => void;
  readonly openUsage: () => void;
  readonly closeUsage: () => void;
  readonly setUsageLoading: (loading: boolean) => void;
  readonly setUsageError: (error: string | null) => void;
  readonly setUsageSummary: (summary: import("../api/types.js").UsageSummary | null) => void;
  readonly showToast: (message: string, duration?: number) => void;
  readonly clearToast: () => void;
  /** 请求中间区切到某视图（出稿/续写时调，置 "desk"）。 */
  readonly requestCenterView: (view: CenterView) => void;
  /** 消费完跳转信号后清空（WritingWorkspaceCodex 调）。 */
  readonly clearPendingCenterView: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useNavigationStore = create<NavigationStore>((set) => ({
  workspaceReady: false,
  projectPath: null,
  activeBookId: null,
  openProjectError: null,
  openProjectLoading: false,
  settingsOpen: false,
  usageOpen: false,
  usageLoading: false,
  usageError: null,
  usageSummary: null,
  toast: null,
  pendingCenterView: null,

  setWorkspaceReady: (value) => set({ workspaceReady: value }),
  requestCenterView: (view) => set({ pendingCenterView: view }),
  clearPendingCenterView: () => set({ pendingCenterView: null }),
  setProjectPath: (path) => set({ projectPath: path }),
  setActiveBookId: (id) => set({ activeBookId: id }),
  setOpenProjectError: (error) => set({ openProjectError: error }),
  setOpenProjectLoading: (loading) => set({ openProjectLoading: loading }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openUsage: () => set({ usageOpen: true }),
  closeUsage: () => set({ usageOpen: false }),
  setUsageLoading: (loading) => set({ usageLoading: loading }),
  setUsageError: (error) => set({ usageError: error }),
  setUsageSummary: (summary) => set({ usageSummary: summary }),

  showToast: (message, duration = 3200) => {
    if (toastTimer !== null) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    set({ toast: message });
    toastTimer = setTimeout(() => {
      set({ toast: null });
      toastTimer = null;
    }, duration);
  },

  clearToast: () => {
    if (toastTimer !== null) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    set({ toast: null });
  },
}));
