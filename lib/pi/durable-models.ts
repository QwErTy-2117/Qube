import { createModels } from "@earendil-works/pi-ai/models";
import { providerStore } from "@/lib/pi/provider-store";

/** Qube provider id → pi-ai provider module (dynamic import specifier). */
const PROVIDER_MODULES: Record<string, string> = {
  openai: "@earendil-works/pi-ai/providers/openai",
  anthropic: "@earendil-works/pi-ai/providers/anthropic",
  google: "@earendil-works/pi-ai/providers/google",
  mistral: "@earendil-works/pi-ai/providers/mistral",
  deepseek: "@earendil-works/pi-ai/providers/deepseek",
  xai: "@earendil-works/pi-ai/providers/xai",
  groq: "@earendil-works/pi-ai/providers/groq",
  together: "@earendil-works/pi-ai/providers/together",
  openrouter: "@earendil-works/pi-ai/providers/openrouter",
  fireworks: "@earendil-works/pi-ai/providers/fireworks",
  cerebras: "@earendil-works/pi-ai/providers/cerebras",
  huggingface: "@earendil-works/pi-ai/providers/huggingface",
  moonshot: "@earendil-works/pi-ai/providers/moonshotai",
  minimax: "@earendil-works/pi-ai/providers/minimax",
  azure: "@earendil-works/pi-ai/providers/azure",
  bedrock: "@earendil-works/pi-ai/providers/amazon-bedrock",
  vertexai: "@earendil-works/pi-ai/providers/google-vertex",
  nvidia: "@earendil-works/pi-ai/providers/nvidia",
};

/** Qube provider id → pi-ai factory export name. */
const FACTORY_NAMES: Record<string, string> = {
  openai: "openaiProvider",
  anthropic: "anthropicProvider",
  google: "googleProvider",
  mistral: "mistralProvider",
  deepseek: "deepseekProvider",
  xai: "xaiProvider",
  groq: "groqProvider",
  together: "togetherProvider",
  openrouter: "openrouterProvider",
  fireworks: "fireworksProvider",
  cerebras: "cerebrasProvider",
  huggingface: "huggingfaceProvider",
  moonshot: "moonshotaiProvider",
  minimax: "minimaxProvider",
  azure: "azureProvider",
  bedrock: "amazonBedrockProvider",
  vertexai: "googleVertexProvider",
  nvidia: "nvidiaProvider",
};

/**
 * OpenAI-compatible providers without a dedicated pi-ai factory.
 * They fall back to the OpenAI provider (env-keyed); per-key/baseURL
 * injection and the request-scoped ChatGPT OAuth client are not yet
 * bridged — generation without a matching env key fails with a clear
 * provider error instead of silently picking the wrong account.
 */
const OPENAI_COMPATIBLE_FALLBACK = new Set([
  "ollama",
  "lmstudio",
  "perplexity",
  "cohere",
  "sambanova",
  "deepinfra",
  "nebius",
  "novita",
  "siliconflow",
  "stepfun",
  "alibaba",
  "volcengine",
  "hunyuan",
  "spark",
  "yi",
  "upstage",
  "ai21",
  "replicate",
  "anyscale",
  "ppio",
  "zhipu",
  "opencode",
  "custom",
  "chatgpt",
  "github",
  "cloudflare",
  "vercel",
]);

export function resolveProviderModule(providerId: string): { module: string; factory: string } | null {
  const module = PROVIDER_MODULES[providerId];
  const factory = FACTORY_NAMES[providerId];
  if (module && factory) return { module, factory };
  return null;
}

/** Qube provider id → pi-ai ProviderId used in conversation ModelRefs. */
const PI_AI_PROVIDER_IDS: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  mistral: "mistral",
  deepseek: "deepseek",
  xai: "xai",
  groq: "groq",
  together: "together",
  openrouter: "openrouter",
  fireworks: "fireworks",
  cerebras: "cerebras",
  huggingface: "huggingface",
  moonshot: "moonshotai",
  minimax: "minimax",
  azure: "azure",
  bedrock: "amazon-bedrock",
  vertexai: "google-vertex",
  nvidia: "nvidia",
};

const PI_AI_TO_QUBE: Record<string, string> = Object.fromEntries(
  Object.entries(PI_AI_PROVIDER_IDS).map(([qube, pi]) => [pi, qube]),
);

/** Reverse lookup: pi-ai provider id → Qube provider id (dedicated ones). */
export function qubeProviderForPiAi(piAiId: string): string | undefined {
  return PI_AI_TO_QUBE[piAiId];
}

export type DurableModelRef = { provider: string; modelId: string };

/**
 * Map a Qube "provider:model" id to a pi-ai ModelRef. Dedicated factories
 * use their pi-ai provider id; OpenAI-compatible providers without one
 * (ollama, lmstudio, chatgpt, custom, …) address the OpenAI provider with
 * the unchanged model id. Returns null for unknown prefixes.
 */
export function resolveModelRef(qubeModelId: string): DurableModelRef | null {
  const idx = qubeModelId.indexOf(":");
  if (idx < 0) return null;
  const qubeProvider = qubeModelId.slice(0, idx);
  const modelId = qubeModelId.slice(idx + 1);
  if (!modelId) return null;
  const dedicated = PI_AI_PROVIDER_IDS[qubeProvider];
  if (dedicated) return { provider: dedicated, modelId };
  if (OPENAI_COMPATIBLE_FALLBACK.has(qubeProvider)) return { provider: "openai", modelId };
  return null;
}

const VALID_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** Map a Qube reasoning effort to a pi-ai thinking level (defaults to off). */
export function resolveThinkingLevel(effort: string | undefined): string {
  if (effort && VALID_THINKING_LEVELS.has(effort)) return effort;
  return "off";
}

export async function buildDurableModels(modelName: string, _request?: Request) {
  const found = providerStore.getProviderByModel(modelName);
  let providerId: string | undefined = found?.provider.id;
  if (!providerId) {
    const prefix = modelName.split(":")[0] ?? "";
    if (PROVIDER_MODULES[prefix] || OPENAI_COMPATIBLE_FALLBACK.has(prefix)) providerId = prefix;
    else throw new Error(`No provider for model "${modelName}"`);
  }
  const { createQubeCredentialStore } = await import("@/lib/pi/durable-credentials");
  const models = createModels({ credentials: createQubeCredentialStore() });
  const resolved = providerId ? resolveProviderModule(providerId) : null;
  if (resolved) {
    const mod = await import(resolved.module);
    const factory = mod[resolved.factory] as () => Parameters<typeof models.setProvider>[0];
    models.setProvider(factory());
  } else {
    const { openaiProvider } = await import("@earendil-works/pi-ai/providers/openai");
    models.setProvider(openaiProvider());
  }
  return models;
}
