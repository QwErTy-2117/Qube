import { createChatGPTHandler } from "@opencoredev/loginwithchatgpt-server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { getDataDir } from "@/lib/data-dir";
import type { KeyValueStore } from "@opencoredev/loginwithchatgpt-core";

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
}

export const chatGptAuth = createChatGPTHandler({
  secret,
  // @ts-ignore - allow FileStore to satisfy KeyValueStore
  sessionStore: new FileStore(),
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
    // You can set a guardrail like: allowedModels: ["gpt-5.5", "gpt-5", "gpt-4o", "o3", "o4-mini"]
    // Leave undefined to allow any model the signed-in account can access.
  },
  // Default model when request omits one; per-docs defaults to gpt-5.5
  defaultModel: "gpt-5.5",
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
    return new Request(req, { headers } as any);
  } catch {
    // Fallback: reconstruct manually
    return new Request(req.url, {
      method: req.method,
      headers,
      // @ts-ignore duplex
      duplex: "half",
    } as any);
  }
}

// Codex /responses requires stream:true — force it for every request so both
// streamText and generateText work. The AI SDK's generateText sends stream:false.
const _origHandler = chatGptAuth.handler.bind(chatGptAuth);
const _origProxyFetch = chatGptAuth.proxyFetch.bind(chatGptAuth);

async function forceStreamTrue(req: Request): Promise<Request> {
  if (req.method !== "POST" || !req.url.includes("/responses")) return req;
  try {
    const text = await req.clone().text();
    if (!text) return req;
    const json = JSON.parse(text);
    if (json && typeof json === "object" && (json as any).stream !== true) {
      (json as any).stream = true;
      const headers = new Headers(req.headers);
      headers.delete("content-length");
      headers.set("content-type", "application/json");
      return new Request(req.url, {
        method: req.method,
        headers,
        body: JSON.stringify(json),
        // @ts-ignore - duplex required for Node fetch with body
        duplex: "half",
      } as any);
    }
  } catch {}
  return req;
}

(chatGptAuth as any).handler = async (req: Request) => {
  const sanitized = sanitizeOrigin(req);
  const fixed = await forceStreamTrue(sanitized);
  return _origHandler(fixed);
};
(chatGptAuth as any).fetch = (chatGptAuth as any).handler;

(chatGptAuth as any).proxyFetch = (req: Request) => {
  const baseFetch = _origProxyFetch(req) as typeof fetch;
  const wrapped: typeof fetch = async (input: any, init?: any) => {
    try {
      if (init?.body && typeof init.body === "string") {
        const parsed = JSON.parse(init.body);
        if (parsed && typeof parsed === "object" && parsed.stream !== true) {
          parsed.stream = true;
          init = { ...init, body: JSON.stringify(parsed) };
          const h = new Headers(init.headers);
          h.delete("content-length");
          init.headers = h;
        }
      } else if (input instanceof Request) {
        const fixed = await forceStreamTrue(input);
        if (fixed !== input) input = fixed;
      }
    } catch {}
    return baseFetch(input as any, init as any);
  };
  return wrapped;
};
