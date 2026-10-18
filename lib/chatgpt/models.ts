/**
 * ChatGPT's Codex backend exposes an internal `codex-auto-review` model to
 * every plan, even when the account's normal chat models are gated. Never
 * auto-select it as the user's chat model when a real model is available.
 */
export function isInternalChatGPTModel(modelId: string): boolean {
  return /(^|[-_/])auto-review$/i.test(modelId);
}

/**
 * Pick the model to use from the account's live catalog: keep the requested
 * model when the plan still has it, otherwise fall back to the first normal
 * chat model (the internal review model is only a last resort).
 */
export function pickChatGPTModel(live: readonly string[], requested?: string): string | undefined {
  if (requested && live.includes(requested)) return requested;
  const usable = live.filter((model) => !isInternalChatGPTModel(model));
  return usable[0] ?? live[0];
}

/**
 * Error signals that mean a model is genuinely unavailable on this account
 * because of the plan or a limit — as opposed to a network hiccup, 404, or
 * auth problem, where we keep the model in the list instead of hiding it.
 */
const PLAN_LIMIT_KEYWORDS = [
  "quota", "usage limit", "rate limit", "429", "402", "payment required",
  "subscription", "billing", "upgrade", "your plan", "plan limit",
  "not available in your plan", "plus plan", "pro plan", "chatgpt plus",
  "free plan", "free tier", "workspace member", "entitled", "eligible",
  "model is not available", "access to this model",
];

export function isPlanOrLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  const status = (err as any)?.status ?? (err as any)?.statusCode;
  if (status === 402 || status === 429) return true;
  return PLAN_LIMIT_KEYWORDS.some((k) => msg.includes(k));
}

export type ModelProbe = (modelId: string) => Promise<{
  ok: boolean;
  planLimited: boolean;
  error?: string;
}>;

/**
 * Probe each live model with a tiny test call and drop the ones that fail
 * because of the account's plan or limits. Other errors (network, 404, 401)
 * keep the model in the list — we don't want to hide models over a transient
 * failure we can't attribute to the plan.
 */
export async function filterChatGPTModelsByPlan(
  live: readonly string[],
  probe: ModelProbe,
  { concurrency = 4 }: { concurrency?: number } = {}
): Promise<string[]> {
  const queue = [...live];
  const results: Array<{ model: string; keep: boolean }> = [];
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(live.length, 1)) },
    async () => {
      while (queue.length > 0) {
        const model = queue.shift()!;
        try {
          const r = await probe(model);
          results.push({ model, keep: r.ok || !r.planLimited });
        } catch {
          results.push({ model, keep: true });
        }
      }
    }
  );
  await Promise.all(workers);
  return results.filter((r) => r.keep).map((r) => r.model);
}
