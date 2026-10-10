"use client";

import { useEffect } from "react";

function resolveExternal(href: string): string | null {
  try {
    const url = new URL(href, window.location.href);
    // mailto:/tel: should also leave the app (system handler), never navigate the webview.
    if (url.protocol === "mailto:" || url.protocol === "tel:") return url.toString();
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Same-origin (the local sidecar on 127.0.0.1/localhost) stays inside the app.
    if (url.origin === window.location.origin) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function openExternal(url: string) {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch {
    // Fallback for non-Tauri or if the shell plugin is unavailable.
    // NOTE: inside Tauri window.open is overridden below, so this still
    // ends up in the system browser instead of the webview.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * In the Tauri desktop production build the app runs inside a single
 * webview. Any plain <a href="https://…"> click (markdown links, search
 * results, "Visit site", etc.) would otherwise navigate the webview away
 * from the local sidecar and trap the user on an external site inside the
 * app window. This handler intercepts all external link activations when
 * running under Tauri and opens them in the system browser instead.
 */
export function ExternalLinkHandler() {
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      let inTauri = false;
      try {
        const { isTauri } = await import("@tauri-apps/api/core");
        inTauri = isTauri();
      } catch {
        return;
      }
      if (!inTauri || cancelled) return;

      const handleClick = (e: MouseEvent) => {
        if (e.defaultPrevented) return;
        // Left-click and middle-click; modifiers (ctrl/meta/shift) also mean "open link".
        const target = e.target as HTMLElement | null;
        const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!anchor) return;
        if (anchor.hasAttribute("download")) return;
        const raw = anchor.getAttribute("href");
        if (!raw || raw.startsWith("#")) return;
        if (raw.startsWith("blob:") || raw.startsWith("data:") || raw.startsWith("javascript:")) return;
        const external = resolveExternal(anchor.href || raw);
        if (!external) return;
        e.preventDefault();
        e.stopPropagation();
        void openExternal(external);
      };

      document.addEventListener("click", handleClick, true);
      document.addEventListener("auxclick", handleClick, true);

      // Some code paths call window.open(url, "_blank") directly — route
      // those through the system browser as well.
      const originalOpen = window.open.bind(window);
      const patchedOpen = ((url?: string | URL | null, target?: string, features?: string) => {
        if (typeof url === "string") {
          const external = resolveExternal(url);
          if (external) {
            void openExternal(external);
            return null;
          }
        }
        return originalOpen(url as string, target, features);
      }) as typeof window.open;
      window.open = patchedOpen;

      cleanup = () => {
        document.removeEventListener("click", handleClick, true);
        document.removeEventListener("auxclick", handleClick, true);
        if (window.open === patchedOpen) window.open = originalOpen;
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return null;
}
