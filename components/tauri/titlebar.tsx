"use client";

import { useCallback, useEffect, useRef, useState } from "react";

async function getWindow() {
  const mod = await import("@tauri-apps/api/window");
  return mod;
}

export function Titlebar() {
  const [isTauri, setIsTauri] = useState<boolean | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [platform, setPlatform] = useState<"windows" | "macos" | "linux" | "other">("other");
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      let tauri = false;
      try {
        const { isTauri: check } = await import("@tauri-apps/api/core");
        tauri = check();
      } catch {
        // not in Tauri
      }

      if (!tauri) {
        setIsTauri(false);
        return;
      }

      setIsTauri(true);
      document.documentElement.classList.add("tauri");

      try {
        const userAgent = window.navigator.userAgent.toLowerCase();
        if (userAgent.includes("win")) {
          setPlatform("windows");
        } else if (userAgent.includes("mac")) {
          setPlatform("macos");
        } else if (userAgent.includes("linux")) {
          setPlatform("linux");
        } else {
          setPlatform("other");
        }
      } catch {}

      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();

        const checkMaximized = async () => {
          try {
            const max = await win.isMaximized();
            setIsMaximized(max);
            document.documentElement.classList.toggle("maximized", max);
          } catch {}
        };

        checkMaximized();
        let unlisten: (() => void) | undefined;
        win.onResized(checkMaximized).then((fn) => {
          unlisten = fn;
        });
        return () => {
          unlisten?.();
        };
      } catch {}
    })();

    return () => {
      document.documentElement.classList.remove("tauri", "maximized");
    };
  }, []);

  const handleMinimize = useCallback(async () => {
    try {
      const { getCurrentWindow } = await getWindow();
      await getCurrentWindow().minimize();
    } catch {}
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    try {
      const { getCurrentWindow } = await getWindow();
      const win = getCurrentWindow();
      if (isMaximized) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    } catch {}
  }, [isMaximized]);

  const handleClose = useCallback(async () => {
    try {
      const { getCurrentWindow } = await getWindow();
      await getCurrentWindow().close();
    } catch {}
  }, []);

  if (isTauri !== true) return null;

  const renderButtons = () => {
    if (platform === "windows") {
      return (
        <div className="flex items-center h-8 gap-0 select-none" data-tauri-no-drag-region>
          <button
            onClick={handleMinimize}
            className="flex w-[46px] h-8 items-center justify-center text-foreground/80 dark:text-foreground/90 transition-colors duration-150 hover:bg-black/10 dark:hover:bg-white/10 active:bg-black/20 dark:active:bg-white/20 rounded-sm"
            aria-label="Minimize"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <line x1="1.5" y1="6" x2="10.5" y2="6" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button
            onClick={handleToggleMaximize}
            className="flex w-[46px] h-8 items-center justify-center text-foreground/80 dark:text-foreground/90 transition-colors duration-150 hover:bg-black/10 dark:hover:bg-white/10 active:bg-black/20 dark:active:bg-white/20 rounded-sm"
            aria-label={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="2" y="4" width="6" height="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
                <path d="M4 4V2H10V8H8" stroke="currentColor" strokeWidth="1.2" fill="none" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="2" y="2" width="8" height="8" stroke="currentColor" strokeWidth="1.2" fill="none" />
              </svg>
            )}
          </button>
          <button
            onClick={handleClose}
            className="flex w-[46px] h-8 items-center justify-center text-foreground/80 dark:text-foreground/90 transition-colors duration-150 hover:bg-[#e81123] hover:text-white dark:hover:bg-[#e81123] dark:hover:text-white active:bg-[#f1707a] active:text-white rounded-sm"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      );
    }

    if (platform === "macos") {
      return (
        <div 
          className="group/mac flex items-center h-8 gap-2 pr-2 select-none" 
          data-tauri-no-drag-region
        >
          {/* Close dot (Red) */}
          <button
            onClick={handleClose}
            className="relative flex size-3 items-center justify-center rounded-full bg-[#FF5F56] border border-[#E0443E]/20 transition-all duration-150 active:brightness-90 cursor-default"
            aria-label="Close"
          >
            <svg 
              width="6" 
              height="6" 
              viewBox="0 0 6 6" 
              fill="none" 
              className="absolute opacity-0 group-hover/mac:opacity-100 text-[#4c0002]/80 transition-opacity duration-150"
            >
              <path d="M1.5 1.5L4.5 4.5M4.5 1.5L1.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>

          {/* Minimize dot (Yellow) */}
          <button
            onClick={handleMinimize}
            className="relative flex size-3 items-center justify-center rounded-full bg-[#FFBD2E] border border-[#DEA123]/20 transition-all duration-150 active:brightness-90 cursor-default"
            aria-label="Minimize"
          >
            <svg 
              width="6" 
              height="6" 
              viewBox="0 0 6 6" 
              fill="none" 
              className="absolute opacity-0 group-hover/mac:opacity-100 text-[#5c3e00]/80 transition-opacity duration-150"
            >
              <line x1="1" y1="3" x2="5" y2="3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>

          {/* Maximize dot (Green) */}
          <button
            onClick={handleToggleMaximize}
            className="relative flex size-3 items-center justify-center rounded-full bg-[#27C93F] border border-[#1AAB29]/20 transition-all duration-150 active:brightness-90 cursor-default"
            aria-label={isMaximized ? "Restore" : "Maximize"}
          >
            <svg 
              width="6" 
              height="6" 
              viewBox="0 0 6 6" 
              fill="none" 
              className="absolute opacity-0 group-hover/mac:opacity-100 text-[#004e00]/80 transition-opacity duration-150"
            >
              <path d="M1.5 4.5L4.5 1.5M4.5 1.5H2.5M4.5 1.5V3.5M1.5 4.5H3.5M1.5 4.5V2.5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      );
    }

    // Default & Linux
    return (
      <div className="flex items-center h-8 gap-2 select-none" data-tauri-no-drag-region>
        <button
          onClick={handleMinimize}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground/80 hover:text-foreground transition-all duration-150 hover:bg-black/10 dark:hover:bg-white/10 active:bg-black/20 dark:active:bg-white/20 active:scale-95"
          aria-label="Minimize"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onClick={handleToggleMaximize}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground/80 hover:text-foreground transition-all duration-150 hover:bg-black/10 dark:hover:bg-white/10 active:bg-black/20 dark:active:bg-white/20 active:scale-95"
          aria-label={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="5" width="7" height="7" rx="1" />
              <path d="M5 5V2.5C5 1.9 5.4 1.5 6 1.5H11.5C12.1 1.5 12.5 1.9 12.5 2.5V8C12.5 8.6 12.1 9 11.5 9H9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2.5" y="2.5" width="9" height="9" rx="1" />
            </svg>
          )}
        </button>
        <button
          onClick={handleClose}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground/80 hover:text-red-500 transition-all duration-150 hover:bg-black/10 dark:hover:bg-white/10 active:bg-red-500/10 active:scale-95"
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    );
  };

  return (
    <div
      data-tauri-drag-region={isTauri ? true : undefined}
      className="absolute top-0 left-0 right-0 h-14 z-50 flex items-start justify-end select-none bg-transparent"
    >
      <div className="group/zone h-full w-60 flex items-start justify-end pt-4 pr-4 bg-transparent">
        <div className="opacity-0 pointer-events-none group-hover/zone:opacity-100 group-hover/zone:pointer-events-auto transition-all duration-300 ease-in-out">
          {renderButtons()}
        </div>
      </div>
    </div>
  );
}
