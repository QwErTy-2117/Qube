import { createOpenAI } from "@ai-sdk/openai";
import { createMistral } from "@ai-sdk/mistral";
import { providerStore } from "./provider-store";

type ChatModel = ReturnType<ReturnType<typeof createOpenAI>["chat"]>;

export function createModelClient(qualifiedModelId?: string | null): ChatModel {
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

  if (provider.id === "mistral") {
    const client = createMistral({
      apiKey: provider.apiKey || "",
      baseURL: provider.baseURL,
    });
    return client.chat(modelId);
  }

  const client = createOpenAI({
    apiKey: provider.apiKey || "",
    baseURL: provider.baseURL,
  });
  return client.chat(modelId);
}
