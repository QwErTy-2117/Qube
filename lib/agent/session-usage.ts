import { readAllEvents } from "@/lib/agent/observability";
import { resolveContextWindow } from "@/lib/pi/context-budget";
import { providerStore } from "@/lib/pi/provider-store";

export type SessionUsageSummary = {
  model: string | null;
  contextWindow: number;
  usedTokens: number;
  remainingTokens: number;
  /** Cumulative provider prompt tokens billed this session. */
  inputTokens: number;
  /** Cumulative provider completion tokens billed this session. */
  outputTokens: number;
  totalTokens: number;
  /** Current context split: system prompt + tool schemas. */
  systemTokens: number;
  /** Current context split: conversation input (prompt minus system). */
  contextInputTokens: number;
  /** Current context split: latest completion. */
  contextOutputTokens: number;
  costUsd: number | null;
};

type Price = { input: number; output: number; cachedInput?: number };

function modelPricing(qualifiedModelId: string): { price: Price | null; contextWindow: number | null } {
  if (!qualifiedModelId) return { price: null, contextWindow: null };
  const match = providerStore.getProviderByModel(qualifiedModelId);
  if (!match) return { price: null, contextWindow: null };
  const { provider, modelId } = match;
  const model = provider.models.find((m) => m.id === qualifiedModelId || m.id === modelId);
  const contextWindow =
    typeof model?.contextWindow === "number" && model.contextWindow > 0
      ? model.contextWindow
      : null;
  // Subscription / locally hosted providers have no per-token list price.
  if (provider.id === "chatgpt" || provider.id === "ollama" || provider.id === "lmstudio") {
    return { price: null, contextWindow };
  }
  const pricing = model?.pricing;
  if (!pricing) return { price: null, contextWindow };
  const input = Number(pricing.input);
  const output = Number(pricing.output);
  if (!Number.isFinite(input) || !Number.isFinite(output) || (input <= 0 && output <= 0)) {
    return { price: null, contextWindow };
  }
  const cachedInput = Number(pricing.cachedInput);
  return {
    price: {
      input: Math.max(0, input),
      output: Math.max(0, output),
      ...(Number.isFinite(cachedInput) && cachedInput >= 0 ? { cachedInput } : {}),
    },
    contextWindow,
  };
}

/**
 * Aggregate the real provider usage recorded for a thread. Token counts come
 * from AI SDK usage events; cost is only returned when a gateway reported it
 * or the provider model carries explicit list pricing. A free/local model or a
 * model with no pricing metadata deliberately returns `costUsd: null`.
 */
export async function getSessionUsage(
  threadId: string,
  modelName?: string | null,
): Promise<SessionUsageSummary> {
  const events = await readAllEvents(threadId);
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let lastPromptTokens = 0;
  let lastCompletionTokens = 0;
  let lastEstimatedTokens = 0;
  let lastContextWindow = 0;
  let lastSystemTokens = 0;
  let lastToolTokens = 0;
  let lastModel = "";
  let reportedCost = 0;
  let reportedRounds = 0;
  let usageRounds = 0;
  let cachedInputTokens = 0;

  for (const event of events) {
    const meta = event?.metadata || {};
    if (event?.type === "model_usage") {
      const prompt = Number(meta.promptTokens ?? 0);
      const completion = Number(meta.completionTokens ?? 0);
      const total = Number(meta.totalTokens ?? prompt + completion);
      const cached = Number(meta.cachedInputTokens ?? 0);
      if (prompt > 0 || completion > 0) usageRounds += 1;
      inputTokens += Number.isFinite(prompt) ? prompt : 0;
      outputTokens += Number.isFinite(completion) ? completion : 0;
      totalTokens += Number.isFinite(total) ? total : 0;
      cachedInputTokens += Number.isFinite(cached) ? cached : 0;
      if (prompt > 0) lastPromptTokens = prompt;
      if (completion > 0) lastCompletionTokens = completion;
      if (typeof meta.model === "string" && meta.model) lastModel = meta.model;
      const cost = Number(meta.cost);
      if (Number.isFinite(cost) && cost > 0) {
        reportedCost += cost;
        reportedRounds += 1;
      }
    } else if (event?.type === "context_budget") {
      const estimated = Number(meta.estimatedTokens ?? 0);
      const window = Number(meta.contextWindow ?? 0);
      const system = Number(meta.systemTokens ?? 0);
      const tools = Number(meta.toolTokens ?? 0);
      if (estimated > 0) lastEstimatedTokens = estimated;
      if (window > 0) lastContextWindow = window;
      if (Number.isFinite(system) && system >= 0) lastSystemTokens = system;
      if (Number.isFinite(tools) && tools >= 0) lastToolTokens = tools;
    }
  }

  const model = modelName || lastModel || providerStore.getDefaultModelId() || null;
  const pricing = model ? modelPricing(model) : { price: null, contextWindow: null };
  const contextWindow =
    lastContextWindow > 0
      ? lastContextWindow
      : pricing.contextWindow ?? (model ? resolveContextWindow(model).tokens : 0);
  // The ring is a snapshot of the current context, not the cumulative bill:
  // the latest provider prompt is the whole conversation the model just saw,
  // and the latest completion is the output it produced from it.
  const currentPromptTokens = lastPromptTokens > 0 ? lastPromptTokens : lastEstimatedTokens;
  const currentCompletionTokens = lastPromptTokens > 0 ? lastCompletionTokens : 0;
  const usedTokens = currentPromptTokens + currentCompletionTokens;
  const remainingTokens = Math.max(0, contextWindow - usedTokens);
  // System prompt + tool schemas are fixed overhead inside the prompt. Older
  // threads predate this telemetry, so the clamp keeps the split coherent
  // until the next run logs a fresh context_budget event.
  const systemTokens = Math.min(
    currentPromptTokens,
    Math.max(0, lastSystemTokens + lastToolTokens),
  );
  const contextInputTokens = Math.max(0, currentPromptTokens - systemTokens);
  const contextOutputTokens = Math.max(0, currentCompletionTokens);

  let costUsd: number | null = null;
  if (reportedRounds > 0 && reportedRounds === usageRounds) {
    costUsd = reportedCost;
  } else if (pricing.price) {
    const billableInput = Math.max(0, inputTokens - cachedInputTokens);
    const cachedPrice = pricing.price.cachedInput ?? pricing.price.input;
    const computed =
      (billableInput * pricing.price.input) / 1_000_000 +
      (cachedInputTokens * cachedPrice) / 1_000_000 +
      (outputTokens * pricing.price.output) / 1_000_000;
    costUsd = computed > 0 ? computed : null;
  }

  return {
    model,
    contextWindow,
    usedTokens,
    remainingTokens,
    inputTokens,
    outputTokens,
    totalTokens,
    systemTokens,
    contextInputTokens,
    contextOutputTokens,
    costUsd,
  };
}
