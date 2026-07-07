import { createOpenAI } from "@ai-sdk/openai";

export const zen = createOpenAI({
  apiKey: process.env.OPENCODE_API_KEY,
  baseURL: "https://opencode.ai/zen/v1",
});

export const ALLOWED_MODELS = [
  "deepseek-v4-flash-free",
  "nemotron-3-ultra-free",
  "mimo-v2.5-free",
] as const;

export type ZenModel = typeof ALLOWED_MODELS[number];

export function resolveZenModel(modelName?: string): ZenModel {
  if (!modelName) return "deepseek-v4-flash-free";
  if (ALLOWED_MODELS.includes(modelName as any)) {
    return modelName as ZenModel;
  }
  const lower = modelName.toLowerCase();
  if (lower.includes("deepseek") || lower.includes("flash")) return "deepseek-v4-flash-free";
  if (lower.includes("nemotron")) return "nemotron-3-ultra-free";
  if (lower.includes("mimo")) return "mimo-v2.5-free";
  return "deepseek-v4-flash-free";
}
