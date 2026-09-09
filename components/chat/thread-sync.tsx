"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAui, useAuiState, getExternalStoreMessages } from "@assistant-ui/react";
import { useThreadStore } from "@/lib/chat/thread-store";
import {
  fetchThreadRepository,
  saveThreadRepository,
  requestAgentTitle,
} from "@/lib/chat/threads-client";

const EMPTY_REPO = { headId: null, messages: [] } as any;

// TEMPORARY transition tracing (debug only).
function tlog(...args: any[]) {
  try {
    const w = window as any;
    w.__tlog = w.__tlog || [];
    w.__tlog.push([Math.round(performance.now()), ...args]);
  } catch {}
}

/** Rebuild a UIMessage from a ThreadMessage when no bound inners exist. */
function threadMessageToUIMessage(tm: any): any | null {
  if (!tm || typeof tm !== "object") return null;
  const role = tm.role;
  if (role !== "user" && role !== "assistant" && role !== "system") return null;
  const content = Array.isArray(tm.content) ? tm.content : [];
  const parts: any[] = [];
  for (const p of content) {
    if (!p || typeof p !== "object") continue;
    if ((p.type === "text" || p.type === "reasoning") && typeof p.text === "string") {
      parts.push({ type: p.type, text: p.text });
    } else if (p.type === "tool-call") {
      parts.push({ type: "text", text: `[tool: ${p.toolName ?? "unknown"}]` });
    } else if (typeof (p as any).text === "string") {
      parts.push({ type: "text", text: (p as any).text });
    }
  }
  if (parts.length === 0) return null;
  return { id: typeof tm.id === "string" ? tm.id : `m_${Date.now()}`, role, parts };
}

/**
 * Convert the live export into the restorable v2 snapshot: plain AI SDK
 * UIMessages with parent linkage (mirrors the runtime's own external-state
 * export so thread().importExternalState() faithfully restores the viewport).
 * Items without bound inners are reconstructed from content so responses are
 * never silently dropped.
 */
function toPersistedRepository(exported: any, stateMessages?: any[]): any {
  const idOf = (m: any): string | null =>
    m && typeof m.id === "string" ? m.id : null;
  const lastInnerIdMap = new Map<string, string>();
  const expanded: Array<{ parentId: string | null; message: unknown }> = [];

  const resolveInners = (tm: any): any[] => {
    const bound = ((getExternalStoreMessages(tm) as any[]) || []).filter(Boolean);
    if (bound.length > 0) return bound;
    const rec = threadMessageToUIMessage(tm);
    return rec ? [rec] : [];
  };

  // Drop non-content marker parts (keeps snapshots small; converter skips them anyway).
  const cleanInners = (inners: any[]): any[] =>
    inners.map((m: any) =>
      m && Array.isArray(m.parts) && m.parts.some((p: any) => p?.type === "step-start")
        ? { ...m, parts: m.parts.filter((p: any) => p?.type !== "step-start") }
        : m,
    );

  const pushResolved = (parentIdRaw: string | null, tm: any): string | null => {
    const inners = cleanInners(resolveInners(tm));
    if (inners.length === 0) return null;
    let parentId: string | null =
      parentIdRaw != null ? (lastInnerIdMap.get(parentIdRaw) ?? parentIdRaw) : null;
    for (const inner of inners) {
      expanded.push({ parentId, message: inner });
      const innerId = idOf(inner);
      if (innerId) parentId = innerId;
    }
    const outerId = idOf(tm);
    if (outerId && parentId && parentId !== outerId) lastInnerIdMap.set(outerId, parentId);
    return parentId;
  };

  for (const item of exported?.messages ?? []) {
    pushResolved(item?.parentId ?? null, item?.message);
  }

  // Merge visible messages missing from the export. The runtime's export()
  // skips messages still flagged optimistic, and that flag goes stale on
  // just-finished replies — without this merge, responses are silently
  // dropped from snapshots. Skip same-role/same-text/same-parent twins:
  // those are client/server id swaps of one logical message, not new ones.
  const textSig = (tm: any): string => {
    const content = Array.isArray(tm?.content) ? tm.content : [];
    return content
      .map((p: any) => (p?.type === "text" || p?.type === "reasoning") && typeof p?.text === "string" ? p.text : "")
      .join("\n");
  };
  if (Array.isArray(stateMessages)) {
    const exportedIds = new Set(
      (exported?.messages ?? []).map((i: any) => i?.message?.id),
    );
    const exportedSigParent = new Set(
      (exported?.messages ?? []).map((i: any) => {
        const tm = i?.message;
        return `${tm?.role ?? ""}\n${textSig(tm)}\n${i?.parentId ?? ""}`;
      }),
    );
    let tail: string | null =
      expanded.length > 0 ? idOf(expanded[expanded.length - 1].message) : null;
    for (const tm of stateMessages) {
      if (!tm || typeof tm.id !== "string" || exportedIds.has(tm.id)) continue;
      // Twin check against the would-be parent linkage.
      const twinKey = `${tm?.role ?? ""}\n${textSig(tm)}\n${tail ?? ""}`;
      if (exportedSigParent.has(twinKey)) continue;
      const before = expanded.length;
      const newTail = pushResolved(tail, tm);
      if (expanded.length > before) {
        tail = newTail ?? tail;
        exportedIds.add(tm.id);
      }
    }
  }

  const tailId: string | null =
    expanded.length > 0 ? idOf(expanded[expanded.length - 1].message) : null;
  let headId: string | null =
    exported?.headId != null
      ? (lastInnerIdMap.get(exported.headId) ?? exported.headId)
      : tailId;
  // The runtime head can lag behind the visible tail (just-finished replies).
  // Prefer the visible tail so the newest response is never cut off.
  if (Array.isArray(stateMessages) && stateMessages.length > 0) {
    for (let i = stateMessages.length - 1; i >= 0; i--) {
      const inners = resolveInners(stateMessages[i]);
      const iid = inners.length > 0 ? idOf(inners[inners.length - 1]) : null;
      if (iid && expanded.some((e) => idOf(e.message) === iid)) {
        headId = iid;
        break;
      }
    }
  }
  return {
    version: 2,
    headId,
    messages: expanded,
  };
}

