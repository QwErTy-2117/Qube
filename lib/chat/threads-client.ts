"use client";

export type ThreadMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  hasMessages?: boolean;
  snippet?: string;
};

const PLACEHOLDER_TITLES = new Set(["", "new chat", "new thread", "conversation", "untitled"]);

export function isPlaceholderTitle(title: string | undefined | null): boolean {
  if (!title) return true;
  return PLACEHOLDER_TITLES.has(title.trim().toLowerCase());
}

export async function fetchThreads(): Promise<ThreadMeta[]> {
  const res = await fetch("/api/threads", { cache: "no-store" });
  if (!res.ok) throw new Error(`Threads fetch failed: ${res.status}`);
  const data = await res.json();
  return (data.threads || []) as ThreadMeta[];
}

export async function createThreadServer(id: string, title = "New Chat"): Promise<ThreadMeta> {
  const res = await fetch("/api/threads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, title }),
  });
  if (!res.ok) throw new Error(`Create thread failed: ${res.status}`);
  const data = await res.json();
  return data.thread as ThreadMeta;
}

export async function renameThreadServer(id: string, title: string): Promise<void> {
  const res = await fetch(`/api/threads/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Rename failed: ${res.status}`);
}

export async function deleteThreadServer(id: string): Promise<void> {
  const res = await fetch(`/api/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export async function fetchThreadRepository(id: string): Promise<{ repository: any; title: string } | null> {
  const res = await fetch(`/api/threads/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  return { repository: data.repository ?? null, title: data.thread?.title || "New Chat" };
}

export async function saveThreadRepository(
  id: string,
  repository: unknown,
  title?: string,
): Promise<{ title?: string; titleSource?: string | null } | undefined> {
  const res = await fetch(`/api/threads/${encodeURIComponent(id)}/messages`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repository, title }),
  });
  if (!res.ok) return undefined;
  const data = await res.json().catch(() => ({}));
  return {
    title: typeof data?.title === "string" ? data.title : undefined,
    titleSource: typeof data?.titleSource === "string" ? data.titleSource : null,
  };
}

export async function requestAgentTitle(id: string): Promise<void> {
  try {
    await fetch(`/api/threads/${encodeURIComponent(id)}/title`, { method: "POST" });
  } catch {}
}

export async function searchThreads(q: string): Promise<ThreadMeta[]> {
  const res = await fetch(`/api/threads/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.threads || []) as ThreadMeta[];
}
