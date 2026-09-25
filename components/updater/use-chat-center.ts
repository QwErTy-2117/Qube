"use client";

import { useEffect, useState } from "react";
import { CHAT_VIEWPORT_SELECTOR, chatColumnCenter } from "./chat-anchor";

/**
 * Live horizontal center of the chat column in viewport px.
 * Returns null until measured (callers fall back to 50%).
 * Re-measures on window resize and whenever the thread viewport itself
 * resizes (browser panel open/close/drag).
 */
export function useChatCenter(active: boolean): number | null {
  const [center, setCenter] = useState<number | null>(null);

  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const update = () => {
      const next =
        chatColumnCenter(document, typeof window !== "undefined" ? window.innerWidth : undefined) ??
        (typeof window !== "undefined" ? Math.round(window.innerWidth / 2) : null);
      setCenter((prev) => (prev === next ? prev : next));
    };
    update();
    window.addEventListener("resize", update);
    let ro: ResizeObserver | null = null;
    try {
      const el = document.querySelector(CHAT_VIEWPORT_SELECTOR);
      if (el && typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(update);
        ro.observe(el);
      }
    } catch {}
    return () => {
      window.removeEventListener("resize", update);
      try {
        ro?.disconnect();
      } catch {}
    };
  }, [active]);

  return center;
}
