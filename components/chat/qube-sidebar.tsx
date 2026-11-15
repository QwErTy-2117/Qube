"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FC, type MouseEvent } from "react";
import dynamic from "next/dynamic";
import { useAui, useAuiState } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { emitMascot } from "@/components/chat/mascot/mascot-bus";
// Heavy UI is lazy so the sidebar paints instantly on Windows cold start:
// - MascotMini pulls three.js + @react-three/fiber (MBs) for a 24px logo
// - SettingsDialog pulls 40+ lobehub icons, only needed when opened
// - OnboardingModal only renders on first run
const MascotMini = dynamic(() => import("@/components/chat/mascot/MascotMini").then((m) => m.MascotMini), {
  ssr: false,
  loading: () => <span className="block size-6 rounded-md bg-muted/60" aria-hidden />,
}) as any;
const SettingsDialog = dynamic(
  () => import("@/components/shared/settings-dialog").then((m) => m.SettingsDialog),
  { ssr: false },
) as any;
const OnboardingModal = dynamic(
  () => import("@/components/shared/onboarding-dialog").then((m) => m.OnboardingModal),
  { ssr: false },
) as any;
import { useThreadStore, loadExpanded } from "@/lib/chat/thread-store";
import {
  THREAD_SEEN_STORAGE_KEY,
  isThreadUnread,
  parseThreadSeen,
} from "@/lib/chat/thread-unread";
import {
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  PencilIcon,
  Trash2Icon,
  CheckIcon,
  XIcon,
  Loader2,
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

type LiveThreadStatus = {
  active: string[];
  permissions: string[];
  questions: string[];
};

/**
 * Per-session badge, rendered at the START of the row: spinner while the run
 * is working, amber dot while it waits for an answer/permission, blue dot for
 * an unread last message.
 */
const ThreadStatusIndicator: FC<{
  status: "running" | "pending" | "unread" | null;
}> = ({ status }) => {
  if (!status) return null;
  if (status === "running") {
    return (
      <span
        className="mr-1.5 flex size-4 shrink-0 items-center justify-center"
        title="Working…"
        aria-label="Session working"
      >
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span
        className="mr-1.5 size-1.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-amber-400)_18%,transparent)]"
        title="Waiting for your answer"
        aria-label="Session waiting for you"
      />
    );
  }
  return (
    <span
      className="mr-1.5 size-1.5 shrink-0 rounded-full bg-[#2f7cf6]"
      title="Unread messages"
      aria-label="Unread messages"
    />
  );
};

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

  // Last-checked timestamps (server thread id → ms). The blue dot means the
  // last message is newer than the last time this thread was viewed.
  const [seenByThread, setSeenByThread] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      setSeenByThread(parseThreadSeen(localStorage.getItem(THREAD_SEEN_STORAGE_KEY)));
    } catch {}
  }, []);
  const markSeen = useCallback((threadId: string | undefined) => {
    if (!threadId) return;
    setSeenByThread((current) => {
      const now = Date.now();
      // Same-millisecond repeats are no-ops; otherwise record the check.
      if ((current[threadId] ?? 0) >= now) return current;
      const next = { ...current, [threadId]: now };
      try {
        localStorage.setItem(THREAD_SEEN_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // Live runs + pending interactions, keyed by server thread id. Polled
  // instead of derived from the open thread so background sessions keep
  // their spinner/dot even while another chat is focused.
  const [liveStatus, setLiveStatus] = useState<LiveThreadStatus>({
    active: [],
    permissions: [],
    questions: [],
  });
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const res = await fetch("/api/threads/status", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setLiveStatus({
              active: Array.isArray(data?.active) ? data.active : [],
              permissions: Array.isArray(data?.permissions) ? data.permissions : [],
              questions: Array.isArray(data?.questions) ? data.questions : [],
            });
          }
        }
      } catch {
        // Keep the last known badges; the next poll retries.
      }
      if (!cancelled) timer = setTimeout(load, 2000);
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

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

  // First run after this feature ships: treat existing history as checked so
  // the list does not light up every old chat. New messages still mark unread.
  const seededSeenRef = useRef(false);
  useEffect(() => {
    if (seededSeenRef.current || threadIds.length === 0) return;
    seededSeenRef.current = true;
    try {
      if (localStorage.getItem(THREAD_SEEN_STORAGE_KEY)) return;
    } catch {
      return;
    }
    const now = Date.now();
    const seeded: Record<string, number> = {};
    for (const item of threadItems) {
      seeded[item.remoteId || item.id] = now;
    }
    setSeenByThread(seeded);
    try {
      localStorage.setItem(THREAD_SEEN_STORAGE_KEY, JSON.stringify(seeded));
    } catch {}
  }, [threadIds, threadItems]);

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

  // Server id of the open chat, so "seen" is stored under the same key the
  // sidebar uses for `lastMessageAt`.
  const activeServerId = useMemo(() => {
    const item = threadItems.find((entry) => entry.id === mainThreadId);
    return item?.remoteId || item?.id || mainThreadId || "";
  }, [threadItems, mainThreadId]);

  // Viewing a chat (or coming back to the window while it is open) checks
  // its latest message. A new message arriving in the open chat also clears
  // the dot; background chats keep it until they are opened.
  useEffect(() => {
    if (!activeServerId) return undefined;
    const check = () => {
      try {
        if (document.visibilityState === "hidden") return;
      } catch {}
      markSeen(activeServerId);
    };
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [activeServerId, mainMessagesLength, markSeen]);

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
    emitMascot("jump");
    markSeen(t.remoteId || t.id);
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
    emitMascot("jump");
    try {
      Promise.resolve(aui.threads().switchToNewThread()).catch(() => {});
    } catch {}
  };

  const expand = () => setExpanded(true);

  const onListZoneClick = () => {
    if (!expanded) expand();
  };

  const onLogoClick = (e: MouseEvent) => {
    e.stopPropagation();
    // Playful 360° spin on top of the expand/collapse toggle.
    emitMascot("spin");
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
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
        >
          <MascotMini size={24} />
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

      {/* Thread list zone (only threads when expanded). Clicking the zone
          while collapsed expands the sidebar. */}
      <div
        onClick={onListZoneClick}
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
              const serverId = t.remoteId || t.id;
              const waiting =
                liveStatus.permissions.includes(serverId) ||
                liveStatus.questions.includes(serverId);
              const working = !waiting && liveStatus.active.includes(serverId);
              const unread =
                !active && isThreadUnread(t.lastMessageAt, seenByThread[serverId]);
              const statusKind = waiting
                ? "pending"
                : working
                  ? "running"
                  : unread
                    ? "unread"
                    : null;
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
                            markSeen(serverId);
                          }
                        } catch {}
                        setRenamingId(null);
                      }}
                      onCancel={() => setRenamingId(null)}
                    />
                  ) : (
                    <>
                      <ThreadStatusIndicator status={statusKind} />
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
