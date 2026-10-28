import { createChatGPTHandler } from "@opencoredev/loginwithchatgpt-server";
import { createOpenAI } from "@ai-sdk/openai";
import { filterChatGPTModelsByPlan, isPlanOrLimitError } from "@/lib/chatgpt/models";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { getDataDir } from "@/lib/data-dir";
import type { KeyValueStore } from "@opencoredev/loginwithchatgpt-core";
import { getChatGPTClientVersion, refreshChatGPTClientVersion } from "./client-version";

/**
 * Stable secret handling:
 * - Use LWC_SECRET env if present
 * - Otherwise persist a generated secret to .memory/lwc-secret.txt so restarts don't invalidate sessions
 * - Fallback to ephemeral (dev only) if file write fails
 */
function getOrCreateSecret(): string | undefined {
  if (process.env.LWC_SECRET) return process.env.LWC_SECRET;
  try {
    const dir = join(getDataDir(), ".memory");
    const secretFile = join(dir, "lwc-secret.txt");
    if (existsSync(secretFile)) {
      const existing = readFileSync(secretFile, "utf-8").trim();
      if (existing && existing.length >= 32) return existing;
    }
    // generate 32 bytes hex
    const generated = randomBytes(32).toString("hex");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(secretFile, generated, "utf-8");
    return generated;
  } catch {
    return undefined; // handler will create ephemeral and warn
  }
}

const secret = getOrCreateSecret();

// File-backed session store for dev persistence (survives restart, single instance).
// For production / multi-instance, replace with Redis/DB store via sessionStore option.
class FileStore<T> implements KeyValueStore<T> {
  private mem = new Map<string, { value: T; expiresAt?: number }>();
  private filePath: string;
  private loaded = false;

  constructor() {
    this.filePath = join(getDataDir(), ".memory", "chatgpt-sessions.json");
    this.load();
  }

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        const data = JSON.parse(raw);
        if (data && typeof data === "object") {
          for (const [k, v] of Object.entries(data)) {
            this.mem.set(k, v as any);
          }
        }
      }
    } catch {}
  }

  private persist() {
    try {
      const dir = join(getDataDir(), ".memory");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const obj: Record<string, any> = {};
      const now = Date.now();
      for (const [k, v] of this.mem.entries()) {
        if (v.expiresAt && v.expiresAt <= now) continue;
        obj[k] = v;
      }
      writeFileSync(this.filePath, JSON.stringify(obj, null, 2), "utf-8");
    } catch {}
  }

  async get(key: string): Promise<T | undefined> {
    const entry = this.mem.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.mem.delete(key);
      this.persist();
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: T, opts?: { ttlMs?: number }): Promise<void> {
    const expiresAt = opts?.ttlMs ? Date.now() + opts.ttlMs : undefined;
    this.mem.set(key, { value, expiresAt } as any);
    this.persist();
  }

  async delete(key: string): Promise<void> {
    this.mem.delete(key);
    this.persist();
  }

  /** Hard reset: forget cached sign-in state without recreating its file. */
  clearForHardReset(): void {
    this.mem.clear();
    this.loaded = true;
  }
}

const sessionStore = new FileStore();

/** Hard reset helper for the live ChatGPT auth handler. */
export function clearChatGPTSessionsForHardReset(): void {
  sessionStore.clearForHardReset();
}

// The Codex backend gates its model catalog on `client_version`. The core
// package ships a default that goes stale as Codex CLI releases move on —
// stale values hide every model except `codex-auto-review` and make
// subscription chats look broken. Rewrite the query param per request so a
// background refresh from npm takes effect without recreating the handler.
const dynamicClientVersionFetch = (async (input: any, init?: any) => {
  try {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : String(input);
    if (raw.includes("/backend-api/codex/")) {
      const url = new URL(raw);
      url.searchParams.set("client_version", getChatGPTClientVersion());
      if (input instanceof Request) {
        return fetch(new Request(url.toString(), input), init);
      }
      return fetch(url.toString(), init);
    }
  } catch {}
  return fetch(input, init);
}) as typeof fetch;

export const chatGptAuth = createChatGPTHandler({
  secret,
  fetch: dynamicClientVersionFetch,
  clientVersion: getChatGPTClientVersion(),
  // @ts-ignore - allow FileStore to satisfy KeyValueStore
  sessionStore,
  allowedOrigins: [
    "http://localhost:3010",
    "http://127.0.0.1:3010",
    "http://localhost:3000",
    "tauri://localhost",
    "https://tauri.localhost",
    "http://tauri.localhost",
  ],
  responsesProxy: {
    // Allow all models returned by the account; handler will validate via upstream.
    // You can set a guardrail like: allowedModels: ["gpt-6-luna", "gpt-5.6-luna"]
    // Leave undefined to allow any model the signed-in account can access.
    // Agent runs make one model call per tool step, so the SDK's 30/min
    // default is too low and surfaced as bogus ChatGPT "quota" failures.
    rateLimit: { limit: 240, windowMs: 60_000 },
  },
  // Only used when a request omits `model` (Qube always sends one).
  defaultModel: process.env.LWC_DEFAULT_MODEL || "gpt-6-luna",
});

/**
 * Tauri prod can send Origin: tauri://localhost or Origin: null (opaque)
 * which the handler's strict CSRF check rejects with 403. Normal http origin
 * already passes via host equality, but tauri/null origins need sanitizing.
 */
