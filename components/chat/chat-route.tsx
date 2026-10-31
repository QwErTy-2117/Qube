"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useWorkspaceStore } from "@/lib/workspace/store";

type ItemState = {
  id: string;
  remoteId?: string;
  title?: string;
  status?: string;
};

function useThreadListSnapshot() {
  const isLoading = useAuiState((s) => (s.threads as any)?.isLoading ?? true);
  const items = useAuiState(
    (s) => ((s.threads as any)?.threadItems ?? []) as ItemState[],
  );
  return { isLoading, items };
}

/** Selects the chat from the URL (/chat/[id]); bounces home when unknown. */
export function ChatRoute({ id }: { id: string }) {
  const aui = useAui();
  const router = useRouter();
  const { isLoading, items } = useThreadListSnapshot();

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let mainId: string | undefined;
    let mainRemote: string | undefined;
    try {
      mainId = aui.threads().getState().mainThreadId;
    } catch {}
    try {
      mainRemote = aui.threadListItem().getState().remoteId;
    } catch {}
    if (mainId === id || mainRemote === id) return;
    const known = items.some((t) => t?.id === id || t?.remoteId === id);
    if (!known && !isLoading) {
      // Only bounce for server ids (stable): local/mapping ids may simply
      // not be listed yet, and bouncing them destroys fresh chats.
      if (/^thread_[0-9]+/.test(id)) {
        router.replace("/");
        return;
      }
    }
    // switchToThread is async: a sync try/catch misses its rejection
    // ("Thread not found" for deleted/unknown ids). Unknown ids fall back
    // to a fresh chat — never an error overlay.
    Promise.resolve()
      .then(() => aui.threads().switchToThread(id))
      .catch(() => {
        if (cancelled) return;
        try {
          Promise.resolve(aui.threads().switchToNewThread()).catch(() => {});
        } catch {}
        try {
          router.replace("/");
        } catch {}
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isLoading, items.length]);

  return null;
}

/**
 * Keeps the URL glued to the main thread (reactively — never read thread
 * ids imperatively after an action, those snapshots go stale).
 * - Fresh "/" landing always opens a pristine composer (per-thread drafts
 *   are preserved by the runtime, so nothing is lost). The landing's own
 *   thread is tracked so only user-created chats navigate away.
 * - Everywhere else the URL follows the main thread.
 */
export function ThreadUrlSync() {
  const aui = useAui();
  const router = useRouter();
  const pathname = usePathname();
  const mainId = useAuiState((s) => (s.threads as any)?.mainThreadId as string | undefined);
  const mainItem = useAuiState((s) => (s as any).threadListItem as ItemState | undefined);
  const { isLoading, items } = useThreadListSnapshot();

  // Fresh landing (or back-to-/): pristine composer, drafts preserved per thread.
  useEffect(() => {
    if (pathname !== "/") {
      landingMainRef.current = undefined;
      return;
    }
    if (landingMainRef.current === undefined) {
      try {
        landingMainRef.current = aui.threads().getState().mainThreadId ?? null;
      } catch {
        landingMainRef.current = null;
      }
    }
    try {
      Promise.resolve(aui.threads().switchToNewThread()).catch(() => {});
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // If the main thread vanished (deleted), fall back to latest or fresh.
  useEffect(() => {
    if (isLoading || !mainId) return;
    if (pathname === "/") return;
    const gone =
      mainItem?.status !== "new" &&
      !items.some((t) => t?.id === mainId || t?.remoteId === mainId);
    if (!gone) return;
    const regular = items.filter(
      (t) => t && t.status !== "archived" && t.status !== "deleted" && t.status !== "new",
    );
    // Async switches can still reject (thread deleted between list and
    // switch) — always land on a fresh chat, never an error overlay.
    try {
      const target =
        regular.length > 0
          ? Promise.resolve().then(() => aui.threads().switchToThread(regular[0].id))
          : Promise.resolve().then(() => aui.threads().switchToNewThread());
      target.catch(() => {
        try {
          Promise.resolve(aui.threads().switchToNewThread()).catch(() => {});
        } catch {}
      });
    } catch {
      try {
        Promise.resolve(aui.threads().switchToNewThread()).catch(() => {});
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainId, pathname, isLoading, items.length]);

  // URL follows the main thread — but only on genuine main *changes*.
  // First runs, re-renders and StrictMode repeats never navigate, so deep
  // links and fresh landings are never clobbered (ChatRoute owns those).
  // landingMainRef tracks the "/" landing's own thread so pristine landings
  // stay put while initialized chats navigate to their URL.
  const prevMainRef = useRef<string | undefined>(undefined);
  const landingMainRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevMainRef.current;
    if (mainId) prevMainRef.current = mainId;
    if (!mainId) return;
    const want = `/chat/${mainItem?.remoteId ?? mainId}`;
    if (pathname === want) {
      landingMainRef.current = mainId;
      return;
    }
    if (pathname === "/") {
      if (landingMainRef.current === undefined) {
        landingMainRef.current = mainId;
        return;
      }
      // Stay only while the landing composer is pristine (its own new
      // thread). Anything initialized — or any other thread — gets a URL.
      if (mainId === landingMainRef.current && mainItem?.status === "new") return;
      landingMainRef.current = mainId;
      router.push(want);
      return;
    }
    if (prev === undefined || prev === mainId) return;
    landingMainRef.current = mainId;
    router.push(want);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainId, mainItem?.remoteId, mainItem?.status, pathname]);

  return null;
}

/**
 * Closes the live browser panel on genuine thread changes (new chat opened
 * or switched to another chat). The browser mirrors a live session tied to
 * the previous chat's agent activity, so it must not linger into the new
 * chat. Document artifacts are left alone; the agent reopens the browser
 * via BrowserAutoOpener when the new chat actually browses.
 * First mount and re-renders never close (same prev-ref discipline as
 * ThreadUrlSync above).
 */
export function WorkspaceThreadReset() {
  const mainId = useAuiState((s) => (s.threads as any)?.mainThreadId as string | undefined);
  const prevMainRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevMainRef.current;
    if (mainId) prevMainRef.current = mainId;
    if (!mainId) return;
    if (prev === undefined || prev === mainId) return;
    try {
      const st = useWorkspaceStore.getState();
      if (st.open && st.artifact?.kind === "browser") st.closeWorkspace();
    } catch {}
  }, [mainId]);

  return null;
}
