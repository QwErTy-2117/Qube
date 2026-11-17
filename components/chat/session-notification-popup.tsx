"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleHelpIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { useAui, useAuiState } from "@assistant-ui/react";

import { cn } from "@/lib/utils";
import { useChatCenter } from "@/components/updater/use-chat-center";

type NoticeKind = "permission" | "question" | "done" | "failed";

type Notice = {
  key: string;
  kind: NoticeKind;
  threadId: string;
  at: number;
  label: string;
};

type RunEvent = { threadId: string; at: number };

type StatusPayload = {
  active?: string[];
  permissions?: string[];
  questions?: string[];
  completed?: RunEvent[];
  failed?: RunEvent[];
};

type ThreadItem = {
  id: string;
  remoteId?: string;
  title?: string;
  status?: string;
};

const POLL_MS = 2_000;
const DONE_VISIBLE_MS = 9_000;

// Playful, non-technical voice — the same register as the tool-call labels.
// One of the five is picked per notification so repeated popups do not all
// read identically.
const STATUS_LABELS: Record<NoticeKind, string[]> = {
  permission: [
    "Needs a tiny yes",
    "Waiting on your call",
    "Holding the door open",
    "Permission, please",
    "One quick approval",
  ],
  question: [
    "Has a quick question",
    "Curious about something",
    "Wants your take",
    "Needs a quick answer",
    "Checking in with you",
  ],
  done: [
    "All wrapped up",
    "Cracked it",
    "Finished the thing",
    "Done and dusted",
    "Ready for a look",
  ],
  failed: [
    "Hit a snag",
    "Tripped on a wire",
    "Needs another go",
    "Fumbled that one",
    "Could use a retry",
  ],
};

const KIND_ORDER: NoticeKind[] = ["permission", "question", "done", "failed"];

function labelFor(kind: NoticeKind, seed: string): string {
  const labels = STATUS_LABELS[kind];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return labels[Math.abs(hash) % labels.length];
}

