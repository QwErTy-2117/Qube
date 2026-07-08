"use client";

import { useEffect, useState } from "react";

export function Titlebar() {
  const [isTauri, setIsTauri] = useState(false);

  useEffect(() => {
    const tauri = typeof window !== "undefined" && "__TAURI__" in window;
    if (tauri) {
      document.documentElement.classList.add("tauri");
    }
    setIsTauri(tauri);
  }, []);

  if (!isTauri) return null;

  const handleMinimize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  };

  const handleToggleMaximize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const maximized = await win.isMaximized();
    if (maximized) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
  };

  const handleClose = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  };

  return (
    <div
      data-tauri-drag-region
      className="flex h-10 w-full shrink-0 items-center justify-between bg-muted px-4 select-none"
    >
      <span className="text-sm font-semibold text-foreground">Qube</span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleMinimize}
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="Minimize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="5.5" width="8" height="1" rx="0.5" fill="currentColor" />
          </svg>
        </button>
        <button
          onClick={handleToggleMaximize}
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="Maximize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="2" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        </button>
        <button
          onClick={handleClose}
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-red-500 hover:text-white"
          aria-label="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
