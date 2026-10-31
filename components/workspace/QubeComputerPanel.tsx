"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { XIcon, MonitorIcon, GlobeIcon, HardDriveIcon, RefreshCwIcon, RotateCcwIcon, PaperclipIcon, DownloadIcon } from "lucide-react";
import { useWorkspaceStore } from "@/lib/workspace/store";
import { ArtifactError, ArtifactLoading } from "@/components/artifact/states";
import { formatBytes } from "@/lib/artifact/kinds";

type ActivityEntry = { at: string; kind: string; summary: string; detail?: string };
type FileEntry = { name: string; path: string; type: "file" | "dir"; size: number };

type ComputerPayload = {
  ok: boolean;
  error?: string;
  session: { id: string; createdAt: string; lastActiveAt: string; resets: number };
  paths: { home: string; attachments: string; downloads: string };
  usage: { bytes: number; files: number; truncated: boolean };
  attachments: number;
  downloads: number;
  files: FileEntry[];
  browser: { available: boolean; running: boolean; persistent: boolean };
  activity: ActivityEntry[];
};

const KIND_DOT: Record<string, string> = {
  exec: "bg-emerald-500",
  file: "bg-sky-500",
  attachment: "bg-violet-500",
  browser: "bg-amber-500",
  reset: "bg-rose-500",
  session: "bg-muted-foreground/50",
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/**
 * Qube Computer side panel — the real session, not a mock: live session id,
 * disk usage, the files actually in the computer, its browser state, and the
 * activity journal the tools write while they work. The only control is the
 * close X in the bottom-left corner (plus an explicit reset in the header,
 * which always asks first).
 */
export function QubeComputerPanel() {
  const open = useWorkspaceStore((s) => s.open);
  const artifact = useWorkspaceStore((s) => s.artifact);
  const width = useWorkspaceStore((s) => s.width);
  const setWidth = useWorkspaceStore((s) => s.setWidth);
  const closeWorkspace = useWorkspaceStore((s) => s.closeWorkspace);
  const reduceMotion = useReducedMotion();
  const show = open && artifact?.kind === "computer";

  const [data, setData] = useState<ComputerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/computer", { cache: "no-store" });
      const json = (await res.json()) as ComputerPayload & { error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error || `Load failed (${res.status})`);
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll only while the panel is visible — an idle app does no work.
  useEffect(() => {
    if (!show) return;
    setLoading(true);
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [show, load]);

  useEffect(() => {
    const onDrag = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setWidth(d.startW + (d.startX - e.clientX));
    };
    const endDrag = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", endDrag);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", endDrag);
    return () => {
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", endDrag);
    };
  }, [setWidth]);

  const reset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setResetting(true);
    setConfirmReset(false);
    try {
      await fetch("/api/computer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset", keepAttachments: true }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting(false);
    }
  };

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.aside
          key="computer-panel"
          initial={{ opacity: 0, x: reduceMotion ? 0 : 48 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduceMotion ? 0 : 48 }}
          transition={{ duration: reduceMotion ? 0.01 : 0.22, ease: "easeOut" }}
          style={{ width }}
          aria-label="Qube Computer"
          className="relative flex h-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-[0_8px_32px_-12px_rgba(0,0,0,0.18)] dark:border-border/60"
        >
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              dragRef.current = { startX: e.clientX, startW: width };
              document.body.style.cursor = "ew-resize";
              document.body.style.userSelect = "none";
            }}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Qube Computer panel"
            className="absolute top-0 bottom-0 left-0 z-20 w-2 cursor-ew-resize touch-none"
          >
            <div className="mx-auto mt-[45%] h-10 w-1 rounded-full bg-border/70 opacity-0 transition hover:opacity-100" />
          </div>

          <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-3">
            <MonitorIcon className="size-4 text-[#2f7cf6]" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[13px] font-semibold text-foreground">Qube Computer</h2>
              <p className="truncate text-[11px] text-muted-foreground">
                {data ? `Session ${data.session.id.slice(0, 8)} · persists across restarts` : "Connecting…"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void reset()}
              disabled={resetting}
              onBlur={() => setConfirmReset(false)}
              className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:opacity-50"
              aria-label={confirmReset ? "Confirm computer reset" : "Reset the Qube Computer"}
            >
              <RotateCcwIcon className="size-3" />
              {resetting ? "Resetting…" : confirmReset ? "Confirm reset" : "Reset"}
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && !data && <ArtifactLoading label="Reading the computer…" />}
            {!loading && error && !data && <ArtifactError title="Qube Computer unavailable" message={error} />}
            {data && (
              <div className="space-y-4 p-4">
                <section aria-label="Usage" className="grid grid-cols-2 gap-2">
                  <Stat icon={<HardDriveIcon className="size-3.5" />} label="Disk" value={`${formatBytes(data.usage.bytes)} · ${data.usage.files} files`} />
                  <Stat icon={<PaperclipIcon className="size-3.5" />} label="Attachments" value={String(data.attachments)} />
                  <Stat icon={<DownloadIcon className="size-3.5" />} label="Downloads" value={String(data.downloads)} />
                  <Stat
                    icon={<GlobeIcon className="size-3.5" />}
                    label="Browser"
                    value={data.browser.running ? "Running" : data.browser.available ? "Ready" : "No Chrome found"}
                  />
                </section>

                <section aria-label="Files in the computer">
                  <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Files</h3>
                  {data.files.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-[12px] text-muted-foreground">
                      The computer is empty. Ask Qube to build, download or run something — it happens here.
                    </p>
                  ) : (
                    <ul className="space-y-0.5">
                      {data.files.map((file) => (
                        <li key={file.path} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12px] hover:bg-muted/60">
                          <span className={file.type === "dir" ? "text-[#2f7cf6]" : "text-muted-foreground"} aria-hidden>
                            {file.type === "dir" ? "▸" : "·"}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-foreground/90">{file.path}</span>
                          {file.type === "file" && <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(file.size)}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {data.usage.truncated && <p className="mt-1 text-[11px] text-muted-foreground">Showing a partial listing.</p>}
                </section>

                <section aria-label="Activity">
                  <div className="mb-1.5 flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Activity</h3>
                    <button
                      type="button"
                      onClick={() => void load()}
                      className="rounded p-1 text-muted-foreground transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                      aria-label="Refresh activity"
                    >
                      <RefreshCwIcon className="size-3.5" />
                    </button>
                  </div>
                  {data.activity.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">Nothing has run yet.</p>
                  ) : (
                    <ol className="space-y-1.5">
                      {[...data.activity].reverse().map((entry, index) => (
                        <li key={`${entry.at}-${index}`} className="flex gap-2 text-[12px]">
                          <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${KIND_DOT[entry.kind] || "bg-muted-foreground/50"}`} aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="break-words font-mono text-[11.5px] leading-snug text-foreground/90">{entry.summary}</p>
                            <p className="text-[10.5px] text-muted-foreground">
                              {timeAgo(entry.at)} ago{entry.detail ? ` · ${entry.detail}` : ""}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>
            )}
          </div>

          {/* The only control in this panel: close, bottom-left. */}
          <div className="pointer-events-none absolute bottom-3 left-3 z-30">
            <button
              type="button"
              onClick={closeWorkspace}
              aria-label="Close Qube Computer"
              className="pointer-events-auto flex size-9 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-lg backdrop-blur transition hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
        {icon}
        {label}
      </div>
      <p className="mt-0.5 truncate text-[12px] text-foreground/90">{value}</p>
    </div>
  );
}
