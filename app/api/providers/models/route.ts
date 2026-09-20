export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { baseURL, apiKey, providerId } = body as {
      baseURL?: string;
      apiKey?: string;
      providerId?: string;
    };

    if (!baseURL || typeof baseURL !== "string") {
      return Response.json({ error: "baseURL is required" }, { status: 400 });
    }

    const base = baseURL.replace(/\/+$/, "");

    const tryFetch = async (url: string): Promise<Response> => {
      return fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey || ""}`,
          "Content-Type": "application/json",
        },
      });
    };

    let url = base + "/models";
    let res = await tryFetch(url);

    if (res.status === 404 && !base.endsWith("/v1")) {
      url = base + "/v1/models";
      res = await tryFetch(url);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      let hint = "";
      if (res.status === 401) {
        hint = " Invalid API key — check the key and try again.";
      } else if (res.status === 403) {
        hint = " Access forbidden — the key may lack permission for this endpoint or the workspace may be blocked.";
        if (/FreeTier/i.test(errText)) {
          hint =
            " OpenCode Zen free tier can only be used from within the official OpenCode client. " +
            "Use a paid Zen model with billing enabled, or another provider.";
        }
      } else if (res.status === 429) {
        hint = " Rate-limited — the provider is throttling requests. Wait a minute and try again.";
      }
      return Response.json(
        {
          error: `Failed to fetch models from ${url}: ${res.status} ${res.statusText}.${hint}`,
          note: "Note: listing models only checks the key — chat quota is checked separately when you send a message.",
        },
        { status: res.status }
      );
    }

    const json = await res.json();

    // Ollama's OpenAI-compatible /v1/models carries no capability info, so
    // vision/thinking detection upstream falls back to name guessing (wrong
    // for e.g. gemma4, qwen3.5, nemotron). The native /api/show endpoint
    // returns ground-truth `capabilities` (completion/vision/thinking/tools…),
    // so enrich each entry when talking to an Ollama host. Fail-open per
    // model: a single /api/show failure never breaks the whole list.
    if (isOllamaBase(base, providerId) && Array.isArray((json as any)?.data)) {
      await enrichOllamaCapabilities(base, (json as any).data as Array<Record<string, any>>);
    }

    return Response.json(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}

function isOllamaBase(base: string, providerId?: string): boolean {
  // Only Ollama serves the native /api/show API (LM Studio does not).
  if (providerId === "ollama") return true;
  if (providerId === "lmstudio") return false;
  try {
    const u = new URL(base);
    const host = u.hostname.toLowerCase();
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
    return isLocal && (u.port === "11434" || base.includes(":11434"));
  } catch {
    return false;
  }
}

function ollamaNativeBase(base: string): string {
  // http://localhost:11434/v1 -> http://localhost:11434
  return base.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
}

async function enrichOllamaCapabilities(
  base: string,
  models: Array<Record<string, any>>,
): Promise<void> {
  const native = ollamaNativeBase(base);
  // Bound parallelism: model lists are short, /api/show needs the model on
  // disk metadata only (no inference), ~ms each. Sequential in small batches.
  const BATCH = 4;
  const withTimeout = async (modelId: string): Promise<string[] | null> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(`${native}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
        signal: ctrl.signal,
      });
      if (!r.ok) return null;
      const info = await r.json().catch(() => null);
      const caps = (info as any)?.capabilities;
      return Array.isArray(caps) ? caps.map((c: unknown) => String(c)) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  for (let i = 0; i < models.length; i += BATCH) {
    const batch = models.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((m) => withTimeout(String(m.id))));
    results.forEach((caps, j) => {
      if (caps) batch[j].capabilities = caps;
    });
  }
}
