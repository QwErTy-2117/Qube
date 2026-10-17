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
