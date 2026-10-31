"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  Redo2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ArtifactError, ArtifactLoading } from "../states";
import {
  colName,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  isFormula,
  padGrid,
  rawCell,
  resolveCell,
  toSavePayload,
  type SheetGrid,
} from "@/lib/workspace/sheet-ops";

type ServerSheet = {
  name: string;
  rowCount?: number;
  colCount?: number;
  rows: string[][];
  formulas?: Record<string, string>;
};

type Payload = {
  ok?: boolean;
  sheets?: ServerSheet[];
  filename?: string;
  error?: string;
};

const ROW_H = 26;
const HEADER_H = 30;
const ROW_HEADER_W = 52;
const COL_W = 104;
const OVERSCAN = 6;
const MIN_ROWS = 60;
const MIN_COLS = 10;

function toGrids(sheets: ServerSheet[]): SheetGrid[] {
  return sheets.map((sheet) => {
    const rows = sheet.rows.map((r) => r.map((c) => String(c ?? "")));
    // Re-apply formulas the server surfaced separately.
    if (sheet.formulas) {
      for (const [key, formula] of Object.entries(sheet.formulas)) {
        const [r, c] = key.split(":").map(Number);
        while (rows.length <= r) rows.push([]);
        while (rows[r].length <= c) rows[r].push("");
        rows[r][c] = formula.startsWith("=") ? formula : `=${formula}`;
      }
    }
    const padded = padGrid(rows, MIN_ROWS, MIN_COLS);
    return { name: sheet.name || "Sheet1", rows: padded };
  });
}