function persistedMessageCount(repo: any): number {
  return Array.isArray(repo?.messages) ? repo.messages.length : 0;
}

/** Legacy v1 snapshots (ThreadMessages) → v2 UI-message shape, text kept. */
function legacyToV2(repository: any): any {
  const items: any[] = Array.isArray(repository?.messages) ? repository.messages : [];
  const kept: Array<{ parentId: string | null; message: unknown }> = [];
  const keptIds = new Set<string>();
  for (const item of items) {
    const rec = threadMessageToUIMessage(item?.message ?? item);
    if (!rec) continue;
    keptIds.add(rec.id);
    kept.push({ parentId: typeof item?.parentId === "string" ? item.parentId : null, message: rec });
  }
  const filtered = kept.filter(
    (k) => k.parentId == null || keptIds.has(k.parentId),
  );
  const headId =
    typeof repository?.headId === "string" && keptIds.has(repository.headId)
      ? repository.headId
      : (filtered.at(-1)?.message as any)?.id ?? null;
  return { version: 2, headId, messages: filtered };
}

function isUIMessageRepo(repository: any): boolean {
  try {
    return Array.isArray(repository?.messages?.[0]?.message?.parts);
  } catch {
    return false;
  }
}

/** Restore a snapshot into the viewport. Never throws. */
function restoreRepository(aui: ReturnType<typeof useAui>, repository: any): void {
  if (!repository || !Array.isArray(repository.messages) || repository.messages.length === 0) {
    return;
  }
  try {
    const runtime = aui.thread().__internal_getRuntime?.() as any;
    let v2 =
      repository.version === 2 || isUIMessageRepo(repository)
        ? repository
        : legacyToV2(repository);
    if (!Array.isArray(v2.messages) || v2.messages.length === 0) return;
    // Heal stale heads on linear chains (single-branch chats whose stored
    // head lags behind the last message): point at the visible tail.
    const items = v2.messages as any[];
    let linear = items.length > 0 && (items[0].parentId == null);
    for (let i = 1; i < items.length && linear; i++) {
      if (items[i].parentId !== items[i - 1]?.message?.id) linear = false;
    }
    if (linear) {
      const tailId = (items[items.length - 1]?.message as any)?.id ?? null;
      if (tailId && v2.headId !== tailId) {
        v2 = { ...v2, headId: tailId };
      }
    }
    if (runtime && typeof runtime.importExternalState === "function") {
      runtime.importExternalState({ headId: v2.headId ?? null, messages: v2.messages });
    } else {
      aui.thread().import(v2 as any);
    }
  } catch (e) {
    console.warn("[ThreadSync] restore failed", e);
  }
}

