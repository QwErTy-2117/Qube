import { createOpenAI } from "@ai-sdk/openai";
import { createMistral } from "@ai-sdk/mistral";
import { providerStore } from "./provider-store";

type ChatModel = ReturnType<ReturnType<typeof createOpenAI>["chat"]> | ReturnType<ReturnType<typeof createOpenAI>["responses"]>;

// Force stream:true for every AI request — Pi harness ensures streaming
function wrapFetchWithStreamTrue(fetchFn: typeof fetch): typeof fetch {
  const tryPatch = (bodyStr: string): string | null => {
    try {
      const parsed = JSON.parse(bodyStr);
      if (parsed && typeof parsed === "object" && (parsed as any).stream !== true && ((parsed as any).model || (parsed as any).messages || (parsed as any).input || (parsed as any).prompt)) {
        (parsed as any).stream = true;
        return JSON.stringify(parsed);
      }
    } catch {}
    return null;
  };
  return (async (input: any, init?: any) => {
    try {
      if (init?.body && typeof init.body === "string") {
        const patched = tryPatch(init.body);
        if (patched) {
          const headers = new Headers(init.headers as HeadersInit);
          headers.delete("content-length");
          headers.set("content-type", "application/json");
          init = { ...init, body: patched, headers };
        }
      } else if (input instanceof Request) {
        const text = await (input as Request).clone().text().catch(() => "");
        if (text) {
          const patched = tryPatch(text);
          if (patched) {
            const headers = new Headers((input as Request).headers);
            headers.delete("content-length");
            headers.set("content-type", "application/json");
            const newReq: any = new Request((input as Request).url, {
              method: (input as Request).method,
              headers,
              body: patched,
              // @ts-ignore - duplex required for Node fetch with body
              duplex: "half",
            } as any);
            if ((input as any).signal) newReq.signal = (input as any).signal;
            input = newReq;
          }
        }
      }
    } catch {}
    return (fetchFn as any)(input, init);
  }) as typeof fetch;
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
  const streamFetch = wrapFetchWithStreamTrue(globalThis.fetch.bind(globalThis) as unknown as typeof fetch);

  if (provider.id === "mistral") {
    const client = createMistral({
      apiKey: provider.apiKey || "",
      baseURL: effectiveBaseURL,
      fetch: streamFetch as any,
    });
    return client.chat(modelId);
  }

  const client = createOpenAI({
    apiKey: provider.apiKey || "",
    baseURL: effectiveBaseURL,
    fetch: streamFetch as any,
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
    const streamFetch = wrapFetchWithStreamTrue(baseFetch);
    const client = createOpenAI({
      baseURL: "/api/chatgpt",
      apiKey: "login-with-chatgpt-proxy",
      fetch: streamFetch as any,
    });
    return (client as any).responses(modelId);
  }

  const effectiveBaseURL = provider.baseURL;
  const streamFetch = wrapFetchWithStreamTrue(globalThis.fetch.bind(globalThis) as unknown as typeof fetch);

  if (provider.id === "mistral") {
    const client = createMistral({
      apiKey: provider.apiKey || "",
      baseURL: effectiveBaseURL,
      fetch: streamFetch as any,
    });
    return client.chat(modelId);
  }

  const client = createOpenAI({
    apiKey: provider.apiKey || "",
    baseURL: effectiveBaseURL,
    fetch: streamFetch as any,
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
