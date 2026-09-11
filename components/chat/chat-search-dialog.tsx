"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAui } from "@assistant-ui/react";
import { useThreadStore } from "@/lib/chat/thread-store";
import { searchThreads, type ThreadMeta } from "@/lib/chat/threads-client";
import { PencilIcon, Trash2Icon, CheckIcon, XIcon, SearchIcon } from "lucide-react";

export function ChatSearchDialog() {
  const aui = useAui();
  const open = useThreadStore((s) => s.searchOpen);
  const setOpen = useThreadStore((s) => s.setSearchOpen);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ThreadMeta[]>([]);
  const [searched, setSearched] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const itemApi = (id: string) => {
    try {
      return aui.threads().item({ id });
    } catch {
      return null;
    }
  };

  // The URL follows the main thread reactively (ThreadUrlSync).
  // Missing/deleted threads fall back to a fresh chat, never an error.
  const openChat = (id: string) => {
    setOpen(false);
    try {
      Promise.resolve(aui.threads().switchToThread(id)).catch(() => {
        try {
          Promise.resolve(aui.threads().switchToNewThread()).catch(() => {});
        } catch {}
      });
    } catch {
      try {
        Promise.resolve(aui.threads().switchToNewThread()).catch(() => {});
      } catch {}
    }
  };

  // Cmd+K / Ctrl+K toggles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useThreadStore.getState().setSearchOpen(!useThreadStore.getState().searchOpen);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSearched(false);
      setEditingId(null);
      setTimeout(() => inputRef.current?.focus(), 30);
      // Show recent chats immediately; typing narrows them down.
      searchThreads("").then((r) => {
        setResults(r);
        setSearched(true);
      }).catch(() => {});
    }
  }, [open ]);

  const runSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      searchThreads(trimmed)
        .then((r) => {
          setResults(r);
          setSearched(true);
        })
        .catch(() => {});
    }, 120);
  }, []);

  if (!open) return null;

  const commitEdit = (t: ThreadMeta) => {
    if (editValue.trim() && editValue.trim() !== t.title) {
      try {
        Promise.resolve(
          itemApi(t.id)?.rename(editValue.trim().slice(0, 120)),
        ).catch(() => {});
      } catch {}
      setResults((rs) => rs.map((r) => (r.id === t.id ? { ...r, title: editValue.trim() } : r)));
    }
    setEditingId(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[380px] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
      >
        <div className="flex shrink-0 items-center gap-2 px-4 py-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              runSearch(e.target.value);
            }}
            placeholder="Search chats…"
            className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                runSearch("");
              }}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto border-t border-border/60 p-1.5"
        >
          {!searched ? (
            <div className="flex h-full items-center justify-center px-3 text-center text-sm text-muted-foreground">
              Loading recent chats…
            </div>
          ) : results.length === 0 ? (
            <div className="flex h-full items-center justify-center px-3 text-center text-sm text-muted-foreground">
              No chats found.
            </div>
          ) : (
            results.map((t) => (
              <div
                key={t.id}
                onMouseEnter={() => setHoverId(t.id)}
                onMouseLeave={() => setHoverId((h) => (h === t.id ? null : h))}
                  onClick={() => {
                    if (editingId !== t.id) openChat(t.id);
                  }}
                className="group flex min-h-9 cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                {editingId === t.id ? (
                  <span className="flex min-w-0 flex-1 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(t);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1 text-[13px] outline-none"
                    />
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        commitEdit(t);
                      }}
                      aria-label="Confirm rename"
                      className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                    >
                      <CheckIcon className="size-3" />
                    </button>
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setEditingId(null);
                      }}
                      aria-label="Cancel rename"
                      className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-left">
                      {t.title || "New Chat"}
                      {t.snippet && (
                        <span className="block truncate text-xs text-muted-foreground/70">
                          {t.snippet}
                        </span>
                      )}
                    </span>
                    {(hoverId === t.id) && (
                      <span className="flex shrink-0 items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(t.id);
                            setEditValue(t.title);
                          }}
                          aria-label="Rename chat"
                          title="Rename"
                          className="flex size-6 items-center justify-center text-muted-foreground hover:text-foreground"
                        >
                          <PencilIcon className="size-3" />
                        </button>
                        <button
                          onClick={(e) => {
                              e.stopPropagation();
                              // The fallback effect re-homes main; the URL
                              // follows reactively.
                              try {
                                Promise.resolve(itemApi(t.id)?.delete()).catch(() => {});
                              } catch {}
                              setResults((rs) => rs.filter((r) => r.id !== t.id));
                            }}
                          aria-label="Delete chat"
                          title="Delete"
                          className="flex size-6 items-center justify-center text-muted-foreground transition-colors hover:text-destructive focus-visible:text-destructive"
                        >
                          <Trash2Icon className="size-3" />
                        </button>
                      </span>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
