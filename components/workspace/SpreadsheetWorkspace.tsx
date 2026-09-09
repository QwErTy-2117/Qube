"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpDownIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { useWorkspaceStore } from "@/lib/workspace/store";
import { useDocument } from "./useDocument";

function colName(i: number): string {
  let s = "";
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

type SheetData = { name: string; rowCount: number; colCount: number; rows: string[][] };

async function saveSheets(path: string, sheets: SheetData[]): Promise<void> {
  const res = await fetch("/api/workspace/document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, sheets: sheets.map((s) => ({ name: s.name, rows: s.rows })) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error((data as { error?: string }).error || `Save failed (${res.status})`);
  }
}

export function SpreadsheetWorkspace({ filePath, downloadUrl }: { filePath: string; downloadUrl: string }) {
  const { data, loading, error, reload } = useDocument(filePath);
  const addSelection = useWorkspaceStore((s) => s.addSelection);
  const serverSheets = useMemo(() => (data && "sheets" in data ? data.sheets : []), [data]);
  // Local copy: inline cell edits apply here first, then persist whole grid.
  const [local, setLocal] = useState<SheetData[] | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const [focus, setFocus] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
  const [cellDraft, setCellDraft] = useState("");
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setLocal(null);
    setEditing(null);
    setSheetIdx(0);
    setAnchor(null);
    setFocus(null);
  }, [data]);

  const sheets = local ?? serverSheets;

  const sheet = sheets[sheetIdx];
  const rows = useMemo(() => {
    if (!sheet) return [] as string[][];
    const body = sheet.rows;
    if (sortCol === null) return body;
    const head = body.slice(0, 1);
    const rest = body.slice(1).sort((a, b) => String(a[sortCol] ?? "").localeCompare(String(b[sortCol] ?? "")) * sortDir);
    return [...head, ...rest];
  }, [sheet, sortCol, sortDir]);

  const rangeLabel = anchor && focus
    ? `${colName(Math.min(anchor.c, focus.c))}${Math.min(anchor.r, focus.r) + 1}:${colName(Math.max(anchor.c, focus.c))}${Math.max(anchor.r, focus.r) + 1}`
    : focus ? `${colName(focus.c)}${focus.r + 1}` : "";

  const quoteRange = () => {
    if (!sheet || !rangeLabel) return;
    const r1 = anchor && focus ? Math.min(anchor.r, focus.r) : focus!.r;
    const r2 = anchor && focus ? Math.max(anchor.r, focus.r) : focus!.r;
    const c1 = anchor && focus ? Math.min(anchor.c, focus.c) : focus!.c;
    const c2 = anchor && focus ? Math.max(anchor.c, focus.c) : focus!.c;
    const values = rows.slice(r1, r2 + 1).map((r) => r.slice(c1, c2 + 1));
    addSelection({ kind: "sheet", sheet: sheet.name, range: rangeLabel, values });
  };

  const persist = async (next: SheetData[]) => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveSheets(filePath, next);
      setLocal(next);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1800);
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const commitCell = (r: number, c: number, value: string) => {
    setEditing(null);
    if (!sheet || (rows[r]?.[c] ?? "") === value) return;
    // Map the (possibly sorted) view row back to the stored row by identity.
    const origIdx = sheet.rows.indexOf(rows[r]);
    if (origIdx < 0) return;
    const next = sheets.map((sh, si) => {
      if (si !== sheetIdx) return sh;
      const newRows = sh.rows.map((row, ri) => {
        if (ri !== origIdx) return row;
        const newRow = [...row];
        while (newRow.length <= c) newRow.push("");
        newRow[c] = value;
        return newRow;
      });
      return { ...sh, rows: newRows };
    });
    void persist(next);
  };

  const openCellEditor = (r: number, c: number) => {
    setCellDraft(rows[r]?.[c] ?? "");
    setEditing({ r, c });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-2.5 py-2">
        <div className="flex max-w-[60%] gap-1 overflow-x-auto">
          {sheets.map((sh, i) => (
            <button key={sh.name} onClick={() => { setSheetIdx(i); setAnchor(null); setFocus(null); }}
              className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition ${i === sheetIdx ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
              {sh.name}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {saving
          ? <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2Icon className="size-3 animate-spin" />Saving…</span>
          : saveError
            ? <span className="text-[11px] text-red-500">{saveError}</span>
            : savedTick
              ? <span className="flex items-center gap-1 text-[11px] text-emerald-500"><CheckIcon className="size-3" />Saved</span>
              : null}
        {rangeLabel && <button onClick={quoteRange} title="Quote this range" className="rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-foreground/80 transition hover:bg-accent">{rangeLabel}</button>}
      </div>
      <div data-doc-scroll className="min-h-0 flex-1 overflow-auto">
        {loading ? <p className="p-4 text-xs text-muted-foreground">Loading spreadsheet…</p>
        : error ? <p className="p-4 text-xs text-red-400">{error}</p>
        : !sheet ? <p className="p-4 text-xs italic text-muted-foreground">No sheets found.</p>
        : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr>
                <th className="w-10 border border-border/50 p-1 text-muted-foreground">#</th>
                {Array.from({ length: Math.max(1, sheet.colCount) }).map((_, c) => (
                  <th key={c} className="border border-border/50 p-1">
                    <button onClick={() => { if (sortCol === c) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortCol(c); setSortDir(1); } }}
                      className="inline-flex items-center gap-1 font-mono text-muted-foreground hover:text-foreground">
                      {colName(c)} <ArrowUpDownIcon className="size-3" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className={r === 0 ? "bg-muted/40 font-semibold" : ""}>
                  <td className="border border-border/50 bg-muted/30 p-1 text-center font-mono text-muted-foreground">{r + 1}</td>
                  {Array.from({ length: Math.max(1, sheet.colCount) }).map((_, c) => {
                    const selected = focus && anchor
                      ? r >= Math.min(anchor.r, focus.r) && r <= Math.max(anchor.r, focus.r) && c >= Math.min(anchor.c, focus.c) && c <= Math.max(anchor.c, focus.c)
                      : focus?.r === r && focus?.c === c;
                    const isEditing = editing?.r === r && editing?.c === c;
                    return (
                      <td key={c}
                        onClick={(e) => {
                          if (isEditing) return;
                          // Second click on the focused cell opens the inline editor.
                          if (focus?.r === r && focus?.c === c && !e.shiftKey) {
                            openCellEditor(r, c);
                            return;
                          }
                          if (e.shiftKey && focus) setAnchor(focus);
                          else setAnchor(null);
                          setFocus({ r, c });
                        }}
                        title={isEditing ? undefined : "Click again to edit"}
                        className={`border border-border/50 px-2 py-1 ${isEditing ? "p-0" : "cursor-cell"} ${selected && !isEditing ? "bg-primary/15 outline outline-1 outline-primary/60" : !isEditing ? "hover:bg-accent/60" : ""}`}>
                        {isEditing ? (
                          <input
                            value={cellDraft}
                            onChange={(e) => setCellDraft(e.target.value)}
                            onBlur={() => commitCell(r, c, cellDraft)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); commitCell(r, c, cellDraft); }
                              if (e.key === "Escape") { e.stopPropagation(); setEditing(null); }
                              e.stopPropagation();
                            }}
                            // eslint-disable-next-line jsx-a11y/no-autofocus
                            autoFocus
                            aria-label={`Edit cell ${colName(c)}${r + 1}`}
                            className="w-full min-w-[60px] bg-transparent px-0 py-0 outline-none"
                          />
                        ) : (
                          row[c] ?? ""
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
