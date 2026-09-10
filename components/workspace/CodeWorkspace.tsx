"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useWorkspaceStore } from "@/lib/workspace/store";
import { saveDocumentContent, useDocument } from "./useDocument";

export function CodeWorkspace({ filePath, downloadUrl }: { filePath: string; downloadUrl: string }) {
  const { data, loading, error, reload } = useDocument(filePath);
  const addSelection = useWorkspaceStore((s) => s.addSelection);
  void downloadUrl;
  const content = useMemo(() => (data && "content" in data ? String(data.content) : ""), [data]);
  // Always editable: the editor IS the view. Draft follows server content
  // until the user types; blur autosaves, Escape reverts.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);

  // Server reload (e.g. after the agent edits) resets a clean draft.
  useEffect(() => {
    setDraft((d) => (d === null || d === content ? null : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const shown = draft ?? content;
  const lines = useMemo(() => shown.split("\n"), [shown]);
  const maxLineLen = useMemo(() => lines.reduce((n, l) => Math.max(n, l.length), 0), [lines]);

  const save = async (value?: string) => {
    const next = value ?? draft;
    if (saving || next === null || next === content) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveDocumentContent(filePath, next);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1800);
      setDraft(null);
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const dirty = draft !== null && draft !== content;

  const range = anchor !== null && focus !== null
    ? { from: Math.min(anchor, focus) + 1, to: Math.max(anchor, focus) + 1 }
    : focus !== null ? { from: focus + 1, to: focus + 1 } : null;

  const quoteRange = () => {
    if (!range) return;
    const text = lines.slice(range.from - 1, range.to).join("\n").slice(0, 4000);
    addSelection({ kind: "code", startLine: range.from, endLine: range.to, text });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-2.5 py-2">
        {range && <button onClick={quoteRange} title="Quote these lines" className="rounded-md bg-muted px-2 py-1 font-mono text-[11px] transition hover:bg-accent">L{range.from}–{range.to}</button>}
        <span className="flex-1" />
        {saving
          ? <span className="flex items-center gap-1.5 rounded-[26px] border border-[#e7e7e7] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#1e4d2f] shadow"><Loader2Icon className="size-3 animate-spin" />Saving…</span>
          : saveError
            ? <span className="rounded-[26px] border border-[#e7e7e7] bg-white px-3 py-1.5 text-[12px] font-semibold text-red-600 shadow">{saveError}</span>
            : savedTick
              ? <span className="flex items-center gap-1.5 rounded-[26px] border border-[#e7e7e7] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#1e4d2f] shadow"><CheckIcon className="size-3 text-emerald-500" />Saved</span>
              : dirty
                ? <span className="text-[11px] text-muted-foreground/70">Unsaved</span>
                : null}
      </div>
      <div data-doc-scroll className="min-h-0 flex-1 overflow-auto bg-[#0d0d10] dark:bg-black/40">
        {loading ? <p className="p-4 text-xs text-muted-foreground">Loading code…</p>
        : error ? <p className="p-4 text-xs text-red-400">{error}</p>
        : (
          <div className="flex min-h-full w-max min-w-full items-start p-3 font-mono text-[12px] leading-5">
            <div aria-hidden="true" className="sticky left-0 w-10 shrink-0 bg-[#0d0d10] pr-3 text-right text-muted-foreground/50 select-none dark:bg-black/40">
              {lines.map((_, i) => (
                <div key={i} className="h-5">{i + 1}</div>
              ))}
            </div>
            <textarea
              value={shown}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { if (dirty) void save(); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.stopPropagation(); setDraft(null); }
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
              }}
              onSelect={(e) => {
                const el = e.currentTarget;
                if (el.selectionStart === el.selectionEnd) return;
                const fromLine = shown.slice(0, el.selectionStart).split("\n").length - 1;
                const toLine = shown.slice(0, el.selectionEnd).split("\n").length - 1;
                setAnchor(fromLine);
                setFocus(toLine);
              }}
              spellCheck={false}
              aria-label="Edit code"
              rows={Math.max(lines.length, 1)}
              cols={Math.max(maxLineLen + 4, 80)}
              wrap="off"
              className="w-max min-w-[calc(100%-2.5rem)] resize-none overflow-hidden bg-transparent whitespace-pre text-zinc-200 outline-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
