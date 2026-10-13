import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { AssistantEntry } from "@earendil-works/pi-durable";
import { getOrCreateConversation, syncConversationAgent } from "@/lib/pi/durable-conversations";

export function buildRequestId(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`;
}

export async function submitDurableChat(threadId: string, text: string, requestId: string, context = BACKGROUND_CONTEXT) {
  const conv = await getOrCreateConversation(threadId, context);
  const submission = await conv.submit({ type: "input", content: text, requestId } as never, context);
  const settled = await submission.wait(context);
  if (settled.status === "done" && settled.type === "input") {
    const entry = await conv.commit((tx) => tx.entry(AssistantEntry, settled.answer!), context);
    return entry?.model?.[0] ?? null;
  }
  return null;
}

export type DurableStreamCursor = {
  emittedText: Map<string, number>;
  emittedToolCalls: Set<string>;
  emittedResults: Set<string>;
  openText: Set<string>;
};

export function createDurableStreamCursor(): DurableStreamCursor {
  return { emittedText: new Map(), emittedToolCalls: new Set(), emittedResults: new Set(), openText: new Set() };
}

function assistantTextOf(model: Array<Record<string, unknown>> | undefined): string {
  if (!Array.isArray(model)) return "";
  const out: string[] = [];
  for (const msg of model) {
    const content = (msg as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as Array<Record<string, unknown>>) {
      if (part?.type === "text" && typeof part.text === "string") out.push(part.text);
    }
  }
  return out.join("");
}

function toolCallsOf(model: Array<Record<string, unknown>> | undefined): Array<{ id: string; name: string; args: unknown }> {
  const calls: Array<{ id: string; name: string; args: unknown }> = [];
  if (!Array.isArray(model)) return calls;
  for (const msg of model) {
    const content = (msg as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as Array<Record<string, unknown>>) {
      if (part?.type === "toolCall" && typeof part.id === "string" && typeof part.name === "string") {
        calls.push({ id: part.id, name: part.name, args: (part.arguments ?? {}) as unknown });
      }
    }
  }
  return calls;
}

/**
 * Pure diff renderer: translate a ConversationView snapshot into
 * UIMessageStream chunks. Only new/changed content since the cursor
 * produces chunks, so snapshots replay safely.
 */
export function renderDurableViewDiff(
  view: { entries: Array<{ id: string; kind: string; model?: Array<Record<string, unknown>> }> },
  cursor: DurableStreamCursor,
): Array<Record<string, unknown>> {
  const chunks: Array<Record<string, unknown>> = [];
  for (const entry of view.entries) {
    if (entry.kind === "pi.assistant") {
      const text = assistantTextOf(entry.model);
      const emitted = cursor.emittedText.get(entry.id) ?? 0;
      if (emitted === 0 && text.length > 0) {
        chunks.push({ type: "text-start", id: entry.id });
        cursor.openText.add(entry.id);
      }
      if (text.length > emitted) {
        chunks.push({ type: "text-delta", id: entry.id, delta: text.slice(emitted) });
        cursor.emittedText.set(entry.id, text.length);
      }
      for (const call of toolCallsOf(entry.model)) {
        if (cursor.emittedToolCalls.has(call.id)) continue;
        cursor.emittedToolCalls.add(call.id);
        chunks.push({ type: "tool-input-available", toolCallId: call.id, toolName: call.name, input: call.args });
      }
    } else if (entry.kind === "pi.tool-result") {
      if (cursor.emittedResults.has(entry.id)) continue;
      cursor.emittedResults.add(entry.id);
      const msgs = Array.isArray(entry.model) ? entry.model : [];
      for (const msg of msgs as Array<Record<string, unknown>>) {
        if (msg?.role !== "toolResult" || typeof msg.toolCallId !== "string") continue;
        const parts = Array.isArray(msg.content) ? (msg.content as Array<Record<string, unknown>>) : [];
        const text = parts.filter((p) => p?.type === "text").map((p) => String(p.text ?? "")).join("");
        if (msg.isError === true) {
          chunks.push({ type: "tool-output-error", toolCallId: msg.toolCallId, errorText: text.slice(0, 2000) || "Tool failed" });
        } else {
          chunks.push({ type: "tool-output-available", toolCallId: msg.toolCallId, output: text });
        }
      }
    }
  }
  return chunks;
}

export function closeDurableStreamCursor(cursor: DurableStreamCursor): Array<Record<string, unknown>> {
  const chunks: Array<Record<string, unknown>> = [];
  for (const id of cursor.openText) chunks.push({ type: "text-end", id });
  cursor.openText.clear();
  return chunks;
}

/** Mark a view as fully seen without emitting (baseline before a new turn). */
export function baselineDurableCursor(
  view: { entries: Array<{ id: string; kind: string; model?: Array<Record<string, unknown>> }> },
  cursor: DurableStreamCursor,
): void {
  for (const entry of view.entries) {
    if (entry.kind === "pi.assistant") {
      cursor.emittedText.set(entry.id, assistantTextOf(entry.model).length);
      for (const call of toolCallsOf(entry.model)) cursor.emittedToolCalls.add(call.id);
    } else if (entry.kind === "pi.tool-result") {
      cursor.emittedResults.add(entry.id);
    }
  }
}

/**
 * Stream one durable turn into a UIMessageStream writer: subscribe to the
 * conversation view, submit the input, forward diffs until settlement.
 */
export async function streamDurableToWriter(
  threadId: string,
  text: string,
  requestId: string,
  writer: { write: (chunk: unknown) => void },
  opts?: { context?: typeof BACKGROUND_CONTEXT; signal?: AbortSignal; modelName?: string; reasoningEffort?: string },
): Promise<void> {
  const context = opts?.context ?? BACKGROUND_CONTEXT;
  const { formatProviderError } = await import("@/lib/pi/harness");
  const conv = await syncConversationAgent(
    threadId,
    { modelName: opts?.modelName ?? null, reasoningEffort: opts?.reasoningEffort },
    context,
  );
  const cursor = createDurableStreamCursor();
  const view = await conv.viewState(context);
  const current = (view as unknown as { value?: unknown }).value ?? view;
  baselineDurableCursor((current as { entries: [] }).entries ? (current as never) : { entries: [] }, cursor);
  let disposed = false;
  let sub: { dispose?: () => void } | undefined;
  try {
    sub = (view as unknown as { subscribe?: (fn: (v: never) => void) => { dispose?: () => void } }).subscribe?.((v) => {
      try {
        for (const chunk of renderDurableViewDiff(v as never, cursor)) writer.write(chunk);
      } catch {}
    }) as never;
  } catch {}
  const submission = await conv.submit({ type: "input", content: text, requestId } as never, context);
  const abort = opts?.signal;
  try {
    if (abort?.aborted) throw new DOMException("Aborted before durable wait", "AbortError");
    const settled = await Promise.race([
      submission.wait(context),
      ...(abort ? [new Promise<never>((_, reject) => abort.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }))] : []),
    ]);
    for (const chunk of renderDurableViewDiff(((view as unknown as { value?: unknown }).value ?? {}) as never, cursor)) {
      try { writer.write(chunk); } catch {}
    }
    void settled;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort/i.test(msg)) throw e;
    const hint = formatProviderError(msg, opts?.modelName, true);
    const id = `pi-durable-error-${Date.now()}`;
    try {
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: hint });
      writer.write({ type: "text-end", id });
    } catch {}
    throw e;
  } finally {
    if (!disposed) {
      disposed = true;
      try { sub?.dispose?.(); } catch {}
      try { (view as unknown as { dispose?: () => void }).dispose?.(); } catch {}
      for (const chunk of closeDurableStreamCursor(cursor)) {
        try { writer.write(chunk); } catch {}
      }
    }
  }
}
