"use client";

import { create } from "zustand";
import {
  fetchThreads,
  renameThreadServer,
  deleteThreadServer,
  type ThreadMeta,
} from "./threads-client";

export const EXPAND_KEY = "qube-sidebar-expanded";

export function loadExpanded(): boolean {
  try {
    return localStorage.getItem(EXPAND_KEY) === "1";
  } catch {
    return false;
  }
}

type ThreadStore = {
  threads: ThreadMeta[];
  loaded: boolean;
  loading: boolean;
  expanded: boolean;
  searchOpen: boolean;
  renamingId: string | null;
  /** Server thread id currently shown in the chat viewport. */
  selectedId: string | null;
  /**
   * Pre-allocated id for the chat being composed. No server row exists until
   * the first real save, so empty chats are never persisted.
   */
  pendingId: string | null;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  setExpanded: (v: boolean) => void;
  toggleExpanded: () => void;
  setSearchOpen: (v: boolean) => void;
  setRenamingId: (id: string | null) => void;
  setSelectedId: (id: string | null) => void;
  ensurePendingId: () => string;
  clearPendingId: () => void;
  requestOpen: (id: string) => void;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  upsertMeta: (meta: ThreadMeta) => void;
};

export const useThreadStore = create<ThreadStore>((set, get) => ({
  threads: [],
  loaded: false,
  loading: false,
  // Always start collapsed so server HTML and first client render match
  // (hydration-safe). The persisted preference is applied post-mount.
  expanded: false,
  searchOpen: false,
  renamingId: null,
  selectedId: null,
  pendingId: null,

  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const threads = await fetchThreads();
      set({ threads, loaded: true });
    } catch {
      set({ loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  refresh: async () => {
    try {
      const threads = await fetchThreads();
      set({ threads, loaded: true });
    } catch {}
  },

  setExpanded: (v: boolean) => {
    set({ expanded: v });
    try {
      localStorage.setItem(EXPAND_KEY, v ? "1" : "0");
    } catch {}
  },

  toggleExpanded: () => {
    const v = !get().expanded;
    set({ expanded: v });
    try {
      localStorage.setItem(EXPAND_KEY, v ? "1" : "0");
    } catch {}
  },

  setSearchOpen: (v: boolean) => set({ searchOpen: v }),
  setRenamingId: (id: string | null) => set({ renamingId: id }),
  setSelectedId: (id: string | null) => set({ selectedId: id }),

  ensurePendingId: () => {
    const existing = get().pendingId;
    if (existing) return existing;
    const id = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    set({ pendingId: id });
    return id;
  },

  clearPendingId: () => {
    set({ pendingId: null });
  },

  requestOpen: (id: string) => set({ selectedId: id }),

  rename: async (id: string, title: string) => {
    const clean = title.trim().slice(0, 120);
    if (!clean) return;
    set((s) => ({
      threads: s.threads.map((t) => (t.id === id ? { ...t, title: clean } : t)),
      renamingId: null,
    }));
    try {
      await renameThreadServer(id, clean);
    } catch {
      get().refresh();
    }
  },

  remove: async (id: string) => {
    const wasSelected = get().selectedId === id;
    set((s) => ({ threads: s.threads.filter((t) => t.id !== id) }));
    try {
      await deleteThreadServer(id);
    } catch {
      get().refresh();
    }
    if (wasSelected) {
      const remaining = get().threads;
      get().setSelectedId(remaining.length > 0 ? remaining[0].id : null);
    }
  },

  upsertMeta: (meta: ThreadMeta) =>
    set((s) => {
      const exists = s.threads.some((t) => t.id === meta.id);
      if (exists) {
        return {
          threads: s.threads.map((t) => (t.id === meta.id ? { ...t, ...meta } : t)),
        };
      }
      return { threads: [meta, ...s.threads] };
    }),
}));
