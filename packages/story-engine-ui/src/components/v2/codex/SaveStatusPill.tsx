/**
 * SaveStatusPill — 草稿/会话自动保存状态提示（审查 #3：保存失败不再静默）。
 *
 * 订阅 autosaveControl 快照：保存中显示低调「保存中…」，成功后短暂显示「已保存」再淡出，
 * 失败则常驻红色「保存失败」+ 手动「重试」，并做有限次指数退避自动重试（避免用户以为已保存实则丢失）。
 * 渲染在 .codex-app 之外（App 根），故用内联样式、不依赖 codex 作用域变量。
 */
import { useEffect, useRef, useState } from "react";
import { subscribeAutosave, type AutosaveSnapshot } from "../../../utils/autosaveControl.js";

const MAX_AUTO_RETRIES = 4;

export function SaveStatusPill({ onRetry }: { readonly onRetry: () => void }) {
  const [snap, setSnap] = useState<AutosaveSnapshot>({ status: "idle", hasPending: false, lastError: null, lastSavedAt: null });
  const [showSaved, setShowSaved] = useState(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => subscribeAutosave(setSnap), []);

  // 成功后短暂显示「已保存」再淡出。
  useEffect(() => {
    if (snap.status !== "saved") return undefined;
    setShowSaved(true);
    const id = setTimeout(() => setShowSaved(false), 1800);
    return () => clearTimeout(id);
  }, [snap.status, snap.lastSavedAt]);

  // 失败自动退避重试；仅 saved/idle 清零（saving 期间保持计数，否则退避永远卡在 2s）。
  useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (snap.status === "error") {
      if (retryCountRef.current < MAX_AUTO_RETRIES) {
        const delay = Math.min(30_000, 2_000 * 2 ** retryCountRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryCountRef.current += 1;
          onRetry();
        }, delay);
      }
    } else if (snap.status === "saved" || snap.status === "idle") {
      retryCountRef.current = 0;
    }
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [snap.status, snap.lastError, onRetry]);

  if (snap.status === "error") {
    return (
      <div style={{ ...baseStyle, background: "#3a1512", border: "1px solid #b4443a", color: "#f4c7c1" }} role="status" aria-live="polite">
        <span style={{ fontWeight: 600 }}>保存失败</span>
        <span style={{ opacity: 0.85, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {snap.lastError ?? "未知错误"}
        </span>
        <button
          type="button"
          onClick={() => { retryCountRef.current = 0; onRetry(); }}
          style={{ marginLeft: 4, padding: "3px 10px", borderRadius: 6, border: "1px solid #b4443a", background: "transparent", color: "#f4c7c1", cursor: "pointer", font: "inherit" }}
        >
          重试
        </button>
      </div>
    );
  }

  if (snap.status === "saving") {
    return (
      <div style={{ ...baseStyle, background: "rgba(24,22,18,.92)", border: "1px solid rgba(217,164,65,.35)", color: "#d9a441" }} role="status" aria-live="polite">
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#d9a441", opacity: 0.9 }} aria-hidden="true" />
        保存中…
      </div>
    );
  }

  if (showSaved) {
    return (
      <div style={{ ...baseStyle, background: "rgba(24,22,18,.9)", border: "1px solid rgba(120,160,120,.35)", color: "#9ec49e" }} role="status" aria-live="polite">
        已保存
      </div>
    );
  }

  return null;
}

const baseStyle: React.CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 16,
  zIndex: 60,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  borderRadius: 9,
  fontSize: 12.5,
  boxShadow: "0 6px 20px -6px rgba(0,0,0,.5)",
  pointerEvents: "auto",
};