export function SheetViewer({ filePath }: { filePath: string }) {
  const [grids, setGrids] = useState<SheetGrid[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; draft: string } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(480);
  const [menuOpen, setMenuOpen] = useState(false);
  const history = useRef<{ past: SheetGrid[][]; future: SheetGrid[][] }>({ past: [], future: [] });
  const scrollRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const latestRef = useRef<SheetGrid[]>([]);
  latestRef.current = grids;

  const load = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/document?path=${encodeURIComponent(filePath)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as Payload;
      if (!res.ok || json.ok === false) throw new Error(json.error || `Load failed (${res.status})`);
      if (signal?.cancelled) return;
      const next = toGrids(json.sheets || []);
      setGrids(next);
      setActiveSheet(0);
      setSelection({ r: 0, c: 0 });
      history.current = { past: [], future: [] };
      dirtyRef.current = false;
    } catch (e) {
      if (!signal?.cancelled) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    const flag = { cancelled: false };
    void load(flag);
    return () => {
      flag.cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportH(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading]);

  const sheet = grids[activeSheet];

  const save = useCallback(
    async (next: SheetGrid[]) => {
      setStatus("saving");
      setSaveError(null);
      try {
        const res = await fetch("/api/workspace/document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: filePath, sheets: toSavePayload(next) }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
        setStatus("saved");
        dirtyRef.current = false;
        setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1600);
      } catch (e) {
        setStatus("error");
        setSaveError(e instanceof Error ? e.message : "Save failed");
      }
    },
    [filePath],
  );

  const scheduleSave = useCallback(
    (next: SheetGrid[]) => {
      dirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(next), 650);
    },
    [save],
  );

  const apply = useCallback(
    (next: SheetGrid[], opts?: { save?: boolean }) => {
      history.current.past = [...history.current.past.slice(-49), latestRef.current];
      history.current.future = [];
      setGrids(next);
      if (opts?.save !== false) scheduleSave(next);
    },
    [scheduleSave],
  );

  // Refresh after the agent edits the file (same behaviour as other viewers).
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const commitCell = (r: number, c: number, value: string) => {
    if (!sheet) return;
    if (rawCell(sheet.rows, r, c) === value) {
      setEditing(null);
      return;
    }
    const next = grids.map((g, i) => {
      if (i !== activeSheet) return g;
      const rows = g.rows.map((row) => [...row]);
      while (rows.length <= r) rows.push([]);
      while (rows[r].length <= c) rows[r].push("");
      rows[r][c] = value;
      return { ...g, rows };
    });
    setEditing(null);
    apply(next);
  };

  const setSelectedValue = (value: string) => commitCell(selection.r, selection.c, value);

  const move = (dr: number, dc: number, extend = false) => {
    setSelection((prev) => {
      const r = Math.max(0, prev.r + dr);
      const c = Math.max(0, prev.c + dc);
      if (extend) setAnchor((a) => a ?? prev);
      else setAnchor(null);
      return { r, c };
    });
  };

  const undo = () => {
    const prev = history.current.past.pop();
    if (!prev) return;
    history.current.future.push(latestRef.current);
    setGrids(prev);
    scheduleSave(prev);
  };
  const redo = () => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(latestRef.current);
    setGrids(next);
    scheduleSave(next);
  };

  const structural = (op: "insertRowAbove" | "insertRowBelow" | "deleteRow" | "insertColLeft" | "insertColRight" | "deleteCol") => {
    if (!sheet) return;
    let updated: SheetGrid = sheet;
    switch (op) {
      case "insertRowAbove": updated = insertRow(sheet, selection.r); break;
      case "insertRowBelow": updated = insertRow(sheet, selection.r + 1); break;
      case "deleteRow": updated = deleteRow(sheet, selection.r); break;
      case "insertColLeft": updated = insertColumn(sheet, selection.c); break;
      case "insertColRight": updated = insertColumn(sheet, selection.c + 1); break;
      case "deleteCol": updated = deleteColumn(sheet, selection.c); break;
    }
    apply(
      grids.map((g, i) => (i === activeSheet ? updated : g)),
    );
    setMenuOpen(false);
  };

  const rangeLabel = useMemo(() => {
    if (!anchor) return `${colName(selection.c)}${selection.r + 1}`;
    const r1 = Math.min(anchor.r, selection.r);
    const r2 = Math.max(anchor.r, selection.r);
    const c1 = Math.min(anchor.c, selection.c);
    const c2 = Math.max(anchor.c, selection.c);
    if (r1 === r2 && c1 === c2) return `${colName(c1)}${r1 + 1}`;
    return `${colName(c1)}${r1 + 1}:${colName(c2)}${r2 + 1}`;
  }, [anchor, selection]);

  const rowCount = sheet?.rows.length ?? 0;
  const colCount = Math.max(MIN_COLS, ...(sheet?.rows.map((r) => r.length) ?? [MIN_COLS]));

  const startRow = Math.max(0, Math.floor((scrollTop - HEADER_H) / ROW_H) - OVERSCAN);
  const endRow = Math.min(rowCount, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN);

  const selectedFormula = sheet ? resolveCell(sheet.rows, selection.r, selection.c) : null;
  const formulaBarValue = editing
    ? editing.draft
    : selectedFormula?.formula
      ? `=${selectedFormula.formula}`
      : sheet
        ? rawCell(sheet.rows, selection.r, selection.c)
        : "";

  if (loading) return <ArtifactLoading label="Opening spreadsheet…" />;
  if (error) {
    return (
      <ArtifactError
        title="Couldn’t open this spreadsheet"
        message={error}
        action={
          <button
            onClick={() => void load()}
            className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            Try again
          </button>
        }
      />
    );
  }
  if (!sheet) return <ArtifactError title="No sheets found" message="This workbook has no readable worksheets." />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      {/* Sheet tabs + save state */}
      <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200 bg-neutral-50 px-2 py-1.5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex max-w-[58%] items-center gap-1 overflow-x-auto">
          {grids.map((g, i) => (
            <button
              key={`${g.name}-${i}`}
              type="button"
              onClick={() => {
                setActiveSheet(i);
                setSelection({ r: 0, c: 0 });
                setAnchor(null);
              }}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition",
                i === activeSheet
                  ? "bg-white text-neutral-900 shadow-xs ring-1 ring-neutral-200 dark:bg-neutral-800 dark:text-white dark:ring-neutral-700"
                  : "text-neutral-500 hover:bg-white/70 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-white",
              )}
            >
              {g.name}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {status === "saving" && (
          <span className="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            <Loader2Icon className="size-3 animate-spin" /> Saving
          </span>
        )}
        {status === "saved" && (
          <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            <CheckIcon className="size-3" /> Saved
          </span>
        )}
        {status === "error" && (
          <span className="max-w-[200px] truncate text-[11px] text-red-600 dark:text-red-400" title={saveError || undefined}>
            {saveError || "Save failed"}
          </span>
        )}
        <button
          type="button"
          onClick={undo}
          aria-label="Undo"
          className="flex size-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-200/70 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
        >
          <Undo2Icon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={redo}
          aria-label="Redo"
          className="flex size-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-200/70 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
        >
          <Redo2Icon className="size-3.5" />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-0.5 rounded-md px-2 py-1 text-[11px] font-medium text-neutral-600 transition hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Rows & columns <ChevronDownIcon className="size-3" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden="true" />
              <div
                role="menu"
                className="absolute top-full right-0 z-40 mt-1 w-48 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 text-[12px] shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
              >
                {[
                  { label: "Insert row above", op: "insertRowAbove" },
                  { label: "Insert row below", op: "insertRowBelow" },
                  { label: "Delete row", op: "deleteRow" },
                  { label: "Insert column left", op: "insertColLeft" },
                  { label: "Insert column right", op: "insertColRight" },
                  { label: "Delete column", op: "deleteCol" },
                ].map((item) => (
                  <button
                    key={item.op}
                    role="menuitem"
                    type="button"
                    onClick={() => structural(item.op as Parameters<typeof structural>[0])}
                    className="block w-full px-3 py-1.5 text-left text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Formula bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-2 py-1 dark:border-neutral-800 dark:bg-neutral-950">
        <span className="w-[68px] shrink-0 rounded border border-neutral-200 px-1.5 py-0.5 text-center font-mono text-[11px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
          {rangeLabel}
        </span>
        <span className="shrink-0 font-mono text-[12px] text-neutral-400 dark:text-neutral-500">fx</span>
        <input
          value={formulaBarValue}
          onChange={(e) => {
            // Editing in the formula bar operates on the selected cell.
            setEditing({ r: selection.r, c: selection.c, draft: e.target.value });
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commitCell(selection.r, selection.c, formulaBarValue);
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Escape") {
              setEditing(null);
              (e.target as HTMLInputElement).blur();
            }
          }}
          onBlur={() => {
            if (editing && (editing.r !== selection.r || editing.c !== selection.c || editing.draft !== formulaBarValue)) {
              commitCell(selection.r, selection.c, formulaBarValue);
            } else if (editing) {
              setEditing(null);
            }
          }}
          aria-label={`Value of cell ${rangeLabel}`}
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 font-mono text-[12px] text-neutral-900 outline-none focus:border-neutral-300 dark:text-neutral-100 dark:focus:border-neutral-600"
        />
        {selectedFormula?.error && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-red-600 dark:text-red-400">
            <XIcon className="size-3" /> {selectedFormula.display}
          </span>
        )}
      </div>

      {/* Grid */}
      <div
        ref={scrollRef}
        data-artifact-scroll
        role="grid"
        aria-label={`Spreadsheet ${sheet.name}`}
        aria-rowcount={rowCount}
        aria-colcount={colCount}
        tabIndex={0}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        onKeyDown={(e) => {
          if (editing) return;
          const mod = e.ctrlKey || e.metaKey;
          if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
            e.preventDefault();
            undo();
            return;
          }
          if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
            e.preventDefault();
            redo();
            return;
          }
          if (e.key === "ArrowDown") { e.preventDefault(); move(1, 0, e.shiftKey); }
          else if (e.key === "ArrowUp") { e.preventDefault(); move(-1, 0, e.shiftKey); }
          else if (e.key === "ArrowRight") { e.preventDefault(); move(0, 1, e.shiftKey); }
          else if (e.key === "ArrowLeft") { e.preventDefault(); move(0, -1, e.shiftKey); }
          else if (e.key === "Tab") { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); }
          else if (e.key === "Enter") {
            e.preventDefault();
            setEditing({ r: selection.r, c: selection.c, draft: rawCell(sheet.rows, selection.r, selection.c) });
          } else if (e.key === "Backspace" || e.key === "Delete") {
            e.preventDefault();
            setSelectedValue("");
          } else if (e.key.length === 1 && !mod && !e.altKey) {
            e.preventDefault();
            setEditing({ r: selection.r, c: selection.c, draft: e.key });
          }
        }}
        className="sheet-scroll min-h-0 flex-1 overflow-auto bg-white outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-neutral-300 dark:bg-neutral-950 dark:focus-visible:ring-neutral-700"
      >
        <div style={{ width: ROW_HEADER_W + colCount * COL_W, position: "relative" }}>
          {/* Column headers */}
          <div
            className="sticky top-0 z-20 flex border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900"
            style={{ height: HEADER_H }}
          >
            <div
              className="flex shrink-0 items-center justify-center border-r border-neutral-200 text-[10px] font-medium text-neutral-400 dark:border-neutral-800 dark:text-neutral-500"
              style={{ width: ROW_HEADER_W }}
            >
              #
            </div>
            {Array.from({ length: colCount }).map((_, c) => (
              <div
                key={c}
                className={cn(
                  "flex shrink-0 items-center justify-center border-r border-neutral-200 text-[11px] font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400",
                  selection.c === c && "bg-neutral-200/70 text-neutral-900 dark:bg-neutral-800 dark:text-white",
                )}
                style={{ width: COL_W }}
              >
                {colName(c)}
              </div>
            ))}
          </div>

          {/* Row spacers keep the scrollbar proportional with windowed rows */}
          <div style={{ height: startRow * ROW_H }} aria-hidden="true" />
          {Array.from({ length: Math.max(0, endRow - startRow) }).map((_, i) => {
            const r = startRow + i;
            const row = sheet.rows[r] ?? [];
            const selectedRow =
              anchor
                ? r >= Math.min(anchor.r, selection.r) && r <= Math.max(anchor.r, selection.r)
                : r === selection.r;
            return (
              <div key={r} className="flex" style={{ height: ROW_H }} role="row">
                <div
                  className={cn(
                    "sticky left-0 z-10 flex shrink-0 items-center justify-center border-r border-b border-neutral-200 bg-neutral-50 text-[10px] font-medium text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400",
                    r === selection.r && "bg-neutral-200/70 text-neutral-900 dark:bg-neutral-800 dark:text-white",
                  )}
                  style={{ width: ROW_HEADER_W }}
                >
                  {r + 1}
                </div>
                {Array.from({ length: colCount }).map((__, c) => {
                  const isActive = selection.r === r && selection.c === c;
                  const isEditing = editing?.r === r && editing?.c === c;
                  const inRange =
                    selectedRow &&
                    (anchor
                      ? c >= Math.min(anchor.c, selection.c) && c <= Math.max(anchor.c, selection.c)
                      : isActive);
                  const resolved = resolveCell(sheet.rows, r, c);
                  const numeric = resolved.display !== "" && Number.isFinite(Number(resolved.display));
                  return (
                    <div
                      key={c}
                      role="gridcell"
                      aria-selected={isActive}
                      aria-label={`${colName(c)}${r + 1}`}
                      onMouseDown={(e) => {
                        if (isEditing) return;
                        if (e.shiftKey) setAnchor((a) => a ?? selection);
                        else setAnchor(null);
                        setSelection({ r, c });
                        setEditing(null);
                        scrollRef.current?.focus();
                      }}
                      onDoubleClick={() => setEditing({ r, c, draft: rawCell(sheet.rows, r, c) })}
                      className={cn(
                        "relative shrink-0 border-r border-b border-neutral-200 px-1.5 text-[12px] leading-none dark:border-neutral-800",
                        isActive && "z-[5] outline outline-2 -outline-offset-1 outline-blue-600 dark:outline-blue-400",
                        !isActive && inRange && "bg-blue-500/10",
                        resolved.error && "text-red-600 dark:text-red-400",
                      )}
                      style={{ width: COL_W, height: ROW_H }}
                    >
                      {isEditing ? (
                        <input
                          value={editing.draft}
                          onChange={(e) => setEditing({ r, c, draft: e.target.value })}
                          onBlur={() => commitCell(r, c, editing.draft)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitCell(r, c, editing.draft);
                              move(1, 0);
                              scrollRef.current?.focus();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setEditing(null);
                              scrollRef.current?.focus();
                            } else if (e.key === "Tab") {
                              e.preventDefault();
                              commitCell(r, c, editing.draft);
                              move(0, e.shiftKey ? -1 : 1);
                              scrollRef.current?.focus();
                            }
                          }}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          aria-label={`Edit ${colName(c)}${r + 1}`}
                          spellCheck={false}
                          className="absolute inset-0 h-full w-full appearance-none border-0 bg-white px-1.5 font-mono text-[12px] text-neutral-900 outline-none dark:bg-neutral-900 dark:text-neutral-100"
                        />
                      ) : (
                        <span
                          className={cn(
                            "block h-full w-full overflow-hidden py-[6px] text-ellipsis whitespace-nowrap",
                            numeric ? "text-right tabular-nums" : "text-left",
                          )}
                        >
                          {resolved.display}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div style={{ height: Math.max(0, (rowCount - endRow) * ROW_H) }} aria-hidden="true" />
        </div>
      </div>

      <style>{`
.sheet-scroll { scrollbar-color: #c9ced6 transparent; scrollbar-width: thin; }
.dark .sheet-scroll { scrollbar-color: #33373d transparent; scrollbar-width: thin; }
.sheet-scroll::-webkit-scrollbar { width: 11px; height: 11px; }
.sheet-scroll::-webkit-scrollbar-track { background: #ffffff; }
.dark .sheet-scroll::-webkit-scrollbar-track { background: #0a0a0b; }
.sheet-scroll::-webkit-scrollbar-thumb { background: #d4d8de; border-radius: 999px; border: 2px solid #ffffff; }
.dark .sheet-scroll::-webkit-scrollbar-thumb { background: #2b313b; border: 2px solid #0a0a0b; border-radius: 999px; }
`}</style>
    </div>
  );
}
