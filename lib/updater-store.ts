import { create } from "zustand";
import type { UpdateInfo } from "./updater";

type UpdaterState = {
  available: boolean;
  info: UpdateInfo | null;
  showToast: boolean;
  checking: boolean;
  downloading: boolean;
  progress: number | null;
  error: string | null;
  lastCheckedAt: number | null;
  showUpToDate: boolean;

  setAvailable: (info: UpdateInfo | null) => void;
  setShowToast: (v: boolean) => void;
  setChecking: (v: boolean) => void;
  setDownloading: (v: boolean) => void;
  setProgress: (v: number | null) => void;
  setError: (v: string | null) => void;
  setLastCheckedAt: (v: number) => void;
  setShowUpToDate: (v: boolean) => void;
  dismiss: () => void;
  reset: () => void;
};

export const useUpdaterStore = create<UpdaterState>((set) => ({
  available: false,
  info: null,
  showToast: false,
  checking: false,
  downloading: false,
  progress: null,
  error: null,
  lastCheckedAt: null,
  showUpToDate: false,

  setAvailable: (info) =>
    set({
      available: !!info,
      info,
      showToast: !!info,
      error: null,
    }),
  setShowToast: (v) => set({ showToast: v }),
  setChecking: (v) => set({ checking: v }),
  setDownloading: (v) => set({ downloading: v }),
  setProgress: (v) => set({ progress: v }),
  setError: (v) => set({ error: v }),
  setLastCheckedAt: (v) => set({ lastCheckedAt: v }),
  setShowUpToDate: (v) => set({ showUpToDate: v }),
  dismiss: () => set({ showToast: false }),
  reset: () =>
    set({
      available: false,
      info: null,
      showToast: false,
      checking: false,
      downloading: false,
      progress: null,
      error: null,
      showUpToDate: false,
    }),
}));
