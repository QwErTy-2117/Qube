import { createOpenAI } from "@ai-sdk/openai";
import { createMistral } from "@ai-sdk/mistral";
import { providerStore } from "./provider-store";

type ChatModel = ReturnType<ReturnType<typeof createOpenAI>["chat"]> | ReturnType<ReturnType<typeof createOpenAI>["responses"]>;

// OpenCode Zen model routing (https://opencode.ai/docs/zen/):
// - GPT / Grok / Muse-Spark families live behind /responses (OpenAI Responses API)
// - DeepSeek / GLM / Kimi / MiniMax / Big Pickle / free models live behind
//   /chat/completions (OpenAI Chat Completions API)
// - Claude / Qwen (Anthropic Messages API) and Gemini (Google Generative API)
//   need dedicated SDKs which Qube does not bundle — surface a clear error.
const ZEN_RESPONSES_PATTERNS = [/^gpt-/i, /^grok/i, /^muse-spark/i];
const ZEN_ANTHROPIC_PATTERNS = [/^claude/i, /^qwen/i];
const ZEN_GOOGLE_PATTERNS = [/^gemini/i];

function isZenResponsesModel(modelId: string): boolean {
  return ZEN_RESPONSES_PATTERNS.some((re) => re.test(modelId));
}

function zenUnsupportedReason(modelId: string): string | null {
  if (ZEN_ANTHROPIC_PATTERNS.some((re) => re.test(modelId))) {
    return (
      `Zen model "${modelId}" uses the Anthropic Messages API (https://opencode.ai/zen/v1/messages), ` +
      `which Qube does not support yet. Pick a GPT, DeepSeek, GLM, Kimi, MiniMax or Big Pickle model instead, ` +
      `or use the provider's direct API key.`
    );
  }
  if (ZEN_GOOGLE_PATTERNS.some((re) => re.test(modelId))) {
    return (
      `Zen model "${modelId}" uses the Google Generative API, which Qube does not support yet. ` +
      `Pick a GPT, DeepSeek, GLM, Kimi, MiniMax or Big Pickle model instead.`
    );
  }
  if (/^jev-/i.test(modelId)) {
    return (
      `Zen model "${modelId}" uses a custom SystemOne endpoint which Qube does not support. ` +
      `Pick another Zen model.`
    );
  }
  return null;
}

export function createPiModelClient(qualifiedModelId?: string | null): ChatModel {
  let modelIdToUse = qualifiedModelId;
  if (!modelIdToUse || modelIdToUse === "undefined" || modelIdToUse === "null") {
    modelIdToUse = providerStore.getDefaultModelId() || "";
  }

  let result = providerStore.getProviderByModel(modelIdToUse);
  if (!result) {
    const defaultModel = providerStore.getDefaultModelId();
    if (defaultModel && defaultModel !== modelIdToUse) {
      result = providerStore.getProviderByModel(defaultModel);
      if (result) {
        modelIdToUse = defaultModel;
      }
    }
  }

  if (!result) {
    throw new Error(
      `No provider found for model "${modelIdToUse || qualifiedModelId}". Make sure the provider is configured and synced.`
    );
  }
  const { provider, modelId } = result;

  if (provider.id === "chatgpt") {
    throw new Error(
      `ChatGPT model "${modelIdToUse}" requires request context (user session). Use createPiModelClientForRequest() from a route handler.`
    );
  }

  const effectiveBaseURL = provider.baseURL;

  if (provider.id === "mistral") {
    const client = createMistral({
      apiKey: provider.apiKey || "",
      baseURL: effectiveBaseURL,
    });
    return client.chat(modelId);
  }

  if (provider.id === "opencode") {
    const unsupported = zenUnsupportedReason(modelId);
    if (unsupported) throw new Error(unsupported);
    const client = createOpenAI({
      apiKey: provider.apiKey || "",
      baseURL: effectiveBaseURL || "https://opencode.ai/zen/v1",
    });
    // GPT/Grok/Muse-Spark live behind /responses; everything else Qube
    // supports lives behind /chat/completions.
    if (isZenResponsesModel(modelId)) {
      return (client as any).responses(modelId);
    }
    return client.chat(modelId);
  }

  const client = createOpenAI({
    apiKey: provider.apiKey || "",
    baseURL: effectiveBaseURL,
  });
  return client.chat(modelId);
}

export function createPiModelClientForRequest(
  qualifiedModelId: string | null | undefined,
  request: Request
): ChatModel {
  let modelIdToUse = qualifiedModelId;
  if (!modelIdToUse || modelIdToUse === "undefined" || modelIdToUse === "null") {
    modelIdToUse = providerStore.getDefaultModelId() || "";
  }

  let result = providerStore.getProviderByModel(modelIdToUse);
  if (!result) {
    const defaultModel = providerStore.getDefaultModelId();
    if (defaultModel && defaultModel !== modelIdToUse) {
      result = providerStore.getProviderByModel(defaultModel);
      if (result) {
        modelIdToUse = defaultModel;
      }
    }
  }

  if (!result) {
    throw new Error(
      `No provider found for model "${modelIdToUse || qualifiedModelId}". Make sure the provider is configured and synced.`
    );
  }
  const { provider, modelId } = result;

  if (provider.id === "chatgpt") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { chatGptAuth } = require("@/lib/chatgpt/handler") as typeof import("@/lib/chatgpt/handler");
    const baseFetch = chatGptAuth.proxyFetch(request) as typeof fetch;
    const client = createOpenAI({
      baseURL: "/api/chatgpt",
      apiKey: "login-with-chatgpt-proxy",
      fetch: baseFetch as any,
    });
    return (client as any).responses(modelId);
  }

  const effectiveBaseURL = provider.baseURL;

  if (provider.id === "mistral") {
    const client = createMistral({
      apiKey: provider.apiKey || "",
      baseURL: effectiveBaseURL,
    });
    return client.chat(modelId);
  }

  if (provider.id === "opencode") {
    const unsupported = zenUnsupportedReason(modelId);
    if (unsupported) throw new Error(unsupported);
    const client = createOpenAI({
      apiKey: provider.apiKey || "",
      baseURL: effectiveBaseURL || "https://opencode.ai/zen/v1",
    });
    if (isZenResponsesModel(modelId)) {
      return (client as any).responses(modelId);
    }
    return client.chat(modelId);
  }

  const client = createOpenAI({
    apiKey: provider.apiKey || "",
    baseURL: effectiveBaseURL,
  });
  return client.chat(modelId);
}

export function isChatGPTModel(qualifiedModelId?: string | null): boolean {
  if (!qualifiedModelId) {
    const def = providerStore.getDefaultModelId();
    if (!def) return false;
    qualifiedModelId = def;
  }
  return qualifiedModelId.startsWith("chatgpt:");
}

// Back-compat re-exports used by older callers that imported from pi/model-client directly
export const createModelClient = createPiModelClient;
export const createModelClientForRequest = createPiModelClientForRequest;
