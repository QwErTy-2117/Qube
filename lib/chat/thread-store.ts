"use client";

import { create } from "zustand";

export const EXPAND_KEY = "qube-sidebar-expanded";

export function loadExpanded(): boolean {
  try {
    return localStorage.getItem(EXPAND_KEY) === "1";
  } catch {
    return false;
  }
}

type ThreadStore = {
  expanded: boolean;
  searchOpen: boolean;
  renamingId: string | null;
  setExpanded: (v: boolean) => void;
  toggleExpanded: () => void;
  setSearchOpen: (v: boolean) => void;
  setRenamingId: (id: string | null) => void;
};

export const useThreadStore = create<ThreadStore>((set, get) => ({
  // Always start collapsed so server HTML and first client render match
  // (hydration-safe). The persisted preference is applied post-mount.
  expanded: false,
  searchOpen: false,
  renamingId: null,

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
}));
