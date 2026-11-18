/**
 * Reasoning capture for OpenAI-compatible providers.
 *
 * The AI SDK's OpenAI Chat Completions parser only understands
 * `choices[].delta.content` and `choices[].delta.tool_calls`. Reasoning
 * fields that many gateways stream (`reasoning`, `reasoning_content`,
 * `reasoning_details`, `thinking`) are silently stripped, so the model's
 * thinking never reaches `streamText` and never renders in Qube.
 *
 * `reasoningAwareFetch` rewrites those deltas into the standard `content`
 * stream wrapped in a private tag, and `withReasoningExtraction` turns the
 * tagged text back into AI SDK reasoning parts with the stock
 * `extractReasoningMiddleware`. Nothing changes for providers that already
 * emit native reasoning parts — the middleware is a no-op there.
 */

import { extractReasoningMiddleware, wrapLanguageModel } from "ai";

/** Private marker; must stay in sync between the fetcher and the middleware. */
export const REASONING_TAG = "qube-reasoning";

type JsonRecord = Record<string, any>;

function reasoningTextOf(delta: JsonRecord): string {
  // Prefer the most explicit field. Some gateways duplicate the same text in
  // several fields, so only take the first non-empty source.
  for (const key of ["reasoning_content", "reasoning", "thinking"]) {
    const value = delta[key];
    if (typeof value === "string" && value.length > 0) return value;
  }

  const details = delta.reasoning_details;
  if (Array.isArray(details)) {
    let out = "";
    for (const detail of details) {
      if (!detail || typeof detail !== "object") continue;
      const text =
        typeof detail.text === "string"
          ? detail.text
          : typeof detail.thinking === "string"
            ? detail.thinking
            : typeof detail.summary === "string"
              ? detail.summary
              : "";
      if (text) out += text;
    }
    return out;
  }

  return "";
}

function syntheticChunk(meta: { id?: string; model?: string; created?: number }, content: string): string {
  const payload = {
    id: meta.id || `chatcmpl-qube-${Date.now()}`,
    object: "chat.completion.chunk",
    created: meta.created || Math.floor(Date.now() / 1000),
    model: meta.model || "qube",
    choices: [{ index: 0, delta: { content }, finish_reason: null, logprobs: null }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function hasOutput(choice: JsonRecord, delta: JsonRecord): boolean {
  if (typeof delta.content === "string" && delta.content.length > 0) return true;
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) return true;
  return choice.finish_reason !== undefined && choice.finish_reason !== null;
}

/**
 * Transforms an OpenAI-compatible SSE byte stream so reasoning deltas become
 * tagged text. Tagged text is later split back out by
 * `extractReasoningMiddleware`, which is the only reliable way to get these
 * fields through the OpenAI provider's strict chunk schema.
 */
export function createReasoningSseTransform(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let reasoningOpen = false;
  const meta: { id?: string; model?: string; created?: number } = {};

  const closeReasoning = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (!reasoningOpen) return;
    reasoningOpen = false;
    controller.enqueue(encoder.encode(syntheticChunk(meta, `</${REASONING_TAG}>`)));
  };

  const handleData = (payload: string, controller: TransformStreamDefaultController<Uint8Array>): string | null => {
    if (payload === "[DONE]") {
      closeReasoning(controller);
      return null;
    }

    let parsed: JsonRecord;
    try {
      parsed = JSON.parse(payload) as JsonRecord;
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object") return null;

    if (typeof parsed.id === "string") meta.id = parsed.id;
    if (typeof parsed.model === "string") meta.model = parsed.model;
    if (typeof parsed.created === "number") meta.created = parsed.created;

    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    let changed = false;

    for (const choice of choices) {
      if (!choice || typeof choice !== "object") continue;
      const delta = (choice as JsonRecord).delta;
      if (!delta || typeof delta !== "object") continue;

      const reasoning = reasoningTextOf(delta);
      if (reasoning.length > 0) {
        changed = true;
        const existing = typeof delta.content === "string" ? delta.content : "";
        let content = "";
        if (!reasoningOpen) {
          content = `<${REASONING_TAG}>`;
          reasoningOpen = true;
        }
        content += reasoning;
        if (existing.length > 0) {
          content += `</${REASONING_TAG}>` + existing;
          reasoningOpen = false;
        }
        delta.content = content;
        delete delta.reasoning;
        delete delta.reasoning_content;
        delete delta.thinking;
        delete delta.reasoning_details;
      } else if (reasoningOpen && hasOutput(choice as JsonRecord, delta)) {
        // Real content or a tool call ends the thinking block. Emit the
        // closing tag as its own event before the untouched original.
        closeReasoning(controller);
      }
    }

    return changed ? JSON.stringify(parsed) : null;
  };

  const handleLine = (line: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (clean.startsWith("data:")) {
      const payload = clean.slice(5).trimStart();
      if (payload.length > 0) {
        const rewritten = handleData(payload, controller);
        if (rewritten !== null) {
          controller.enqueue(encoder.encode(`data: ${rewritten}\n`));
          return;
        }
      }
    }
    controller.enqueue(encoder.encode(`${clean}\n`));
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        handleLine(line, controller);
        newline = buffer.indexOf("\n");
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.length > 0) handleLine(buffer, controller);
      closeReasoning(controller);
    },
  });
}

/** `fetch` that makes OpenAI-compatible reasoning deltas visible to the AI SDK. */
export async function reasoningAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  const contentType = response.headers.get("content-type") || "";
  if (!response.body || !contentType.includes("text/event-stream")) return response;

  const headers = new Headers(response.headers);
  // The body is decoded and rewritten, so upstream framing headers no longer apply.
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("transfer-encoding");

  return new Response(response.body.pipeThrough(createReasoningSseTransform()), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Wrap a language model so tagged reasoning becomes native reasoning parts. */
export function withReasoningExtraction<T>(model: T): T {
  return wrapLanguageModel({
    model: model as any,
    middleware: extractReasoningMiddleware({ tagName: REASONING_TAG }),
  }) as unknown as T;
}
