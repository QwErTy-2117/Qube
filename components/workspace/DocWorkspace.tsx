"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useWorkspaceStore } from "@/lib/workspace/store";
import { useDocument } from "./useDocument";

async function saveParagraphs(path: string, paragraphs: string[]): Promise<void> {
  const res = await fetch("/api/workspace/document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, paragraphs }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error((data as { error?: string }).error || `Save failed (${res.status})`);
  }
}

export function DocWorkspace({ filePath, downloadUrl }: { filePath: string; downloadUrl: string }) {
  const { data, loading, error, reload } = useDocument(filePath);
  const addSelection = useWorkspaceStore((s) => s.addSelection);
  void downloadUrl;
  const text = useMemo(() => {
    if (data && "content" in data && typeof data.content === "string") return data.content;
    return "";
  }, [data]);
  const paragraphs = useMemo(() => text.split(/\n\s*\n/).filter((p) => p.trim()), [text]);

  // Always editable, single whole-document editor styled like the view.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastQuoteAt = useRef(0);

  useEffect(() => {
    setDraft(null);
  }, [text]);

  const persist = async (value: string) => {
    if (value === text) {
      setDraft(null);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await saveParagraphs(
        filePath,
        value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
      );
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

  const quoteSelection = () => {
    if (draft !== null) return;
    const sel = window.getSelection()?.toString().trim();
    if (!sel || !paragraphs.length) return;
    let para = 1;
    for (let i = 0; i < paragraphs.length; i++) {
      if (paragraphs[i].includes(sel.slice(0, 40))) { para = i + 1; break; }
    }
    addSelection({ kind: "doc", paragraph: para, text: sel.slice(0, 2000) });
    lastQuoteAt.current = Date.now();
    window.getSelection()?.removeAllRanges();
  };

  const openEditor = () => {
    if (draft !== null) return;
    if (Date.now() - lastQuoteAt.current < 400) return;
    if (window.getSelection()?.toString()) return;
    setDraft(text);
  };

  const status = saving ? "Saving…" : saveError ? saveError : savedTick ? "Saved" : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-doc-scroll className="min-h-0 flex-1 overflow-y-auto px-5 py-4" onMouseUp={quoteSelection}>
        {status && (
          <div className="sticky top-0 z-10 mx-auto mb-2 w-fit rounded-[26px] border border-[#e7e7e7] bg-white shadow-xl shadow-black/10">
            <div className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold tracking-tight leading-none ${saveError ? "text-red-600" : "text-[#1e4d2f]"}`}>
              {saving && <Loader2Icon className="size-3.5 animate-spin" />}
              {!saving && !saveError && <CheckIcon className="size-3.5 text-emerald-500" />}
              {status}
            </div>
          </div>
        )}
        {loading ? <p className="text-xs text-muted-foreground">Loading document…</p>
        : error ? (
          <div className="mx-auto max-w-[420px] py-8 text-center">
            <p className="mb-1 text-sm font-medium">Couldn’t extract text</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{error}</p>
          </div>
        ) : draft !== null ? (
          <article className="mx-auto max-w-[540px]">
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }}
              onBlur={() => void persist(draft)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.stopPropagation(); setDraft(null); }
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void persist(draft); }
              }}
              ref={(el) => {
                if (el) {
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                }
              }}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              spellCheck={false}
              aria-label="Edit document"
              placeholder="Start writing…"
              className="block w-full resize-none overflow-hidden bg-transparent text-[15px] leading-7 whitespace-pre-wrap text-foreground/90 outline-none placeholder:text-muted-foreground/40"
            />
          </article>
        ) : (
          <article className="mx-auto max-w-[540px] cursor-text rounded-md transition-colors hover:bg-muted/30" onClick={openEditor} title="Click to edit">
            {paragraphs.map((p, i) => (
              <span key={i} className="block">
                <p className="text-[15px] leading-7 whitespace-pre-wrap text-foreground/90">{p}</p>
                {i < paragraphs.length - 1 && <span aria-hidden="true" className="block h-7" />}
              </span>
            ))}
            {paragraphs.length === 0 && <p className="text-xs italic text-muted-foreground">Empty document — click to start writing.</p>}
          </article>
        )}
      </div>
    </div>
  );
}
