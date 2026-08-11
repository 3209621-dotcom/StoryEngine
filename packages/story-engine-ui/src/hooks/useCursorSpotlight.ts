import { useEffect } from "react";
import { spotlightVars } from "./cursorSpotlight.js";

export function useCursorSpotlight(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled) {
      // 关闭时把光斑挪到屏外，辉光消失
      el.style.setProperty("--mx", "-999px");
      el.style.setProperty("--my", "-999px");
      return;
    }
    let raf = 0;
    let nx = 0;
    let ny = 0;
    const onMove = (e: MouseEvent) => {
      nx = e.clientX;
      ny = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const vars = spotlightVars(nx, ny);
        el.style.setProperty("--mx", vars["--mx"]);
        el.style.setProperty("--my", vars["--my"]);
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, enabled]);
}
