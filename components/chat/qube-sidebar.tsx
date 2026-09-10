"use client";

import { useEffect, useState, type FC, type MouseEvent } from "react";
import Image from "next/image";
import { useAui, useAuiState } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import logoPng from "@/public/logo.png";
import { SettingsDialog } from "@/components/shared/settings-dialog";
import { OnboardingModal } from "@/components/shared/onboarding-dialog";
import { useThreadStore, loadExpanded } from "@/lib/chat/thread-store";
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
  const renamingId = useThreadStore((s) => s.renamingId);
  const setRenamingId = useThreadStore((s) => s.setRenamingId);
  const setSearchOpen = useThreadStore((s) => s.setSearchOpen);

  const aui = useAui();

  // Runtime thread list (server-persisted via the thread-list adapter).
  // Unstarted local threads stay hidden until their first message.
  const threadItems = useAuiState(
    (s) => ((s.threads as any)?.threadItems ?? []) as Array<{
      id: string;
      remoteId?: string;
      title?: string;
      status?: string;
    }>,
  );
  const mainThreadId = useAuiState(
    (s) => (s.threads as any)?.mainThreadId as string | undefined,
  );
  const visibleThreads = threadItems.filter(
    (t) => t && t.status !== "new" && t.status !== "archived" && t.status !== "deleted",
  );

  // The URL follows the main thread reactively (ThreadUrlSync) — actions
  // only switch; never read ids imperatively (those snapshots go stale).
  const openChat = (t: { id: string; remoteId?: string }) => {
    try {
      aui.threads().switchToThread(t.id);
    } catch {}
  };

  const newChat = () => {
    try {
      aui.threads().switchToNewThread();
    } catch {}
  };

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
    // Always fall back to the logo itself after toggling.
    setLogoHover(false);
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
              const active = t.id === mainThreadId;
              const renaming = renamingId === t.id;
              const title = t.title || "New Chat";
              return (
                <div
                  key={t.id}
                  onClick={() => {
                    if (!renaming) openChat(t);
                  }}
                  className={cn(
                    ROW,
                    "group",
                    active && "bg-accent text-accent-foreground",
                  )}
                  title={title}
                >
                  {renaming ? (
                    <RenameInput
                      initial={title}
                      onCommit={(v) => {
                        try {
                          if (v.trim() && v.trim() !== title) {
                            aui.threads().item({ id: t.id }).rename(v.trim().slice(0, 120));
                          }
                        } catch {}
                        setRenamingId(null);
                      }}
                      onCancel={() => setRenamingId(null)}
                    />
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">{title}</span>
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
                            // The fallback effect re-homes main; the URL
                            // follows reactively.
                            try {
                              aui.threads().item({ id: t.id }).delete();
                            } catch {}
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

      {/* Bottom: settings rides the sidebar with the same row style */}
      <div className="mb-2 flex shrink-0 flex-col gap-0.5 px-2">
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