/**
 * Bridges the assistant-ui runtime with the server thread store.
 * Each URL (/chat/[id]) mounts an isolated runtime: switching chats
 * unmounts the old one, so a run can never stream into another chat.
 */
export function ThreadSync() {
  const aui = useAui();
  const router = useRouter();
  const msgCount = useAuiState((s) => (s as any).thread?.messages?.length ?? 0);
  const isRunning = useAuiState((s) => (s as any).thread?.isRunning ?? false);

  const selectedId = useThreadStore((s) => s.selectedId);

  const importingRef = useRef(false);
  // Which chat id this viewport's content provably belongs to (set on
  // import / adoption / successful save). Unmount saves are skipped for any
  // other id, so navigation races can never persist one chat under another.
  const ownedRef = useRef<string | null>(null);
  const lastSavedRef = useRef<{ sel: string; count: number; at: number } | null>(null);
  const prevSelRef = useRef<string | null>(null);
  const agentTitleRequestedRef = useRef<Set<string>>(new Set());
  const savedOnceRef = useRef<Set<string>>(new Set());
  const selRef = useRef<string | null>(selectedId);
  selRef.current = selectedId;

  // Debug handle for live verification (read-only introspection).
  useEffect(() => {
    try {
      (window as any).__qubeThreads = {
        build: "chat-v9-merge",
        thread: () => aui.thread(),
        threads: () => aui.threads(),
        persisted: () =>
          toPersistedRepository(aui.thread().export(), aui.thread().getState().messages as any),
        bindings: () =>
          ((aui.thread().export() as any)?.messages ?? []).map((item: any) => ({
            role: item?.message?.role,
            status: item?.message?.status?.type,
            parts: (item?.message?.content ?? []).map((p: any) => p?.type),
            inners: (getExternalStoreMessages(item.message) as any[]).length,
          })),
      };
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial: load the server thread list and enforce selection from the URL
  // (guards against stale store state after client-side navigation).
  useEffect(() => {
    void useThreadStore.getState().load();
    try {
      const m = window.location.pathname.match(/^\/chat\/(.+?)\/?$/);
      const store = useThreadStore.getState();
      tlog("init", window.location.pathname, "sel=", store.selectedId);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (store.selectedId !== id) store.setSelectedId(id);
      } else if (window.location.pathname === "/") {
        if (store.selectedId !== null) store.setSelectedId(null);
        // Fresh pending id every landing: nothing is persisted until the
        // first real save, so empty chats can never be stored.
        store.clearPendingId();
        store.ensurePendingId();
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Best-effort save on unmount/navigation (keeps in-flight partials).
  // Skipped mid-import: the viewport doesn't hold this chat yet.
  useEffect(() => {
    return () => {
      try {
        const sel = selRef.current;
        if (!sel || importingRef.current) return;
        if (sel !== ownedRef.current) return;
        // Don't resurrect deleted threads.
        if (useThreadStore.getState().tombstones.includes(sel)) return;
        let repo: any = null;
        try {
          repo = toPersistedRepository(
            aui.thread().export(),
            aui.thread().getState().messages as any,
          );
        } catch {}
        if (!repo || persistedMessageCount(repo) === 0) return;
        const known = useThreadStore.getState().threads.find((t) => t.id === sel);
        const blob = new Blob(
          [JSON.stringify({ repository: repo, title: known?.title || "New Chat" })],
          { type: "application/json" },
        );
        navigator.sendBeacon(`/api/threads/${encodeURIComponent(sel)}/messages`, blob);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Import whenever the selected chat changes (sidebar / search / route).
  // The selection must match the URL: a stale selection on a fresh mount
  // (store snapshot from before navigation) must never import — otherwise
  // one chat's messages get saved under another chat's id ("copies").
  useEffect(() => {
    if (!selectedId || prevSelRef.current === selectedId) return;
    try {
      if (window.location.pathname !== `/chat/${selectedId}`) {
        tlog("select-effect-skipped", selectedId, window.location.pathname);
        return;
      }
    } catch {}
    prevSelRef.current = selectedId;
    tlog("select-effect", selectedId);
    (async () => {
      importingRef.current = true;
      try {
        const data = await fetchThreadRepository(selectedId);
        tlog("fetched", selectedId, "repoMsgs=", (data?.repository as any)?.messages?.length ?? "null");
        if (data?.repository) {
          restoreRepository(aui, data.repository);
        } else {
          try {
            aui.thread().import(EMPTY_REPO);
          } catch (e) {
            console.warn("[ThreadSync] clear failed", e);
          }
        }
        const repo = aui.thread().export() as any;
        ownedRef.current = selectedId;
        lastSavedRef.current = {
          sel: selectedId,
          count: Array.isArray(repo?.messages) ? repo.messages.length : 0,
          at: Date.now(),
        };
      } catch (e) {
        console.warn("[ThreadSync] open failed", e);
      } finally {
        importingRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Note: components own all navigation (push) — selection always follows
  // the URL, never the reverse (except the first-save replace below), so a
  // stale selection can never pull the wrong chat into the viewport.

  // Lazy chat adoption: when the first message is sent with no selection,
  // adopt the pending id. No server row exists yet — it materializes with
  // the first real save, so empty chats are never stored. Only on "/": on a
  // chat URL the route owns selection (adopting here would fork a copy).
  useEffect(() => {
    if (selectedId) return;
    if (msgCount === 0) return;
    try {
      if (window.location.pathname !== "/") return;
    } catch {}
    const store = useThreadStore.getState();
    const pid = store.ensurePendingId();
    // Viewport already holds this chat's messages: skip the import,
    // but leave lastSavedRef alone so the save effect persists them.
    tlog("lazy-adopt", pid);
    prevSelRef.current = pid;
    ownedRef.current = pid;
    store.setSelectedId(pid);
    store.clearPendingId();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, msgCount]);

  // Persist viewport messages to the selected chat (debounced, post-run).
  // The selection must match the URL (except fresh "/" chats not yet
  // navigated): never save one chat's viewport under another chat's id.
  useEffect(() => {
    if (!selectedId) return;
    if (importingRef.current) return;
    if (isRunning) return;
    if (useThreadStore.getState().tombstones.includes(selectedId)) return;
    try {
      const path = window.location.pathname;
      if (path !== "/" && path !== `/chat/${selectedId}`) return;
    } catch {}

    if (lastSavedRef.current?.sel === selectedId && lastSavedRef.current?.count === msgCount) return;
    // Never shrink a freshly restored/saved snapshot (mid-transition partial).
    if (
      lastSavedRef.current?.sel === selectedId &&
      msgCount < lastSavedRef.current.count &&
      Date.now() - lastSavedRef.current.at < 15000
    ) {
      return;
    }
    if (msgCount === 0) return; // empty viewport: nothing to save yet
    const t = setTimeout(async () => {
      try {
        const exported = aui.thread().export() as any;
        const repo = toPersistedRepository(
          exported,
          aui.thread().getState().messages as any,
        );
        if (persistedMessageCount(repo) === 0) return;
        const store = useThreadStore.getState();
        const known = store.threads.find((x) => x.id === selectedId);
        const saved = await saveThreadRepository(selectedId, repo, known?.title || "New Chat");
        tlog("saved", selectedId, "msgs=", persistedMessageCount(repo), "title=", saved?.title);
        ownedRef.current = selectedId;
        lastSavedRef.current = { sel: selectedId, count: msgCount, at: Date.now() };
        savedOnceRef.current.add(selectedId);
        // A pending "/" → chat navigation may now proceed safely.
        if (typeof window !== "undefined" && window.location.pathname === "/") {
          router.replace(`/chat/${selectedId}`);
        }
        if (saved?.title) {
          store.upsertMeta({
            id: selectedId,
            title: saved.title,
            createdAt: known?.createdAt || Date.now(),
            updatedAt: Date.now(),
            hasMessages: true,
          });
        }
        // Agent-generated title (background LLM, not a tool call): once per
        // chat, when the title is still heuristic and the first exchange is in.
        const hasAssistant = (exported?.messages ?? []).some(
          (m: any) => m?.message?.role === "assistant",
        );
        if (
          saved?.titleSource === "heuristic" &&
          hasAssistant &&
          !agentTitleRequestedRef.current.has(selectedId)
        ) {
          agentTitleRequestedRef.current.add(selectedId);
          void requestAgentTitle(selectedId);
          // Pick up the generated title shortly after.
          setTimeout(() => {
            if (useThreadStore.getState().selectedId === selectedId) {
              void useThreadStore.getState().refresh();
            }
          }, 9000);
        }
      } catch (e) {
        console.warn("[ThreadSync] save failed", e);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [selectedId, msgCount, isRunning, aui]);

  return null;
}