function KindMark({ kind }: { kind: NoticeKind }) {
  if (kind === "permission") {
    return (
      <TriangleAlertIcon
        className="size-[18px] shrink-0 text-amber-400"
        strokeWidth={2.2}
        aria-hidden="true"
      />
    );
  }
  if (kind === "question") {
    return (
      <CircleHelpIcon
        className="size-[18px] shrink-0 text-sky-300"
        strokeWidth={2.2}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className={cn(
        "size-2.5 shrink-0 rounded-full",
        kind === "done" ? "bg-blue-500" : "bg-red-500",
      )}
      aria-hidden="true"
    />
  );
}

/**
 * Black pill notifications for work happening in other sessions:
 * permission/question (stay until handled or dismissed) and completed/failed
 * runs (auto-hide). Each pill carries only the icon, the status label and the
 * dismiss button — never the chat title. Dismissing a pending item remembers
 * it until the prompt actually resolves; opening a session removes its popup
 * immediately.
 */
export function SessionNotificationPopups() {
  const aui = useAui();
  const [mounted, setMounted] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  const threadItems = useAuiState(
    (s) => ((s.threads as any)?.threadItems ?? []) as ThreadItem[],
  );
  const mainThreadId = useAuiState(
    (s) => (s.threads as any)?.mainThreadId as string | undefined,
  );

  const knownThreads = useMemo(() => {
    const ids = new Set<string>();
    for (const item of threadItems) {
      ids.add(item.id);
      if (item.remoteId) ids.add(item.remoteId);
    }
    return ids;
  }, [threadItems]);

  const runtimeIdByServerId = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of threadItems) {
      if (item.remoteId) map.set(item.remoteId, item.id);
      map.set(item.id, item.id);
    }
    return map;
  }, [threadItems]);

  const activeServerId = useMemo(() => {
    const item = threadItems.find((entry) => entry.id === mainThreadId);
    return item?.remoteId || item?.id || mainThreadId || "";
  }, [threadItems, mainThreadId]);

  // The poll effect is mounted once; keep the values it reads in refs so a
  // thread switch or late title load does not recreate the timer.
  const activeServerIdRef = useRef(activeServerId);
  const knownThreadsRef = useRef(knownThreads);
  const runtimeIdByServerIdRef = useRef(runtimeIdByServerId);
  activeServerIdRef.current = activeServerId;
  knownThreadsRef.current = knownThreads;
  runtimeIdByServerIdRef.current = runtimeIdByServerId;

  const initializedRef = useRef(false);
  const mountedAtRef = useRef(0);
  const seenOutcomesRef = useRef<Set<string>>(new Set());
  const dismissedRef = useRef<Set<string>>(new Set());
  // Mirror of `notices` for the long-lived poll effect. Keeping the list in a
  // ref makes the poll build its next state outside React's updater, so
  // StrictMode's double-invocation cannot swallow a new notification.
  const noticesRef = useRef<Notice[]>([]);

  const commitNotices = (next: Notice[]) => {
    noticesRef.current = next;
    setNotices(next);
  };

  useEffect(() => {
    mountedAtRef.current = Date.now();
    setMounted(true);
  }, []);

  // Opening the session that owns a notice hides it. If it is still pending
  // and the user later switches away, the next poll brings it back.
  useEffect(() => {
    if (!activeServerId) return;
    const current = noticesRef.current;
    const next = current.filter((notice) => notice.threadId !== activeServerId);
    if (next.length !== current.length) commitNotices(next);
  }, [activeServerId]);

  useEffect(() => {
    if (!mounted) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const res = await fetch("/api/threads/status", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as StatusPayload;
          if (!cancelled) {
            const pending: Array<{ kind: NoticeKind; threadId: string }> = [
              ...(Array.isArray(data.permissions)
                ? data.permissions.map((threadId) => ({
                    kind: "permission" as const,
                    threadId: String(threadId),
                  }))
                : []),
              ...(Array.isArray(data.questions)
                ? data.questions.map((threadId) => ({
                    kind: "question" as const,
                    threadId: String(threadId),
                  }))
                : []),
            ];
            const outcomes: Array<{ kind: NoticeKind; threadId: string; at: number }> = [
              ...(Array.isArray(data.completed)
                ? data.completed.map((event) => ({
                    kind: "done" as const,
                    threadId: String(event.threadId),
                    at: Number(event.at) || 0,
                  }))
                : []),
              ...(Array.isArray(data.failed)
                ? data.failed.map((event) => ({
                    kind: "failed" as const,
                    threadId: String(event.threadId),
                    at: Number(event.at) || 0,
                  }))
                : []),
            ];

            const activeId = activeServerIdRef.current;
            const known = knownThreadsRef.current;
            const now = Date.now();
            const pendingKeys = new Set(
              pending.map((item) => `${item.kind}:${item.threadId}`),
            );
            const firstPoll = !initializedRef.current;
            initializedRef.current = true;

            const current = noticesRef.current;
            let next = [...current];

            // Pending items that resolved (or whose thread went away) are
            // removed, and their dismissal is forgotten for next time. Check
            // the dismissal set as well as visible notices: the user may have
            // dismissed the popup before the prompt resolved.
            for (const notice of current) {
              if (notice.kind !== "permission" && notice.kind !== "question") {
                continue;
              }
              if (pendingKeys.has(notice.key)) continue;
              next = next.filter((entry) => entry.key !== notice.key);
            }
            for (const key of [...dismissedRef.current]) {
              if (!key.startsWith("permission:") && !key.startsWith("question:")) {
                continue;
              }
              if (!pendingKeys.has(key)) dismissedRef.current.delete(key);
            }

            for (const item of pending) {
              if (!item.threadId || item.threadId === activeId) continue;
              if (!known.has(item.threadId)) continue;
              const key = `${item.kind}:${item.threadId}`;
              if (dismissedRef.current.has(key)) continue;
              if (next.some((notice) => notice.key === key)) continue;
              next.push({
                key,
                kind: item.kind,
                threadId: item.threadId,
                at: now,
                label: labelFor(item.kind, key),
              });
            }

            for (const event of outcomes) {
              const outcomeKey = `${event.kind}:${event.threadId}:${event.at}`;
              if (seenOutcomesRef.current.has(outcomeKey)) continue;
              seenOutcomesRef.current.add(outcomeKey);
              // First poll only seeds; later polls are new events. Live
              // pending prompts above are still shown on that first poll.
              if (firstPoll) continue;
              if (!event.threadId || event.threadId === activeId) continue;
              if (!known.has(event.threadId)) continue;
              if (!event.at || event.at < mountedAtRef.current - 1_500) continue;
              if (dismissedRef.current.has(outcomeKey)) continue;
              if (next.some((notice) => notice.key === outcomeKey)) continue;
              next.push({
                key: outcomeKey,
                kind: event.kind,
                threadId: event.threadId,
                at: now,
                label: labelFor(event.kind, outcomeKey),
              });
            }

            if (
              next.length !== current.length ||
              next.some((notice, index) => notice !== current[index])
            ) {
              commitNotices(next);
            }
          }
        }
      } catch {
        // Keep showing the current notices; the next poll retries.
      }
      if (!cancelled) timer = setTimeout(load, POLL_MS);
    };

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [mounted]);

  // Completed/failed notices are transient. Pending ones stay until resolved
  // or dismissed.
  useEffect(() => {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const expired: string[] = [];
    for (const notice of notices) {
      if (notice.kind !== "done" && notice.kind !== "failed") continue;
      const remaining = DONE_VISIBLE_MS - (Date.now() - notice.at);
      if (remaining <= 0) {
        expired.push(notice.key);
        continue;
      }
      timers.push(
        setTimeout(() => {
          const current = noticesRef.current;
          const next = current.filter((entry) => entry.key !== notice.key);
          if (next.length !== current.length) commitNotices(next);
        }, remaining),
      );
    }
    if (expired.length > 0) {
      const current = noticesRef.current;
      const next = current.filter((entry) => !expired.includes(entry.key));
      if (next.length !== current.length) commitNotices(next);
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [notices]);

  const groups = useMemo(
    () =>
      KIND_ORDER.map((kind) => {
        // A fast session can finish twice while the first pill is still up;
        // keep the newest notice per session.
        const seen = new Set<string>();
        const items = notices
          .filter((notice) => notice.kind === kind)
          .sort((a, b) => b.at - a.at)
          .filter((notice) => {
            if (seen.has(notice.threadId)) return false;
            seen.add(notice.threadId);
            return true;
          })
          .slice(0, 5);
        return { kind, items };
      }).filter((group) => group.items.length > 0),
    [notices],
  );

  const centerX = useChatCenter(mounted && groups.length > 0);

  if (!mounted || typeof document === "undefined") return null;
  // Don't mount at the 50% fallback and slide to the measured chat-column
  // center while the entrance animation runs: wait for the first measurement.
  if (groups.length > 0 && centerX == null) return null;

  const dismissKind = (kind: NoticeKind) => {
    const items = noticesRef.current.filter((notice) => notice.kind === kind);
    for (const item of items) dismissedRef.current.add(item.key);
    const keys = new Set(items.map((item) => item.key));
    commitNotices(noticesRef.current.filter((notice) => !keys.has(notice.key)));
  };

  const openSession = (serverId: string) => {
    const runtimeId = runtimeIdByServerIdRef.current.get(serverId);
    commitNotices(
      noticesRef.current.filter((notice) => notice.threadId !== serverId),
    );
    if (!runtimeId) return;
    try {
      Promise.resolve(aui.threads().switchToThread(runtimeId)).catch(() => {});
    } catch {
      // A missing/deleted thread is handled by the sidebar's fallback path.
    }
  };

  const node = (
    <div
      className="pointer-events-none fixed top-4 z-[95] flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ left: centerX ?? "50%" }}
    >
      <AnimatePresence initial={false}>
        {groups.map((group) => {
          const first = group.items[0];
          return (
            <motion.div
              key={group.kind}
              layout
              initial={{ y: -16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -16, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 420,
                damping: 30,
                mass: 0.7,
              }}
              onClick={() => openSession(first.threadId)}
              className="pointer-events-auto flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-black py-1.5 pl-3 pr-1.5 text-white shadow-2xl shadow-black/40"
              role="status"
              aria-live="polite"
            >
              <span className="flex size-[18px] shrink-0 items-center justify-center">
                <KindMark kind={group.kind} />
              </span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openSession(first.threadId);
                }}
                className="min-w-0 truncate text-left text-[13px] font-semibold leading-none text-white"
              >
                {first.label}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  dismissKind(group.kind);
                }}
                aria-label="Dismiss notification"
                className="flex size-6 shrink-0 items-center justify-center rounded-full text-white/55"
              >
                <XIcon className="size-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );

  return createPortal(node, document.body);
}
