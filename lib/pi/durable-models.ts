import { createModels } from "@earendil-works/pi-ai/models";
import { providerStore } from "@/lib/pi/provider-store";

const KNOWN_PROVIDERS = new Set(["openai", "anthropic", "google", "mistral"]);

export async function buildDurableModels(modelName: string, _request?: Request) {
  const found = providerStore.getProviderByModel(modelName);
  let providerId: string | undefined = found?.provider.id;
  if (!providerId) {
    const prefix = modelName.split(":")[0] ?? "";
    if (KNOWN_PROVIDERS.has(prefix)) providerId = prefix;
    else throw new Error(`No provider for model "${modelName}"`);
  }
  const models = createModels();
  if (providerId === "openai") {
    const { openaiProvider } = await import("@earendil-works/pi-ai/providers/openai");
    models.setProvider(openaiProvider());
  } else if (providerId === "anthropic") {
    const { anthropicProvider } = await import("@earendil-works/pi-ai/providers/anthropic");
    models.setProvider(anthropicProvider());
  } else if (providerId === "google") {
    const { googleProvider } = await import("@earendil-works/pi-ai/providers/google");
    models.setProvider(googleProvider());
  } else if (providerId === "mistral") {
    const { mistralProvider } = await import("@earendil-works/pi-ai/providers/mistral");
    models.setProvider(mistralProvider());
  } else {
    const { openaiProvider } = await import("@earendil-works/pi-ai/providers/openai");
    models.setProvider(openaiProvider());
  }
  return models;
}
