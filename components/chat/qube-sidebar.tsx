"use client";

import { useEffect, useState, type FC, type MouseEvent } from "react";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useAui } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import logoPng from "@/public/logo.png";
import { useTheme } from "next-themes";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { SettingsDialog } from "@/components/shared/settings-dialog";
import { OnboardingModal } from "@/components/shared/onboarding-dialog";
import { useThreadStore, loadExpanded } from "@/lib/chat/thread-store";
import { isPlaceholderTitle } from "@/lib/chat/threads-client";
import {
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  PencilIcon,
  Trash2Icon,
  CheckIcon,
  XIcon,
  Settings as SettingsIcon,
} from "lucide-react";

// Single shared sidebar-toggle look: same icon, same size, same container,
// used for both expand and reduce.
const SidebarToggleIcon: FC = () => (
  <span className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
    <PanelLeftIcon className="size-4" />
  </span>
);

function CurtainText({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out",
        show ? "ml-2 max-w-[160px] opacity-100" : "ml-0 max-w-0 opacity-0",
      )}
    >
      {children}
    </span>
  );
}

// Single shared row style for every sidebar element: same height, width,
// shape and hover treatment.
const ROW =
  "flex h-9 w-full min-w-0 cursor-pointer items-center rounded-lg px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground";
const ROW_ICON = "size-4 shrink-0";

const RenameInput: FC<{
  initial: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}> = ({ initial, onCommit, onCancel }) => {
  const [v, setV] = useState(initial);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit(v);
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => onCommit(v)}
        className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1 text-[13px] outline-none"
      />
      <button
        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        onMouseDown={(e) => {
          e.preventDefault();
          onCommit(v);
        }}
        aria-label="Confirm rename"
      >
        <CheckIcon className="size-3" />
      </button>
      <button
        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        onMouseDown={(e) => {
          e.preventDefault();
          onCancel();
        }}
        aria-label="Cancel rename"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
};

