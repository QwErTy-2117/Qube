import { createOpenAI } from "@ai-sdk/openai";
import { createMistral } from "@ai-sdk/mistral";
import { generateText } from "ai";

/**
 * POST /api/providers/validate
 * Minimal no-tools chat probe (1 short reply) to verify a key can actually
 * run inference — listing /models alone is NOT enough (it succeeds even when
 * chat quota is exhausted, the workspace is blocked, or the model needs a
 * different endpoint).
 *
 * Body: { providerId, baseURL, apiKey, modelId }
 * Returns { ok: true } or { ok: false, error, code, hint }.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { providerId, baseURL, apiKey, modelId } = body as {
      providerId?: string;
      baseURL?: string;
      apiKey?: string;
      modelId?: string;
    };

    if (!modelId || typeof modelId !== "string") {
      return Response.json({ ok: false, error: "modelId is required" }, { status: 400 });
    }

    const base = (baseURL || "").replace(/\/+$/, "");
    let model: any;
    try {
      if (providerId === "mistral") {
        const client = createMistral({ apiKey: apiKey || "", baseURL: base || undefined });
        model = client.chat(modelId);
      } else if (providerId === "opencode") {
        // Route like lib/pi/model-client.ts: GPT/Grok/Muse-Spark -> responses
        const isResponses = /^(gpt-|grok|muse-spark)/i.test(modelId);
        if (/^(claude|qwen|gemini|jev-)/i.test(modelId)) {
          return Response.json({
            ok: false,
            code: "UNSUPPORTED_ENDPOINT",
            error: `Zen model "${modelId}" needs an endpoint Qube does not support yet (Anthropic/Google/SystemOne). Pick a GPT, DeepSeek, GLM, Kimi, MiniMax or Big Pickle model.`,
          });
        }
        const client = createOpenAI({ apiKey: apiKey || "", baseURL: base || "https://opencode.ai/zen/v1" });
        model = isResponses ? (client as any).responses(modelId) : client.chat(modelId);
      } else {
        const client = createOpenAI({ apiKey: apiKey || "", baseURL: base || undefined });
        model = client.chat(modelId);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json({ ok: false, error: msg });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      await generateText({
        model,
        prompt: "Reply with exactly: ok",
        maxOutputTokens: 5,
        temperature: 0,
        abortSignal: controller.signal,
      } as any);
      return Response.json({ ok: true });
    } catch (e: any) {
      const status = e?.statusCode;
      const dataStr = (() => {
        try {
          return JSON.stringify(e?.data || e?.responseBody || "");
        } catch {
          return String(e?.data || "");
        }
      })();
      const msg = e instanceof Error ? e.message : String(e);
      const combined = `${msg} ${dataStr}`;

      // Classify for actionable hints
      if (/FreeTier/i.test(combined) || /only be used from within OpenCode/i.test(combined)) {
        return Response.json({
          ok: false,
          code: "ZEN_FREE_TIER_BLOCKED",
          error: "OpenCode Zen free tier can only be used from within the official OpenCode client.",
          hint: "This is enforced by OpenCode, not Qube. Use a paid Zen model (add billing at opencode.ai/zen) or another provider.",
        });
      }
      if (status === 401 || /invalid.*api.*key|unauthorized|authentication/i.test(combined)) {
        return Response.json({
          ok: false,
          code: "INVALID_KEY",
          error: "Invalid API key (401).",
          hint: "Check the key, make sure billing is enabled if required, and try again.",
        });
      }
      if (status === 429 || /rate limit|rate_limited|429/i.test(combined)) {
        return Response.json({
          ok: false,
          code: "RATE_LIMITED",
          error: "Rate limit / quota exceeded (429). The key lists models fine but has no chat quota left.",
          hint: "Check billing/credits for this provider, wait 1-2 min, or try a different model. Ollama (local) needs no key.",
        });
      }
      if (status === 403 || /blocked by upstream|workspace.*block/i.test(combined)) {
        return Response.json({
          ok: false,
          code: "BLOCKED",
          error: "Request blocked (403) — workspace or account flagged upstream.",
          hint: "Check the provider dashboard (billing, workspace status, enabled models).",
        });
      }
      if (status === 404 || /not found|no such model/i.test(combined)) {
        return Response.json({
          ok: false,
          code: "MODEL_NOT_FOUND",
          error: `Model "${modelId}" not found on this endpoint (404).`,
          hint: "For Zen GPT models Qube uses /responses; for others /chat/completions. Claude/Gemini via Zen are not supported yet.",
        });
      }
      return Response.json({
        ok: false,
        code: status ? `HTTP_${status}` : "PROBE_FAILED",
        error: msg.slice(0, 500),
        hint: "Listing models succeeded but a test chat failed — the key may lack chat quota.",
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
