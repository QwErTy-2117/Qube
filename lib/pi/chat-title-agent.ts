/**
 * Agent-generated chat titles (no tool call).
 *
 * Like ChatGPT/Claude/AssistantCloud: after the first complete user+assistant
 * exchange, a lightweight model call writes a short title into the thread.
 * Never overwrites a manual rename; heuristic titles get upgraded.
 * All failures resolve to null — callers fall back to a heuristic title.
 */

import { providerStore } from "./provider-store";
import { createPiModelClient } from "./model-client";

const TITLE_SYSTEM =
  "Generate a short, descriptive title (3-7 words) for a conversation that starts with the following exchange. " +
  "Capture the main topic or intent, in the same language the user wrote in. " +
  "Return ONLY the title text — no quotes, no trailing punctuation, no prefixes like 'Title:'.";

function partText(parts: any): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First user message + first assistant reply (v2 UI-message or legacy repos). */
export function firstExchange(repository: any): { user: string; assistant: string } {
  let user = "";
  let assistant = "";
  try {
    const items: any[] = repository?.messages ?? [];
    for (const item of items) {
      const m = item?.message ?? item;
      const text = partText(m?.parts ?? m?.content).slice(0, 500);
      if (!text) continue;
      if (!user && m?.role === "user") user = text;
      else if (user && !assistant && m?.role === "assistant") assistant = text;
      if (user && assistant) break;
    }
  } catch {}
  return { user, assistant };
}

export function cleanTitle(raw: string): string | null {
  let t = (raw || "").trim().replace(/\s+/g, " ");
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  t = t.replace(/^(title|chat title|conversation title)\s*[:\-–]\s*/i, "").trim();
  t = t.replace(/[.!?…;:]+$/g, "").trim();
  if (!t) return null;
  if (t.length > 60) {
    const cut = t.slice(0, 60);
    const lastSpace = cut.lastIndexOf(" ");
    t = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
  }
  return t || null;
}

async function generateTitleText(user: string, assistant: string): Promise<string | null> {
  const modelId = providerStore.getDefaultModelId();
  if (!modelId) return null;
  let model: any;
  try {
    model = createPiModelClient(modelId);
  } catch {
    return null;
  }

  // NOTE: must use streamText (not generateText) — model-client forces
  // stream:true on every fetch, which breaks generateText's JSON parsing.
  const { streamText } = await import("ai");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const result: any = await (streamText as any)({
      model,
      system: TITLE_SYSTEM,
      prompt: `User: ${user}\n\nAssistant: ${assistant}`,
      maxRetries: 0,
      temperature: 0.3,
      abortSignal: controller.signal,
    });
    try {
      await result.consumeStream();
    } catch {}
    return cleanTitle(String((await result.text) ?? ""));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Ensure an agent title for a thread. Resolves with the title (existing
 * final, newly generated, or null). Never overwrites manual renames.
 */
export async function ensureThreadTitle(
  threadId: string,
  userText?: string,
  assistantText?: string,
): Promise<string | null> {
  try {
    const { readThreadSnapshot, saveThreadSnapshot } = await import(
      "@/lib/chat/thread-snapshots"
    );
    const snap = await readThreadSnapshot(threadId).catch(() => null);
    if (snap && (snap.titleSource === "manual" || snap.titleSource === "auto")) {
      return snap.title || null;
    }

    let user = (userText || "").trim().slice(0, 500);
    let assistant = (assistantText || "").trim().slice(0, 500);
    if ((!user || !assistant) && snap?.repository) {
      const ex = firstExchange(snap.repository);
      user = user || ex.user;
      assistant = assistant || ex.assistant;
    }
    if (!user || !assistant) return snap?.title && !isPlaceholder(snap.title) ? snap.title : null;

    const title = await generateTitleText(user, assistant);
    if (!title) return snap?.title ?? null;

    // Re-check: a manual rename meanwhile always wins.
    const fresh = await readThreadSnapshot(threadId).catch(() => null);
    if (fresh && (fresh.titleSource === "manual" || fresh.titleSource === "auto")) {
      return fresh.title;
    }
    await saveThreadSnapshot(threadId, fresh?.repository ?? snap?.repository, title, "auto");

    try {
      const { readSession, saveSession } = await import("@/lib/memory/session-store");
      const sess = await readSession(threadId).catch(() => null);
      if (sess) {
        await saveSession(threadId, title, sess.summary, (sess as any).transcript, sess.hasTranscript);
      }
    } catch {}
    return title;
  } catch {
    return null;
  }
}

function isPlaceholder(title: string | undefined | null): boolean {
  if (!title) return true;
  const t = title.trim().toLowerCase();
  return t === "" || t === "new chat" || t === "new thread" || t === "conversation" || t === "untitled";
}
