"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  PlusIcon,
  XIcon,
  Trash2Icon,
  CheckIcon,
  Loader2Icon,
  FolderIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface AllowedDirEntry {
  id: string;
  path: string;
  access: "read" | "write";
  addedAt: number;
  source: "chat" | "settings";
}

export function AllowedDirectoriesSection({ onDialogOpenChange }: { onDialogOpenChange?: (open: boolean) => void }) {
  const [dirs, setDirs] = useState<AllowedDirEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AllowedDirEntry | null>(null);

  const notify = useCallback(
    (open: boolean) => {
      try {
        onDialogOpenChange?.(open);
      } catch {}
    },
    [onDialogOpenChange]
  );

  useEffect(() => {
    notify(managerOpen || deleteTarget !== null);
  }, [managerOpen, deleteTarget, notify]);

  const persist = useCallback(async (next: AllowedDirEntry[]) => {
    setDirs(next);
    try {
      localStorage.setItem("qube-allowed-directories", JSON.stringify(next));
    } catch {}
    try {
      const res = await fetch("/api/permissions/dirs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dirs: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Save failed (${res.status})`);
      }
      if (Array.isArray(data.dirs)) {
        setDirs((data.dirs as AllowedDirEntry[]).map((d) => ({ ...d, access: "write" as const })));
        try {
          localStorage.setItem("qube-allowed-directories", JSON.stringify(data.dirs));
        } catch {}
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      // Refresh from server so a rejected entry doesn't stick in the UI.
      try {
        const res = await fetch("/api/permissions/dirs");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.dirs)) setDirs(data.dirs);
        }
      } catch {}
    }
    window.dispatchEvent(new Event("qube-allowed-dirs-changed"));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/permissions/dirs");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.dirs)) {
            setDirs((data.dirs as AllowedDirEntry[]).map((d) => ({ ...d, access: "write" as const })));
            try {
              localStorage.setItem("qube-allowed-directories", JSON.stringify(data.dirs));
            } catch {}
            setLoaded(true);
            return;
          }
        }
      } catch {}
      try {
        const stored = localStorage.getItem("qube-allowed-directories");
        if (stored) setDirs((JSON.parse(stored) as AllowedDirEntry[]).map((d) => ({ ...d, access: "write" as const })));
      } catch {}
      setLoaded(true);
    })();
  }, []);

  const handleAdd = async () => {
    const raw = newPath.trim();
    if (!raw) {
      setError("Enter a folder path.");
      return;
    }
    if (!raw.startsWith("/") && !raw.startsWith("~") && !/^[a-zA-Z]:[\\/]/.test(raw)) {
      setError("Use an absolute path or ~/ (e.g. ~/Documents).");
      return;
    }
    try {
      const res = await fetch(`/api/permissions/dirs?check=${encodeURIComponent(raw)}`);
      const data = await res.json().catch(() => null);
      if (data && data.isDirectory === false) {
        setError(data.error || "That is a file, not a folder.");
        return;
      }
    } catch {}
    setError(null);
    persist([
      ...dirs,
      {
        id: `dir_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        path: raw,
        access: "write",
        addedAt: Date.now(),
        source: "settings",
      },
    ]);
    setNewPath("");
  };

  const handleBrowse = async () => {
    const verifyFolder = async (picked: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/permissions/dirs?check=${encodeURIComponent(picked)}`);
        const data = await res.json().catch(() => null);
        if (data && data.isDirectory === false) {
          setError(data.error || "That is a file, not a folder — pick a folder.");
          return false;
        }
      } catch {}
      return true;
    };
    // Native folder picker (Tauri desktop)…
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Choose a folder" });
      if (typeof selected === "string" && selected.trim()) {
        const ok = await verifyFolder(selected.trim());
        if (!ok) return;
        setNewPath(selected.trim());
        setError(null);
        return;
      }
      if (selected) return;
    } catch {
      // …fall through to the web fallback below when not in Tauri.
    }
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.hidden = true;
      input.setAttribute("webkitdirectory", "");
      document.body.appendChild(input);
      input.onchange = () => {
        const files = input.files;
        const first = files?.[0] as (File & { webkitRelativePath?: string }) | undefined;
        const rel = first?.webkitRelativePath || "";
        const root = rel.split("/")[0] || "";
        document.body.removeChild(input);
        if (root) {
          // Browsers don't reveal absolute paths — anchor at home for review.
          setNewPath(`~/${root}`);
          setError(null);
        }
      };
      input.oncancel = () => {
        try { document.body.removeChild(input); } catch {}
      };
      input.click();
    } catch {
      setError("Could not open the folder picker — type the path instead.");
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    persist(dirs.filter((d) => d.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <label className="text-sm font-semibold text-foreground">Allowed directories</label>
          <p className="text-xs text-muted-foreground">
            Folders the agent can access outside the workspace without asking. “Always allow” in chat saves folders here too.
          </p>
        </div>
        <Button
          onClick={() => {
            setError(null);
            setManagerOpen(true);
          }}
          variant="outline"
          className="rounded-full font-semibold px-4 h-8 flex items-center gap-1.5 shrink-0"
          size="sm"
        >
          <PlusIcon className="size-3.5" />
          {dirs.length > 0 ? "Manage" : "Add"}
        </Button>
      </div>
      {loaded && dirs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {dirs.slice(0, 6).map((d) => (
            <span
              key={d.id}
              title={`${d.path} (${d.access})`}
              className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-[11px] font-mono border border-border/60 bg-muted/20 text-foreground/80 max-w-full"
            >
              <FolderIcon className="size-2.5 text-muted-foreground shrink-0" />
              <span className="truncate max-w-[220px]">{d.path}</span>
            </span>
          ))}
          {dirs.length > 6 && (
            <span className="text-[11px] text-muted-foreground/60 py-1">+{dirs.length - 6} more</span>
          )}
        </div>
      )}

      <Dialog open={managerOpen} onOpenChange={(v) => { if (!v) setManagerOpen(false); }}>
        <DialogContent className="sm:max-w-lg rounded-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Allowed directories</DialogTitle>
            <DialogDescription>
              Folders the agent may read and write without asking.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 py-2">
            <div className="relative flex-1">
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                placeholder="~/Documents"
                className="w-full h-9 rounded-full border border-border bg-background pl-4 pr-11 text-xs outline-none focus:border-ring transition-colors placeholder:text-muted-foreground/40 font-mono"
              />
              <button
                onClick={handleAdd}
                title="Add directory"
                className="absolute right-1 top-1/2 -translate-y-1/2 size-7 flex items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90 cursor-pointer"
              >
                <PlusIcon className="size-4" />
              </button>
            </div>
            <button
              onClick={handleBrowse}
              title="Browse for a folder"
              className="size-9 shrink-0 flex items-center justify-center rounded-full border border-border bg-background hover:bg-muted/60 transition-colors cursor-pointer"
            >
              <FolderIcon className="size-4" />
            </button>
          </div>
          {error && (
            <div className="text-xs text-red-500 bg-red-500/10 rounded-xl px-3 py-2 border border-red-500/20">{error}</div>
          )}

          <div className="flex-1 overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden min-h-0">
            {!loaded ? (
              <div className="flex items-center justify-center py-12">
                <Loader2Icon className="size-5 animate-spin text-muted-foreground/40" />
              </div>
            ) : dirs.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-border/50 text-center text-xs text-muted-foreground/70">
                No allowed directories yet. Add one above, or use “Always allow” when the agent asks in chat.
              </div>
            ) : (
              <div className="space-y-2 py-1">
                <AnimatePresence initial={false}>
                  {dirs.map((d) => (
                    <motion.div
                      key={d.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/10"
                    >
                      <FolderIcon className="size-4 text-muted-foreground/60 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-mono truncate text-foreground" title={d.path}>{d.path}</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                          {d.source === "chat" ? "Approved in chat" : "Added in settings"}
                        </p>
                      </div>
                      <button
                        onClick={() => setDeleteTarget(d)}
                        type="button"
                        className="size-7 flex items-center justify-center rounded-lg transition-colors text-muted-foreground hover:text-red-500 shrink-0 cursor-pointer"
                        title="Remove"
                      >
                        <Trash2Icon className="size-3.5" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          <DialogFooter className="pt-2">
            <div className="w-fit ml-auto flex items-center gap-2 rounded-full border border-border/60 bg-muted/10 hover:bg-muted/20 transition-colors px-1.5 py-1.5 shrink-0">
              <button
                onClick={() => setManagerOpen(false)}
                type="button"
                className="flex items-center justify-center size-8 rounded-full text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                title="Close"
              >
                <XIcon className="size-4" />
              </button>
              <Button onClick={() => setManagerOpen(false)} className="rounded-full font-semibold h-8 px-4" size="sm">
                Done
              </Button>
            </div>
          </DialogFooter>

          <Dialog open={deleteTarget !== null} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
            <DialogContent className="sm:max-w-sm rounded-3xl">
              <DialogHeader>
                <DialogTitle>Remove directory</DialogTitle>
                <DialogDescription>
                  Stop allowing access to {deleteTarget?.path}? The agent will ask again before accessing it.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <div className="flex items-center gap-2 ml-auto">
                  <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)} className="rounded-full h-8 px-4">
                    Cancel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDelete}
                    className="rounded-full text-red-500 border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5 px-3 h-8"
                  >
                    <Trash2Icon className="size-3.5" />
                    Remove
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>
    </div>
  );
}
