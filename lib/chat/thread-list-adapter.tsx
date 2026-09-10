"use client";

import { useCallback, useMemo } from "react";
import {
  RuntimeAdapterProvider,
  useAui,
  type RemoteThreadListAdapter,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { createQubeHistoryAdapter } from "./history-adapter";
import { messageText } from "./message-convert";

type RemoteThreadMetadata = {
  readonly status: "regular" | "archived";
  readonly remoteId: string;
  readonly externalId?: string | undefined;
  readonly title?: string | undefined;
  readonly lastMessageAt?: Date | undefined;
  readonly custom?: Record<string, unknown> | undefined;
};

type ServerThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status?: string;
  hasMessages?: boolean;
};

async function listServerThreads(): Promise<ServerThread[]> {
  const res = await fetch("/api/threads", { cache: "no-store" });
  if (!res.ok) throw new Error(`Threads fetch failed: ${res.status}`);
  const data = await res.json();
  return (data.threads || []) as ServerThread[];
}

async function fetchServerThread(id: string): Promise<ServerThread | null> {
  try {
    const res = await fetch(`/api/threads/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.thread || null) as ServerThread | null;
  } catch {
    return null;
  }
}

function toMetadata(t: ServerThread): RemoteThreadMetadata {
  return {
    status: t.status === "archived" ? "archived" : "regular",
    remoteId: t.id,
    title: t.title || "New Chat",
    lastMessageAt: t.updatedAt ? new Date(t.updatedAt) : undefined,
  };
}

function firstExchangeText(messages: readonly any[]): { user: string; assistant: string } {
  let user = "";
  let assistant = "";
  try {
    for (const m of messages ?? []) {
      const text = messageText(m).slice(0, 500);
      if (!text) continue;
      if (!user && m?.role === "user") user = text;
      else if (user && !assistant && m?.role === "assistant") assistant = text;
      if (user && assistant) break;
    }
  } catch {}
  return { user, assistant };
}

function heuristicTitle(messages: readonly any[]): string {
  const { user } = firstExchangeText(messages);
  if (!user) return "New Chat";
  const words = user.split(" ").slice(0, 7).join(" ");
  return (words.length > 48 ? words.slice(0, 48).trimEnd() + "…" : words) || "New Chat";
}

/** Per-thread provider: injects this thread's history adapter. */
function QubeThreadProvider({ children }: { children?: React.ReactNode }) {
  const aui = useAui();
  const history = useMemo(
    () => createQubeHistoryAdapter(() => aui.threadListItem()),
    [aui],
  );
  const adapters = useMemo(() => ({ history }), [history]);
  return <RuntimeAdapterProvider adapters={adapters}>{children}</RuntimeAdapterProvider>;
}

export function useQubeThreadListAdapter(): RemoteThreadListAdapter {
  const Provider = useCallback(
    function Provider({ children }: { children?: React.ReactNode }) {
      return <QubeThreadProvider>{children}</QubeThreadProvider>;
    },
    [],
  );

  return useMemo<RemoteThreadListAdapter>(
    () => ({
      async list() {
        const threads = await listServerThreads().catch(() => []);
        return {
          threads: threads
            .filter((t) => t.status !== "archived")
            .map(toMetadata),
        };
      },

      async initialize(threadId: string) {
        // No server row is created here: history appends materialize the
        // thread on the first real message, so empty chats never persist.
        return { remoteId: threadId, externalId: undefined };
      },

      async fetch(threadId: string) {
        const t = await fetchServerThread(threadId);
        if (!t) throw new Error("Thread not found");
        return toMetadata(t);
      },

      async rename(remoteId: string, newTitle: string) {
        const title = newTitle.trim().slice(0, 120);
        if (!title) return;
        await fetch(`/api/threads/${encodeURIComponent(remoteId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }).catch(() => {});
      },

      async archive(remoteId: string) {
        await fetch(`/api/threads/${encodeURIComponent(remoteId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "archived" }),
        }).catch(() => {});
      },

      async unarchive(remoteId: string) {
        await fetch(`/api/threads/${encodeURIComponent(remoteId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "regular" }),
        }).catch(() => {});
      },

      async delete(remoteId: string) {
        await fetch(`/api/threads/${encodeURIComponent(remoteId)}`, {
          method: "DELETE",
        }).catch(() => {});
      },

      // Called automatically after a new thread's first run ends. Generates
      // the title with the agent (never a tool call); falls back to a
      // heuristic excerpt when no model is available.
      async generateTitle(remoteId: string, messages: readonly any[]) {
        let title: string | null = null;
        try {
          const { user, assistant } = firstExchangeText(messages);
          if (user && assistant) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 45000);
            try {
              const res = await fetch(`/api/threads/${encodeURIComponent(remoteId)}/title`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userText: user, assistantText: assistant }),
                signal: controller.signal,
              });
              if (res.ok) {
                const data = await res.json().catch(() => ({}));
                if (typeof data?.title === "string" && data.title.trim()) {
                  title = data.title.trim().slice(0, 80);
                }
              }
            } catch {
              // Fall through to heuristic.
            } finally {
              clearTimeout(timeout);
            }
          }
        } catch {}
        if (!title) title = heuristicTitle(messages);
        const finalTitle = title;
        return createAssistantStream((streamController) => {
          streamController.appendText(finalTitle);
          streamController.close();
        });
      },

      unstable_Provider: Provider,
    }),
    [Provider],
  );
}
