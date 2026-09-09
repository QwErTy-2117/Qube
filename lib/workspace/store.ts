"use client";

import { create } from "zustand";
import type { WorkspaceArtifact, WorkspaceSelection, NewSelection } from "./types";

type WorkspaceState = {
  open: boolean;
  artifact: WorkspaceArtifact | null;
  tabs: WorkspaceArtifact[];
  selections: WorkspaceSelection[];
  width: number;
  minimized: boolean;
  openWorkspace: (a: WorkspaceArtifact) => void;
  closeWorkspace: () => void;
  setMinimized: (v: boolean) => void;
  setWidth: (w: number) => void;
  addSelection: (s: NewSelection) => void;
  removeSelection: (id: string) => void;
  clearSelections: () => void;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;
};

const WIDTH_KEY = "qube-workspace-width";
const OPEN_KEY = "qube-workspace-open";

function loadWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    const n = raw ? Number(raw) : 480;
    if (Number.isFinite(n)) return Math.min(720, Math.max(340, n));
  } catch {}
  return 480;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  open: false,
  artifact: null,
  tabs: [],
  selections: [],
  width: typeof window !== "undefined" ? loadWidth() : 480,
  minimized: false,
  openWorkspace: (a) =>
    set((s) => {
      const exists = s.tabs.find((t) => t.id === a.id);
      const tabs = exists ? s.tabs : [...s.tabs.slice(-7), a];
      try {
        // Browser visibility is driven by agent browser-tool use only —
        // never persist it, so reloads don't resurrect the browser tab.
        if (a.kind === "browser") {
          const docs = tabs.filter((t) => t.kind !== "browser");
          const docArtifact = docs.length > 0 ? { artifact: docs[docs.length - 1], tabs: docs } : null;
          if (docArtifact) localStorage.setItem(OPEN_KEY, JSON.stringify(docArtifact));
          else localStorage.removeItem(OPEN_KEY);
        } else {
          localStorage.setItem(OPEN_KEY, JSON.stringify({ artifact: a, tabs }));
        }
      } catch {}
      return { open: true, minimized: false, artifact: a, tabs, selections: s.artifact?.id === a.id ? s.selections : [] };
    }),
  closeWorkspace: () =>
    set(() => {
      try { localStorage.removeItem(OPEN_KEY); } catch {}
      return { open: false, artifact: null, selections: [] };
    }),
  setMinimized: (v) => set({ minimized: v }),
  setWidth: (w) =>
    set(() => {
      const clamped = Math.min(720, Math.max(340, Math.round(w)));
      try { localStorage.setItem(WIDTH_KEY, String(clamped)); } catch {}
      return { width: clamped };
    }),
  addSelection: (s) =>
    set((st) => ({
      selections: [...st.selections.slice(-9), { ...s, id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, at: Date.now() } as WorkspaceSelection],
    })),
  removeSelection: (id) => set((st) => ({ selections: st.selections.filter((x) => x.id !== id) })),
  clearSelections: () => set({ selections: [] }),
  switchTab: (id) =>
    set((s) => {
      const found = s.tabs.find((t) => t.id === id);
      if (!found) return s;
      return { artifact: found, open: true, minimized: false, selections: [] };
    }),
  closeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const artifact = s.artifact?.id === id ? (tabs[tabs.length - 1] ?? null) : s.artifact;
      return { tabs, artifact, open: tabs.length > 0 && !!artifact, selections: s.artifact?.id === id ? [] : s.selections };
    }),
}));

export function openBrowserWorkspace() {
  useWorkspaceStore.getState().openWorkspace({ id: "browser:session", kind: "browser", title: "Browser" });
}

export function openDocumentWorkspace(input: { filePath: string; filename?: string; downloadUrl?: string; kind?: WorkspaceArtifact["kind"] }) {  const filename = input.filename || input.filePath.split("/").pop() || input.filePath;
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  let kind = input.kind;
  if (!kind) {
    if (ext === "pdf") kind = "pdf";
    else if (["doc", "docx", "odt", "rtf"].includes(ext)) kind = "doc";
    else if (["xls", "xlsx", "ods", "csv"].includes(ext)) kind = "sheet";
    else if (["ppt", "pptx", "odp"].includes(ext)) kind = "slides";
    else if (["js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "css", "html", "json", "yml", "yaml", "toml", "sh", "sql", "xml"].includes(ext)) kind = "code";
    else kind = "text";
  }
  const encodePath = (p: string) => p.split("/").map((x) => encodeURIComponent(x)).join("/");
  const downloadUrl = input.downloadUrl || `/api/files/${encodePath(input.filePath)}`;
  useWorkspaceStore.getState().openWorkspace({ id: `doc:${input.filePath}`, kind, title: filename, filePath: input.filePath, downloadUrl });
}
