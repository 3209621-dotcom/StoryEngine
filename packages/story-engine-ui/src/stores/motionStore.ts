import { create } from "zustand";

const STORAGE_KEY = "story-engine-ng.reduce-motion";

export function resolveInitialReduceMotion(input: {
  stored: string | null;
  systemReduced: boolean;
}): boolean {
  if (input.stored === "true") return true;
  if (input.stored === "false") return false;
  return input.systemReduced;
}

function loadInitial(): boolean {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem(STORAGE_KEY);
  const systemReduced =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  return resolveInitialReduceMotion({ stored, systemReduced });
}

function applyClass(on: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("reduce-motion", on);
}

export interface MotionStore {
  readonly reduceMotion: boolean;
  readonly toggle: () => void;
  readonly set: (on: boolean) => void;
}

export const useMotionStore = create<MotionStore>((set) => {
  const initial = loadInitial();
  applyClass(initial);
  return {
    reduceMotion: initial,
    toggle: () =>
      set((s) => {
        const next = !s.reduceMotion;
        if (typeof window !== "undefined")
          localStorage.setItem(STORAGE_KEY, String(next));
        applyClass(next);
        return { reduceMotion: next };
      }),
    set: (on) => {
      if (typeof window !== "undefined")
        localStorage.setItem(STORAGE_KEY, String(on));
      applyClass(on);
      set({ reduceMotion: on });
    },
  };
});
