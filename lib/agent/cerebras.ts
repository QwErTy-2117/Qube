import { createOpenAI } from "@ai-sdk/openai";

const LOBE_TO_CEREBRAS_MODEL: Record<string, string> = {
  "z-ai/glm-5.2": "zai-glm-4.7",
  "minimaxai/minimax-m3": "gpt-oss-120b",
  "moonshotai/kimi-k2.6": "gemma-4-31b",
};

export const cerebras = createOpenAI({
  apiKey: process.env.CEREBRAS_API_KEY,
  baseURL: "https://api.cerebras.ai/v1",
});

export const ALLOWED_MODELS = [
  "zai-glm-4.7",
  "gpt-oss-120b",
  "gemma-4-31b",
] as const;

export type CerebrasModel = typeof ALLOWED_MODELS[number];

export function resolveCerebrasModel(modelName?: string): CerebrasModel {
  if (!modelName) return "zai-glm-4.7";
  if (ALLOWED_MODELS.includes(modelName as any)) {
    return modelName as CerebrasModel;
  }
  const lower = modelName.toLowerCase();
  if (lower.includes("glm")) return "zai-glm-4.7";
  if (lower.includes("oss") || lower.includes("gpt")) return "gpt-oss-120b";
  if (lower.includes("gemma")) return "gemma-4-31b";
  return "zai-glm-4.7";
}

export function toCerebrasModelId(modelName: string): string {
  return LOBE_TO_CEREBRAS_MODEL[modelName] ?? modelName;
}
