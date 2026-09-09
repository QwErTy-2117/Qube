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
import XAI from "@lobehub/icons/es/XAI";
import Perplexity from "@lobehub/icons/es/Perplexity";
import Cerebras from "@lobehub/icons/es/Cerebras";
import SambaNova from "@lobehub/icons/es/SambaNova";
import DeepInfra from "@lobehub/icons/es/DeepInfra";
import Nebius from "@lobehub/icons/es/Nebius";
import Novita from "@lobehub/icons/es/Novita";
import SiliconCloud from "@lobehub/icons/es/SiliconCloud";
import Moonshot from "@lobehub/icons/es/Moonshot";
import Zhipu from "@lobehub/icons/es/Zhipu";
import Minimax from "@lobehub/icons/es/Minimax";
import Stepfun from "@lobehub/icons/es/Stepfun";
import AlibabaCloud from "@lobehub/icons/es/AlibabaCloud";
import Volcengine from "@lobehub/icons/es/Volcengine";
import Hunyuan from "@lobehub/icons/es/Hunyuan";
import Spark from "@lobehub/icons/es/Spark";
import Yi from "@lobehub/icons/es/Yi";
import Upstage from "@lobehub/icons/es/Upstage";
import Ai21 from "@lobehub/icons/es/Ai21";
import Replicate from "@lobehub/icons/es/Replicate";
import HuggingFace from "@lobehub/icons/es/HuggingFace";
import Bedrock from "@lobehub/icons/es/Bedrock";
import Azure from "@lobehub/icons/es/Azure";
import VertexAI from "@lobehub/icons/es/VertexAI";
import Anyscale from "@lobehub/icons/es/Anyscale";
import Nvidia from "@lobehub/icons/es/Nvidia";
import Cloudflare from "@lobehub/icons/es/Cloudflare";
import Vercel from "@lobehub/icons/es/Vercel";
import PPIO from "@lobehub/icons/es/PPIO";
import Github from "@lobehub/icons/es/Github";
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
  XAI,
  Perplexity,
  Cerebras,
  SambaNova,
  DeepInfra,
  Nebius,
  Novita,
  SiliconCloud,
  Moonshot,
  Zhipu,
  Minimax,
  Stepfun,
  AlibabaCloud,
  Volcengine,
  Hunyuan,
  Spark,
  Yi,
  Upstage,
  Ai21,
  Replicate,
  HuggingFace,
  Bedrock,
  Azure,
  VertexAI,
  Anyscale,
  Nvidia,
  Cloudflare,
  Vercel,
  PPIO,
  Github,
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
  xai: "XAI",
  perplexity: "Perplexity",
  cerebras: "Cerebras",
  sambanova: "SambaNova",
  deepinfra: "DeepInfra",
  nebius: "Nebius",
  novita: "Novita",
  siliconflow: "SiliconCloud",
  moonshot: "Moonshot",
  zhipu: "Zhipu",
  minimax: "Minimax",
  stepfun: "Stepfun",
  alibaba: "AlibabaCloud",
  volcengine: "Volcengine",
  hunyuan: "Hunyuan",
  spark: "Spark",
  yi: "Yi",
  upstage: "Upstage",
  ai21: "Ai21",
  replicate: "Replicate",
  huggingface: "HuggingFace",
  bedrock: "Bedrock",
  azure: "Azure",
  vertexai: "VertexAI",
  anyscale: "Anyscale",
  nvidia: "Nvidia",
  cloudflare: "Cloudflare",
  vercel: "Vercel",
  ppio: "PPIO",
  github: "Github",
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
  if (lowerProv === "xai") return "XAI";
  if (lowerProv === "perplexity") return "Perplexity";
  if (lowerProv === "cerebras") return "Cerebras";
  if (lowerProv === "sambanova") return "SambaNova";
  if (lowerProv === "deepinfra") return "DeepInfra";
  if (lowerProv === "nebius") return "Nebius";
  if (lowerProv === "novita") return "Novita";
  if (lowerProv === "siliconflow") return "SiliconCloud";
  if (lowerProv === "moonshot") return "Moonshot";
  if (lowerProv === "zhipu") return "Zhipu";
  if (lowerProv === "minimax") return "Minimax";
  if (lowerProv === "stepfun") return "Stepfun";
  if (lowerProv === "alibaba") return "AlibabaCloud";
  if (lowerProv === "volcengine") return "Volcengine";
  if (lowerProv === "hunyuan") return "Hunyuan";
  if (lowerProv === "spark") return "Spark";
  if (lowerProv === "yi") return "Yi";
  if (lowerProv === "upstage") return "Upstage";
  if (lowerProv === "ai21") return "Ai21";
  if (lowerProv === "replicate") return "Replicate";
  if (lowerProv === "huggingface") return "HuggingFace";
  if (lowerProv === "bedrock") return "Bedrock";
  if (lowerProv === "azure") return "Azure";
  if (lowerProv === "vertexai") return "VertexAI";
  if (lowerProv === "anyscale") return "Anyscale";
  if (lowerProv === "nvidia") return "Nvidia";
  if (lowerProv === "cloudflare") return "Cloudflare";
  if (lowerProv === "vercel") return "Vercel";
  if (lowerProv === "ppio") return "PPIO";
  if (lowerProv === "github") return "Github";
  if (lowerProv === "chatgpt") return "OpenAI";
  return "OpenAI";
}
