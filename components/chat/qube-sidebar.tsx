"use client";

import { useEffect, useMemo, useRef, useState, type FC, type MouseEvent } from "react";
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
  const [hoverId, setHoverId] = useState<string | null>(null);

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
  const threadIds = useAuiState(
    (s) => ((s.threads as any)?.threadIds ?? []) as string[],
  );
  const threadItems = useAuiState(
    (s) => ((s.threads as any)?.threadItems ?? []) as Array<{
      id: string;
      remoteId?: string;
      title?: string;
      status?: string;
      lastMessageAt?: Date | string | number;
    }>,
  );
  const mainThreadId = useAuiState(
    (s) => (s.threads as any)?.mainThreadId as string | undefined,
  );
  // Message activity of the open chat: bumping recency when a message lands
  // keeps the active chat on top immediately (the runtime's lastMessageAt
  // only refreshes from the server on reload).
  const mainMessagesLength = useAuiState(
    (s) => ((s.threads as any)?.main?.messages?.length ?? 0) as number,
  );
  const [activity, setActivity] = useState<Record<string, number>>({});
  // Only new message activity bumps recency — merely viewing an old chat
  // must not reorder the list.
  const prevCountRef = useRef<{ id: string | undefined; len: number }>({
    id: undefined,
    len: 0,
  });
  useEffect(() => {
    const prev = prevCountRef.current;
    if (mainThreadId && prev.id === mainThreadId) {
      if (mainMessagesLength > 0 && mainMessagesLength > prev.len) {
        const id = mainThreadId;
        setActivity((p) => ({ ...p, [id]: Date.now() }));
      }
    }
    prevCountRef.current = { id: mainThreadId, len: mainMessagesLength };
  }, [mainThreadId, mainMessagesLength]);

  const visibleThreads = useMemo(() => {
    const byId = new Map(threadItems.map((t) => [t.id, t]));
    // Respect the runtime's threadIds order first (newly initialized chats
    // are prepended there), then append any stray items.
    const ordered = [
      ...threadIds
        .map((id) => byId.get(id))
        .filter((t): t is NonNullable<typeof t> => !!t),
      ...threadItems.filter((t) => t && !threadIds.includes(t.id)),
    ];
    const timeOf = (t: { id: string; lastMessageAt?: Date | string | number }) => {
      const local = activity[t.id] ?? 0;
      let remote = 0;
      try {
        const v = t.lastMessageAt as any;
        if (v instanceof Date) remote = v.getTime();
        else if (typeof v === "number") remote = v;
        else if (typeof v === "string") remote = new Date(v).getTime();
        else if (v && typeof v.getTime === "function") remote = v.getTime();
      } catch {}
      if (!Number.isFinite(remote)) remote = 0;
      return Math.max(local, remote);
    };
    return ordered
      .filter(
        (t) => t && t.status !== "new" && t.status !== "archived" && t.status !== "deleted",
      )
      .sort((a, b) => timeOf(b) - timeOf(a));
  }, [threadIds, threadItems, activity]);

  // The URL follows the main thread reactively (ThreadUrlSync) — actions
  // only switch; never read ids imperatively (those snapshots go stale).
  // Missing/deleted threads fall back to a fresh chat, never an error.
  const openChat = (t: { id: string; remoteId?: string }) => {
    try {
      Promise.resolve(aui.threads().switchToThread(t.id)).catch(() => {
        try {
          Promise.resolve(aui.threads().switchToNewThread()).catch(() => {});
        } catch {}
      });
    } catch {
      try {
        Promise.resolve(aui.threads().switchToNewThread()).catch(() => {});
      } catch {}
    }
  };

  const newChat = () => {
    try {
      Promise.resolve(aui.threads().switchToNewThread()).catch(() => {});
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
                  data-thread-row={t.id}
                  onClick={() => {
                    if (!renaming) openChat(t);
                  }}
                  onMouseEnter={() => setHoverId(t.id)}
                  onMouseLeave={() => setHoverId((h) => (h === t.id ? null : h))}
                  className={cn(
                    ROW,
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
                            Promise.resolve(
                              aui.threads().item({ id: t.id }).rename(v.trim().slice(0, 120)),
                            ).catch(() => {});
                          }
                        } catch {}
                        setRenamingId(null);
                      }}
                      onCancel={() => setRenamingId(null)}
                    />
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">{title}</span>
                      {/* Hover-only reveal (active or not): buttons stay hidden
                          until the row itself is hovered. */}
                      <span
                        className="flex shrink-0 items-center gap-0.5 pl-1 transition-opacity duration-150"
                        style={{
                          opacity: hoverId === t.id ? 1 : 0,
                          pointerEvents: hoverId === t.id ? "auto" : "none",
                        }}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingId(t.id);
                          }}
                          aria-label="Rename chat"
                          title="Rename"
                          className="flex size-6 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <PencilIcon className="size-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // The fallback effect re-homes main; the URL
                            // follows reactively.
                            try {
                              Promise.resolve(
                                aui.threads().item({ id: t.id }).delete(),
                              ).catch(() => {});
                            } catch {}
                          }}
                          aria-label="Delete chat"
                          title="Delete"
                          className="flex size-6 items-center justify-center text-muted-foreground transition-colors hover:text-destructive focus-visible:text-destructive"
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