function sanitizeOrigin(req: Request): Request {
  const origin = req.headers.get("origin");
  if (!origin) return req;
  const needsStrip =
    origin === "null" ||
    origin === "null," ||
    origin.startsWith("tauri://") ||
    origin.startsWith("https://tauri.") ||
    origin.startsWith("http://tauri.") ||
    origin.startsWith("capacitor://") ||
    origin.startsWith("ionic://");
  if (!needsStrip) return req;
  const headers = new Headers(req.headers);
  headers.delete("origin");
  // Clone request with cleaned headers; preserve method/body/signal
  try {
    return new Request(req, { headers, signal: (req as any).signal } as any);
  } catch {
    // Fallback: reconstruct manually — must preserve body + signal or
    // POST /responses arrives empty (invalid_responses_request).
    return new Request(req.url, {
      method: req.method,
      headers,
      body: (req as any).body,
      signal: (req as any).signal,
      // @ts-ignore duplex
      duplex: "half",
    } as any);
  }
}

// Fill a missing `stream` flag for /responses (AI SDK omits it in some
// versions). Do NOT override an explicit `stream:false` from generateText —
// forcing stream:true there returns SSE which generateText cannot parse as
// JSON ("Invalid JSON response") and made ChatGPT models look broken.
const _origHandler = chatGptAuth.handler.bind(chatGptAuth);
const _origProxyFetch = chatGptAuth.proxyFetch.bind(chatGptAuth);
const _origGetModels = chatGptAuth.getModels.bind(chatGptAuth);

async function ensureStreamFlag(req: Request): Promise<Request> {
  if (req.method !== "POST" || !req.url.includes("/responses")) return req;
  try {
    const text = await req.clone().text();
    if (!text) return req;
    const json = JSON.parse(text);
    if (json && typeof json === "object" && (json as any).stream == null) {
      (json as any).stream = true;
      const headers = new Headers(req.headers);
      headers.delete("content-length");
      headers.set("content-type", "application/json");
      return new Request(req.url, {
        method: req.method,
        headers,
        body: JSON.stringify(json),
        signal: (req as any).signal,
        // @ts-ignore - duplex required for Node fetch with body
        duplex: "half",
      } as any);
    }
  } catch {}
  return req;
}

(chatGptAuth as any).handler = async (req: Request) => {
  try {
    if (new URL(req.url).pathname.endsWith("/models")) {
      await refreshChatGPTClientVersion();
    }
  } catch {}
  const sanitized = sanitizeOrigin(req);
  const fixed = await ensureStreamFlag(sanitized);
  return _origHandler(fixed);
};
(chatGptAuth as any).fetch = (chatGptAuth as any).handler;

(chatGptAuth as any).getModels = async (req: Request) => {
  await refreshChatGPTClientVersion().catch(() => {});
  const live = await _origGetModels(req);
  if (!Array.isArray(live) || live.length === 0) return live;
  // Only probe when the account's model catalog is being listed for the
  // user — not when picking a replacement model mid-chat.
  if (!new URL(req.url).pathname.endsWith("/models")) return live;
    try {
    const origin = new URL(req.url).origin;
    const proxyBase = origin ? `${origin}/api/chatgpt` : "/api/chatgpt";
    const baseFetch = chatGptAuth.proxyFetch(req) as typeof fetch;
    const client = createOpenAI({
      baseURL: proxyBase,
      apiKey: "login-with-chatgpt-proxy",
      fetch: baseFetch as any,
    });
    const probe = async (modelId: string) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const { streamText } = await import("ai");
        const model = (client as any).responses(modelId);
        const res: any = await (streamText as any)({
          model,
          prompt: ".",
          maxOutputTokens: 1,
          temperature: 0,
          maxRetries: 0,
          abortSignal: controller.signal,
        });
        try {
          await res.consumeStream();
        } catch {}
        await res.text;
        return { ok: true, planLimited: false };
      } catch (e: any) {
        return {
          ok: false,
          planLimited: isPlanOrLimitError(e),
          error: String(e?.message ?? e).slice(0, 300),
        };
      } finally {
        clearTimeout(timer);
      }
    };
    return filterChatGPTModelsByPlan(live, probe);
  } catch (e) {
    console.error("[chatgpt] model plan-probe failed:", e);
    return live;
  }
};

(chatGptAuth as any).proxyFetch = (req: Request) => {
  const baseFetch = _origProxyFetch(req) as typeof fetch;
  const wrapped: typeof fetch = async (input: any, init?: any) => {
    try {
      if (init?.body && typeof init.body === "string") {
        const parsed = JSON.parse(init.body);
        // Only fill when missing — never flip an explicit stream:false
        // (generateText) to true, which breaks its JSON parsing.
        if (parsed && typeof parsed === "object" && parsed.stream == null) {
          parsed.stream = true;
          init = { ...init, body: JSON.stringify(parsed) };
          const h = new Headers(init.headers);
          h.delete("content-length");
          init.headers = h;
        }
      } else if (input instanceof Request) {
        const fixed = await ensureStreamFlag(input);
        if (fixed !== input) input = fixed;
      }
    } catch {}
    return baseFetch(input as any, init as any);
  };
  return wrapped;
};
