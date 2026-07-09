import { createOpenAI } from "@ai-sdk/openai";
import { providerStore } from "./provider-store";

type OpenAIChatModel = ReturnType<ReturnType<typeof createOpenAI>["chat"]>;

export function createModelClient(qualifiedModelId: string): OpenAIChatModel {
  const result = providerStore.getProviderByModel(qualifiedModelId);
  if (!result) {
    throw new Error(
      `No provider found for model "${qualifiedModelId}". Make sure the provider is configured and synced.`
    );
  }
  const { provider, modelId } = result;
  const client = createOpenAI({
    apiKey: provider.apiKey || "",
    baseURL: provider.baseURL,
  });
  return client.chat(modelId);
}
