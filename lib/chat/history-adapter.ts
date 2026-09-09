"use client";

import type { ThreadHistoryAdapter } from "@assistant-ui/react";
import { threadMessageToUIMessage } from "./message-convert";

/**
 * VoiceMem-thread history adapter backed by /api/threads snapshots.
 *
 * Storage shape is the decoded UI-message repository
 * ({ headId, messages: [{ parentId, message }] }) — the same v2 envelope the
 * app has always written, so every existing chat keeps working. Legacy v1
 * (ThreadMessage content) entries are converted to readable text on read.
 */

type StoredItem = { parentId: string | null; message: any };
type StoredRepo = {
  version?: number;
  headId?: string | null;
  messages?: StoredItem[];
};

type ItemGetter = () => {
  initialize: () => Promise<{ remoteId: string; externalId?: string }>;
  getState: () => { remoteId?: string };
};

async function fetchRepo(remoteId: string): Promise<{ repository: any; title: string } | null> {
  try {
    const res = await fetch(`/api/threads/${encodeURIComponent(remoteId)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as { repository: any; title: string };
  } catch {
    return null;
  }
}

async function writeRepo(remoteId: string, repository: unknown, title?: string): Promise<void> {
  try {
    await fetch(`/api/threads/${encodeURIComponent(remoteId)}/messages`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repository, title }),
    });
  } catch {}
}

/** Normalize any stored shape to decoded UI-message items. */
function normalizeItems(repository: any): { headId: string | null; items: StoredItem[] } {
  const raw: any[] = Array.isArray(repository?.messages) ? repository.messages : [];
  const items: StoredItem[] = [];
  for (const entry of raw) {
    const parentId = typeof entry?.parentId === "string" ? entry.parentId : null;
    const m = entry?.message;
    if (!m || typeof m !== "object") continue;
    if (Array.isArray((m as any).parts)) {
      if (typeof (m as any).id === "string") items.push({ parentId, message: m });
      continue;
    }
    // Legacy v1 ThreadMessage content → readable UI message.
    const rec = threadMessageToUIMessage(m);
    if (rec) items.push({ parentId, message: rec });
  }
  const ids = new Set(items.map((i) => i.message.id));
  let headId: string | null =
    typeof repository?.headId === "string" && ids.has(repository.headId)
      ? repository.headId
      : (items.at(-1)?.message.id ?? null);
  // Heal stale heads on linear chains: point at the visible tail.
  let linear = items.length > 0 && items[0].parentId == null;
  for (let i = 1; i < items.length && linear; i++) {
    if (items[i].parentId !== items[i - 1]?.message?.id) linear = false;
  }
  if (linear && items.length > 0) {
    headId = items[items.length - 1].message.id;
  }
  return { headId, items };
}

async function readDecoded(
  remoteId: string | undefined,
): Promise<{ headId: string | null; items: StoredItem[] }> {
  if (!remoteId) return { headId: null, items: [] };
  const data = await fetchRepo(remoteId);
  if (!data?.repository) return { headId: null, items: [] };
  return normalizeItems(data.repository);
}

async function writeDecoded(
  remoteId: string,
  headId: string | null,
  items: StoredItem[],
): Promise<void> {
  await writeRepo(remoteId, { version: 2, headId, messages: items });
}

function msgId(message: any): string | null {
  return message && typeof message.id === "string" ? message.id : null;
}

export function createQubeHistoryAdapter(getItem: ItemGetter): ThreadHistoryAdapter {
  const remoteIdOf = () => {
    try {
      return getItem().getState().remoteId;
    } catch {
      return undefined;
    }
  };

  const base: ThreadHistoryAdapter = {
    async load() {
      const { headId, items } = await readDecoded(remoteIdOf());
      // Shape as an ExportedMessageRepository for non-withFormat consumers.
      // ThreadMessages are best-effort (content mapped 1:1); the real path
      // used by useChatRuntime is withFormat() below (full UI messages).
      return {
        headId,
        messages: items.map((it) => ({
          parentId: it.parentId,
          message: {
            id: it.message.id,
            role: it.message.role,
            content: it.message.parts,
            status: { type: "complete" },
            metadata: { custom: {} },
            createdAt: new Date(),
          } as any,
        })),
      };
    },

    async append({ parentId, message }) {
      const { remoteId } = await getItem().initialize();
      const { items } = await readDecoded(remoteId);
      const id = msgId(message);
      if (id && items.some((it) => msgId(it.message) === id)) return;
      items.push({ parentId: parentId ?? null, message });
      const tail = id ?? (items.at(-1) ? msgId(items.at(-1)!.message) : null);
      await writeDecoded(remoteId, tail, items);
    },

    async delete(items) {
      const remoteId = remoteIdOf();
      if (!remoteId) return;
      const ids = new Set(
        (items ?? []).map((it: any) => msgId(it?.message)).filter(Boolean),
      );
      if (ids.size === 0) return;
      const current = await readDecoded(remoteId);
      const kept = current.items.filter((it) => !ids.has(msgId(it.message)));
      const head =
        current.headId && kept.some((it) => msgId(it.message) === current.headId)
          ? current.headId
          : (kept.at(-1) ? msgId(kept.at(-1)!.message) : null);
      await writeDecoded(remoteId, head, kept);
    },

    withFormat(formatAdapter) {
      void formatAdapter;
      // Our files already store decoded UI messages, so the adapter is
      // format-agnostic: items pass through untouched.
      return {
        async load() {
          const { headId, items } = await readDecoded(remoteIdOf());
          return { headId, messages: items };
        },
        async append(item) {
          const { remoteId } = await getItem().initialize();
          const { items } = await readDecoded(remoteId);
          const id = msgId((item as any)?.message);
          if (id && items.some((it) => msgId(it.message) === id)) return;
          items.push({
            parentId: (item as any)?.parentId ?? null,
            message: (item as any)?.message,
          });
          const tail =
            id ?? (items.at(-1) ? msgId(items.at(-1)!.message) : null);
          await writeDecoded(remoteId, tail, items);
        },
        async update(item, localMessageId) {
          const remoteId = remoteIdOf();
          if (!remoteId) return;
          const { items } = await readDecoded(remoteId);
          const next = items.map((it) =>
            msgId(it.message) === localMessageId
              ? {
                  parentId: (item as any)?.parentId ?? it.parentId,
                  message: (item as any)?.message ?? it.message,
                }
              : it,
          );
          const { headId } = await readDecoded(remoteId);
          await writeDecoded(remoteId, headId, next);
        },
        async delete(items) {
          const remoteId = remoteIdOf();
          if (!remoteId) return;
          const ids = new Set(
            (items ?? []).map((it: any) => msgId(it?.message)).filter(Boolean),
          );
          if (ids.size === 0) return;
          const current = await readDecoded(remoteId);
          const kept = current.items.filter((it) => !ids.has(msgId(it.message)));
          const head =
            current.headId && kept.some((it) => msgId(it.message) === current.headId)
              ? current.headId
              : (kept.at(-1) ? msgId(kept.at(-1)!.message) : null);
          await writeDecoded(remoteId, head, kept);
        },
      };
    },
  };

  return base;
}