export const QubeSidebar: FC = () => {
  const [logoHover, setLogoHover] = useState(false);
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted
    ? theme === "dark"
      ? true
      : theme === "light"
        ? false
        : theme === "system"
          ? resolvedTheme === "dark"
          : typeof document !== "undefined"
            ? document.documentElement.classList.contains("dark")
            : false
    : false;

  // Apply the persisted expand preference after mount (kept out of the
  // initial render so SSR and hydration output match).
  useEffect(() => {
    try {
      if (loadExpanded()) useThreadStore.getState().setExpanded(true);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fresh onboarding completion forces the compressed sidebar.
  useEffect(() => {
    const onForced = (e: Event) => {
      try {
        const { setExpanded: set } = useThreadStore.getState();
        set((e as CustomEvent).detail !== true);
      } catch {}
    };
    window.addEventListener("qube-sidebar-expanded-changed", onForced as EventListener);
    return () =>
      window.removeEventListener("qube-sidebar-expanded-changed", onForced as EventListener);
  }, []);

  const expanded = useThreadStore((s) => s.expanded);
  const setExpanded = useThreadStore((s) => s.setExpanded);
  const threads = useThreadStore((s) => s.threads);
  const renamingId = useThreadStore((s) => s.renamingId);
  const setRenamingId = useThreadStore((s) => s.setRenamingId);
  const requestOpen = useThreadStore((s) => s.requestOpen);
  const setSearchOpen = useThreadStore((s) => s.setSearchOpen);
  const rename = useThreadStore((s) => s.rename);
  const remove = useThreadStore((s) => s.remove);

  const selectedId = useThreadStore((s) => s.selectedId);

  const router = useRouter();
  const pathname = usePathname();
  const aui = useAui();

  const openChat = (id: string) => {
    requestOpen(id);
    if (pathname !== `/chat/${id}`) router.push(`/chat/${id}`);
  };

  const newChat = () => {
    if (pathname !== "/") {
      router.push("/");
    } else {
      // Already home: stop any run and clear the viewport in place.
      try {
        aui.thread().cancelRun();
      } catch {}
      try {
        aui.thread().import({ headId: null, messages: [] } as any);
      } catch {}
      useThreadStore.getState().setSelectedId(null);
    }
  };

  // Hide stale empty rows (placeholder title, no messages) unless selected.
  const visibleThreads = threads.filter(
    (t) => t.id === selectedId || t.hasMessages || !isPlaceholderTitle(t.title),
  );

  const expand = () => setExpanded(true);

  // Expand zones (collapsed only): the chat-list zone between the two lines,
  // and the logo. Nothing else expands or lights the logo.
  const onListZoneClick = () => {
    if (!expanded) expand();
  };
  const onListZoneHover = () => {
    if (!expanded) setLogoHover(true);
  };
  const onListZoneLeave = () => {
    if (!expanded) setLogoHover(false);
  };

  const onLogoClick = (e: MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 cursor-default flex-col overflow-hidden transition-[width] duration-300 ease-in-out",
        expanded ? "w-64" : "w-12",
      )}
    >
      <OnboardingModal />

      {/* Top row: logo left, reduce icon far-right when expanded (whole row reduces).
          Both toggles share one identical icon + style. */}
      <div
        onClick={expanded ? () => setExpanded(false) : undefined}
        className={cn(
          "mt-2 flex h-12 shrink-0 items-center px-2",
          expanded && "cursor-pointer",
        )}
        title={expanded ? "Collapse sidebar" : undefined}
      >
        <button
          data-logo-btn
          onClick={onLogoClick}
          onMouseEnter={() => {
            if (!expanded) setLogoHover(true);
          }}
          onMouseLeave={() => setLogoHover(false)}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
        >
          {logoHover && !expanded ? (
            <SidebarToggleIcon />
          ) : (
            <Image src={logoPng} alt="Qube" className="size-5 shrink-0" />
          )}
        </button>
        {expanded && (
          <span className="ml-auto flex items-center">
            <span
              role="button"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
            >
              <SidebarToggleIcon />
            </span>
          </span>
        )}
      </div>

      {/* Top actions */}
      <div className="flex shrink-0 flex-col gap-0.5 px-2">
        <button
          onClick={newChat}
          title="New chat"
          className={ROW}
        >
          <PlusIcon className={ROW_ICON} />
          <CurtainText show={expanded}>New chat</CurtainText>
        </button>
        <button
          onClick={() => setSearchOpen(true)}
          title="Search chats (⌘K)"
          className={ROW}
        >
          <SearchIcon className={ROW_ICON} />
          <CurtainText show={expanded}>Search chats</CurtainText>
        </button>
      </div>

      {/* Major separation between top buttons and the chat list */}
      <div className="mx-2 mt-4 mb-2 border-t border-border/70" aria-hidden />

      {/* Thread list zone (only threads when expanded). This zone — plus the
          logo — is the only area that expands the sidebar / lights the logo. */}
      <div
        onClick={onListZoneClick}
        onMouseEnter={onListZoneHover}
        onMouseLeave={onListZoneLeave}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 scrollbar-none",
          !expanded && "cursor-pointer",
        )}
      >
        {expanded && (
          <div className="flex flex-col gap-0.5 pb-2">
            {visibleThreads.map((t) => {
              const active = t.id === selectedId;
              const renaming = renamingId === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => {
                    if (!renaming) openChat(t.id);
                  }}
                  className={cn(
                    ROW,
                    "group",
                    active && "bg-accent text-accent-foreground",
                  )}
                  title={t.title}
                >
                  {renaming ? (
                    <RenameInput
                      initial={t.title}
                      onCommit={(v) => {
                        if (v.trim() && v.trim() !== t.title) rename(t.id, v);
                        else setRenamingId(null);
                      }}
                      onCancel={() => setRenamingId(null)}
                    />
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">{t.title || "New Chat"}</span>
                      <span className="hidden shrink-0 items-center gap-0.5 pl-1 group-hover:flex">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingId(t.id);
                          }}
                          aria-label="Rename chat"
                          title="Rename"
                          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                        >
                          <PencilIcon className="size-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void (async () => {
                              await remove(t.id);
                              const sel = useThreadStore.getState().selectedId;
                              const want = sel ? `/chat/${sel}` : "/";
                              if (pathname !== want) router.push(want);
                            })();
                          }}
                          aria-label="Delete chat"
                          title="Delete"
                          className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-destructive"
                        >
                          <Trash2Icon className="size-3" />
                        </button>
                      </span>
                    </>
                  )}
                </div>
              );
            })}
            {visibleThreads.length === 0 && <div className="px-2 py-3" aria-hidden />}
          </div>
        )}
      </div>

      {/* Separation between the chat list and the bottom buttons */}
      <div className="mx-2 mt-2 mb-2 border-t border-border/70" aria-hidden />

      {/* Bottom: theme + settings ride the sidebar with the same row style */}
      <div className="mb-2 flex shrink-0 flex-col gap-0.5 px-2">
        <div
          role="button"
          aria-label="Toggle theme"
          title="Toggle theme"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className={ROW}
        >
          <AnimatedThemeToggler
            variant="circle"
            theme={isDark ? "dark" : "light"}
            onThemeChange={(newTheme) => setTheme(newTheme)}
            className="pointer-events-none flex size-4 shrink-0 items-center justify-center [&_svg]:size-4"
          />
          <CurtainText show={expanded}>Theme</CurtainText>
        </div>
        <SettingsDialog>
          <button title="Settings" className={ROW}>
            <SettingsIcon className={ROW_ICON} />
            <CurtainText show={expanded}>Settings</CurtainText>
          </button>
        </SettingsDialog>
      </div>
    </aside>
  );
};
