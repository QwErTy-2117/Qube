import OpenAI from "@lobehub/icons/es/OpenAI";
import Anthropic from "@lobehub/icons/es/Anthropic";
import Claude from "@lobehub/icons/es/Claude";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Gemini from "@lobehub/icons/es/Gemini";
import Groq from "@lobehub/icons/es/Groq";
import Mistral from "@lobehub/icons/es/Mistral";
import Cohere from "@lobehub/icons/es/Cohere";
import Together from "@lobehub/icons/es/Together";
import Fireworks from "@lobehub/icons/es/Fireworks";
import OpenRouter from "@lobehub/icons/es/OpenRouter";
import Ollama from "@lobehub/icons/es/Ollama";
import LmStudio from "@lobehub/icons/es/LmStudio";
import { SparklesIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import React from "react";

export const LOBE_ICONS_MAP: Record<string, any> = {
  OpenAI,
  Anthropic,
  Claude,
  DeepSeek,
  Gemini,
  Groq,
  Mistral,
  Cohere,
  Together,
  Fireworks,
  OpenRouter,
  Ollama,
  LmStudio,
};

export const PROVIDER_ID_TO_ICON: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  google: "Gemini",
  openrouter: "OpenRouter",
  together: "Together",
  fireworks: "Fireworks",
  groq: "Groq",
  mistral: "Mistral",
  cohere: "Cohere",
  ollama: "Ollama",
  lmstudio: "LmStudio",
  custom: "OpenAI",
  chatgpt: "OpenAI",
};

export function renderLobeIcon(iconName: string, size: number = 24, className?: string) {
  const IconComp = LOBE_ICONS_MAP[iconName];
  if (!IconComp) return React.createElement(SparklesIcon, { className: cn("size-6 text-muted-foreground/60", className) });
  if (IconComp.Color) {
    return React.createElement(IconComp.Color, { size, className });
  }
  return React.createElement(IconComp, { size, className });
}

export function detectModelIcon(modelId: string, providerId: string): string {
  const lowerId = modelId.toLowerCase();
  const lowerProv = providerId.toLowerCase();
  if (lowerId.includes("deepseek")) return "DeepSeek";
  if (lowerId.includes("claude") || lowerId.includes("anthropic")) return "Claude";
  if (lowerId.includes("gpt") || lowerId.includes("openai") || lowerId.includes("o1")) return "OpenAI";
  if (lowerId.includes("gemini")) return "Gemini";
  if (lowerId.includes("mistral")) return "Mistral";
  if (lowerId.includes("groq") || lowerId.includes("llama")) return "Groq";
  if (lowerId.includes("cohere")) return "Cohere";
  if (lowerId.includes("together")) return "Together";
  if (lowerId.includes("fireworks")) return "Fireworks";
  if (lowerId.includes("openrouter")) return "OpenRouter";
  if (lowerId.includes("ollama")) return "Ollama";
  if (lowerId.includes("lmstudio") || lowerId.includes("lm-studio")) return "LmStudio";
  if (lowerProv === "openai") return "OpenAI";
  if (lowerProv === "anthropic") return "Anthropic";
  if (lowerProv === "deepseek") return "DeepSeek";
  if (lowerProv === "gemini" || lowerProv === "google") return "Gemini";
  if (lowerProv === "groq") return "Groq";
  if (lowerProv === "mistral") return "Mistral";
  if (lowerProv === "cohere") return "Cohere";
  if (lowerProv === "together") return "Together";
  if (lowerProv === "fireworks") return "Fireworks";
  if (lowerProv === "openrouter") return "OpenRouter";
  if (lowerProv === "ollama") return "Ollama";
  if (lowerProv === "lmstudio") return "LmStudio";
  if (lowerProv === "chatgpt") return "OpenAI";
  return "OpenAI";
}
