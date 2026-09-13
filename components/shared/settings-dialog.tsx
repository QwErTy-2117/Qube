"use client";

import React, { useState, useEffect, type ReactNode, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogClose,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  BrainIcon,
  SlidersIcon,
  Trash2Icon,
  CheckIcon,
  XIcon,
  Loader2Icon,
  TagIcon,
  CalendarIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  Settings2Icon,
  Clock,
  SearchIcon,
  EyeIcon,
  RefreshCwIcon,
  PlusIcon,
  PencilIcon,
  SparklesIcon,
  LayoutGridIcon,
  CopyIcon,
  ArrowUpCircleIcon,
} from "lucide-react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/assistant-ui/tabs";

import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "motion/react";
import { SchedulingTab } from "./scheduling-tab";
import { ConnectorsTab } from "./connectors-tab";
import { SkillsTab } from "./skills-tab";
import { AllowedDirectoriesSection } from "./allowed-directories";
import { syncTauriAutostart } from "@/lib/tauri-utils";
import { Switch } from "radix-ui";
import { ChatGPTPreferencesCard } from "@/components/chatgpt/chatgpt-preferences";
import { useLoginWithChatGPT } from "@opencoredev/loginwithchatgpt-react";
import { TermsPrivacyContent } from "./terms-content";
import { useUpdaterStore } from "@/lib/updater-store";
import { checkForUpdates } from "@/lib/updater";
import packageJson from "@/package.json";

const APP_VERSION: string =
  typeof packageJson?.version === "string" && packageJson.version ? packageJson.version : "0.0.0";


import OpenAI from "@lobehub/icons/es/OpenAI";
import Anthropic from "@lobehub/icons/es/Anthropic";
import Claude from "@lobehub/icons/es/Claude";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Gemini from "@lobehub/icons/es/Gemini";
import Google from "@lobehub/icons/es/Google";
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

interface MemoryEntry {
  id: string;
  category: string;
  content: string;
  createdAt: number;
  relevance: number;
}

interface SessionRecord {
  id: string;
  title: string;
  summary: string;
  createdAt: number;
  updatedAt: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  preference: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  project: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  personal: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  decision: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  technology: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  pattern: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category.toLowerCase()] ?? "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider", color)}>
      <TagIcon className="size-2.5" />
      {category}
    </span>
  );
}

function RelevanceBar({ relevance }: { relevance: number }) {
  const pct = Math.round(relevance * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground font-medium w-7 text-right">{pct}%</span>
    </div>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: React.FC<any>; title: string; description: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
      <div className="size-14 rounded-2xl bg-muted/60 flex items-center justify-center mb-4">
        <Icon className="size-7 text-muted-foreground/40" />
      </div>
      <p className="text-sm font-semibold text-foreground/70">{title}</p>
      <p className="text-xs text-muted-foreground/60 mt-1 max-w-[220px] leading-relaxed">{description}</p>
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between pb-3 shrink-0 mb-4">
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      {action}
    </div>
  );
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseURL?: string;
  enabled: boolean;
  hasApiKey: boolean;
  apiKey?: string;
  isBuiltIn?: boolean;
  models: {
    id: string;
    name: string;
    enabled: boolean;
    icon?: string;
    imageInput?: boolean;
    reasoning?: boolean;
    isBuiltIn?: boolean;
  }[];
}

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "google",
    name: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "together",
    name: "Together AI",
    baseURL: "https://api.together.xyz/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "fireworks",
    name: "Fireworks",
    baseURL: "https://api.fireworks.ai/inference/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "groq",
    name: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "mistral",
    name: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "cohere",
    name: "Cohere",
    baseURL: "https://api.cohere.com/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "ollama",
    name: "Ollama",
    baseURL: "http://localhost:11434/v1",
    enabled: false,
    hasApiKey: false,
    models: [],
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    baseURL: "http://localhost:1234/v1",
    enabled: false,
    hasApiKey: false,
    models: [],
  },
  // --- 30 most used additional providers ---
  {
    id: "xai",
    name: "xAI",
    baseURL: "https://api.x.ai/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    baseURL: "https://api.perplexity.ai",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "cerebras",
    name: "Cerebras",
    baseURL: "https://api.cerebras.ai/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "sambanova",
    name: "SambaNova",
    baseURL: "https://api.sambanova.ai/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "deepinfra",
    name: "DeepInfra",
    baseURL: "https://api.deepinfra.com/v1/openai",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "nebius",
    name: "Nebius",
    baseURL: "https://api.studio.nebius.com/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "novita",
    name: "Novita",
    baseURL: "https://api.novita.ai/v3/openai",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    baseURL: "https://api.siliconflow.cn/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "moonshot",
    name: "Moonshot",
    baseURL: "https://api.moonshot.ai/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "zhipu",
    name: "Zhipu",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseURL: "https://api.minimax.io/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "stepfun",
    name: "Stepfun",
    baseURL: "https://api.stepfun.com/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "alibaba",
    name: "Alibaba Cloud",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "volcengine",
    name: "Volcengine",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "hunyuan",
    name: "Hunyuan",
    baseURL: "https://api.hunyuan.cloud.tencent.com/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "spark",
    name: "Spark",
    baseURL: "https://spark-api-open.xf-yun.com/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "yi",
    name: "Yi",
    baseURL: "https://api.lingyiwanwu.com/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "upstage",
    name: "Upstage",
    baseURL: "https://api.upstage.ai/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "ai21",
    name: "AI21",
    baseURL: "https://api.ai21.com/studio/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "replicate",
    name: "Replicate",
    baseURL: "https://api.replicate.com/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    baseURL: "https://router.huggingface.co/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "bedrock",
    name: "Bedrock",
    baseURL: "https://bedrock-runtime.us-east-1.amazonaws.com",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    baseURL: "https://YOUR_RESOURCE.openai.azure.com",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "vertexai",
    name: "Vertex AI",
    baseURL: "https://aiplatform.googleapis.com/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "anyscale",
    name: "Anyscale",
    baseURL: "https://api.endpoints.anyscale.com/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    baseURL: "https://integrate.api.nvidia.com/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    baseURL: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "vercel",
    name: "Vercel",
    baseURL: "https://ai-gateway.vercel.sh/v1",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "ppio",
    name: "PPIO",
    baseURL: "https://api.ppinfra.com/v3/openai",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "github",
    name: "GitHub Models",
    baseURL: "https://models.github.ai/inference",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "custom",
    name: "Custom OpenAI",
    baseURL: "",
    enabled: false,
    hasApiKey: true,
    models: [],
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    baseURL: "/api/chatgpt",
    enabled: false,
    hasApiKey: false,
    models: [],
  },
];

export const LOBE_ICONS_MAP: Record<string, any> = {
  OpenAI,
  Anthropic,
  Claude,
  DeepSeek,
  Gemini,
  Google,
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

const PROVIDER_ID_TO_ICON: Record<string, string> = {
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
  if (!IconComp) return <SparklesIcon className={cn("size-6 text-muted-foreground/60", className)} />;
  if (IconComp.Color) {
    return <IconComp.Color size={size} className={className} />;
  }
  return <IconComp size={size} className={className} />;
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

  return "OpenAI";
}

import { detectModelImageSupport } from "@/lib/agent/vision-support";
import { detectModelThinkingSupport } from "@/lib/agent/thinking-support";

interface FetchedModel {
  id: string;
  imageInput: boolean;
  reasoning: boolean;
}

async function fetchProviderModels(baseURL: string, apiKey: string): Promise<FetchedModel[]> {
  const res = await fetch("/api/providers/models", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ baseURL, apiKey }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(errBody?.error || `Failed to fetch models: ${res.status} ${res.statusText}`);
  }

  const url = baseURL;
  const body = await res.json();
  if (body?.data && Array.isArray(body.data)) {
    const seen = new Set<string>();
    const models: FetchedModel[] = [];
    for (const m of body.data) {
      if (m.object === "model" || !m.object) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        const imageInput =
          m.architecture?.modality === "text+image" ||
          m.capabilities?.vision === true ||
          m.capabilities?.image_input === true ||
          detectModelImageSupport(m.id);
        const reasoning =
          m.capabilities?.reasoning?.supported === true ||
          m.capabilities?.reasoning === true ||
          m.reasoning?.supported === true ||
          m.reasoning === true ||
          m.architecture?.reasoning === true ||
          detectModelThinkingSupport(m.id);
        models.push({ id: m.id, imageInput, reasoning });
      }
    }
    return models;
  }
  throw new Error(`Unexpected response format from ${url}`);
}

function SwitchToggle({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(
        "peer inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        "h-6 w-11",
        checked ? "bg-emerald-500" : "bg-input/40"
      )}
    >
      <Switch.Thumb
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-[2px]"
        )}
      />
    </Switch.Root>
  );
}

const CHATGPT_PROVIDER_ID = "chatgpt";
const CHATGPT_PROVIDER_NAME = "ChatGPT";

async function fetchChatGPTModels(): Promise<string[]> {
  const res = await fetch("/api/chatgpt/models", { credentials: "same-origin" });
  if (!res.ok) throw new Error("Failed to fetch ChatGPT models");
  const data = await res.json();
  if (Array.isArray(data.models)) return data.models;
  if (Array.isArray(data.data)) return data.data.map((m: any) => m.id);
  return [];
}

function syncChatGPTProvider(user?: { email?: string; plan?: string }) {
  void user;
  let cancelled = false;
  (async () => {
    try {
      const models = await fetchChatGPTModels();
      if (cancelled || models.length === 0) return;

      const qualifiedModels = models.map((mid, idx) => ({
        id: `${CHATGPT_PROVIDER_ID}:${mid}`,
        name: mid,
        enabled: idx === 0,
        icon: detectModelIcon(mid, CHATGPT_PROVIDER_ID),
        imageInput: detectModelImageSupport(mid),
        reasoning: detectModelThinkingSupport(mid),
      }));

      const raw = localStorage.getItem("qube-providers");
      let providers: ProviderConfig[] = [];
      try {
        providers = raw ? JSON.parse(raw) : [];
      } catch {
        providers = [];
      }
      if (providers.length === 0) {
        providers = DEFAULT_PROVIDERS.filter((p) => p.id !== CHATGPT_PROVIDER_ID);
      } else {
        const presentIds = new Set(providers.map((p) => p.id));
        for (const dp of DEFAULT_PROVIDERS) {
          if (dp.id !== CHATGPT_PROVIDER_ID && !presentIds.has(dp.id)) {
            providers = [...providers, dp];
          }
        }
      }

      const existing = providers.find((p) => p.id === CHATGPT_PROVIDER_ID);
      let updated: ProviderConfig[];
      if (!existing) {
        const newProv: ProviderConfig = {
          id: CHATGPT_PROVIDER_ID,
          name: CHATGPT_PROVIDER_NAME,
          baseURL: "/api/chatgpt",
          enabled: true,
          hasApiKey: false,
          models: qualifiedModels,
        };
        updated = [...providers, newProv];
      } else {
        const existingMap = new Map(existing.models.map((m) => [m.id, m]));
        const merged = qualifiedModels.map((m) => {
          const prev = existingMap.get(m.id);
          return prev ? { ...m, enabled: prev.enabled } : m;
        });
        if (merged.length > 0 && !merged.some((m) => m.enabled)) merged[0].enabled = true;
        updated = providers.map((p) =>
          p.id === CHATGPT_PROVIDER_ID ? { ...p, enabled: true, models: merged } : p
        );
      }

      localStorage.setItem("qube-providers", JSON.stringify(updated));
      const currentDefault = localStorage.getItem("qube-default-model");
      if (!currentDefault) {
        const first = updated.find((p) => p.id === CHATGPT_PROVIDER_ID)?.models.find((m) => m.enabled);
        if (first) localStorage.setItem("qube-default-model", first.id);
      }
      const defaultModelId = localStorage.getItem("qube-default-model") || null;
      fetch("/api/providers/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers: updated, defaultModelId }),
      }).catch(() => {});
      window.dispatchEvent(new Event("qube-providers-changed"));
    } catch (e) {
      console.error("[ChatGPT] sync failed", e);
    } finally {
      cancelled = true;
    }
  })();
}

export function SettingsDialog({ children }: { children: ReactNode }) {
  const { theme, setTheme } = useTheme();
  const [themePref, setThemePref] = useState("light");
  const [appVersion, setAppVersion] = useState(APP_VERSION);
  const [open, setOpen] = useState(false);
  const [tabValue, setTabValue] = useState("preferences");

  // Keep the preferences Tabs in sync with the single source of truth (`next-themes`).
  // Previously this read `localStorage` + observed the `dark` class, which desynced from
  // `next-themes`' internal React state. Toggling via the main chat animated toggler
  // bypassed `setTheme`, so `next-themes` still thought the theme was e.g. "light".
  // Then `setTheme("light")` from preferences was a no-op (same value) and left the
  // `dark` class untouched, requiring a detour through "system" to force a state change.
  // Now the sidebar toggler is controlled via `next-themes`, and this effect mirrors
  // `theme` directly. Fallback to DOM/localStorage only before `theme` hydrates.
  useEffect(() => {
    if (theme === "light" || theme === "dark" || theme === "system") {
      setThemePref(theme);
    } else {
      // Fallback during initial hydration when `theme` is still undefined (SSR).
      try {
        const stored = localStorage.getItem("theme");
        if (stored === "light" || stored === "dark" || stored === "system") {
          setThemePref(stored);
          return;
        }
      } catch {}
      setThemePref(document.documentElement.classList.contains("dark") ? "dark" : "light");
    }
  }, [theme]);

  // Memory state — dual-brain (factual + personal), streaming
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [memoryStats, setMemoryStats] = useState<null | { left: number; right: number; cross: number; total: number; warmedUp: boolean; prefetchCache: number; stm: number; ltm: number }>(null);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [deletingMemoryId, setDeletingMemoryId] = useState<string | null>(null);

  // Sessions state
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  // Clear confirmation state
  const [clearConfirm, setClearConfirm] = useState<"memories" | "sessions" | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<boolean>(false);
  const [hardResetConfirm, setHardResetConfirm] = useState<boolean>(false);
  const [termsOpen, setTermsOpen] = useState<boolean>(false);

  // Updater state (web UI, wired to Tauri via plugin)
  const [updateChecking, setUpdateChecking] = useState<boolean>(false);
  const [updateNoUpdate, setUpdateNoUpdate] = useState<boolean>(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const updaterStore = useUpdaterStore();
  const [showTestPopup, setShowTestPopup] = useState(false);

  // Show test popup button only if specific storage flag is set (not random)
  // Enable via: localStorage.setItem("qube-dev-enable-update-test", "true")
  useEffect(() => {
    try {
      const v = localStorage.getItem("qube-dev-enable-update-test");
      setShowTestPopup(v === "true");
    } catch {}
    const onStorage = () => {
      try {
        setShowTestPopup(localStorage.getItem("qube-dev-enable-update-test") === "true");
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    // also listen for custom event to toggle without reload
    window.addEventListener("qube-dev-test-toggle" as any, onStorage as any);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("qube-dev-test-toggle" as any, onStorage as any);
    };
  }, []);

  // Preferences state
  const [defaultModel, setDefaultModel] = useState("");
  const [customSystemPrompt, setCustomSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [userName, setUserName] = useState("");
  const [userAbout, setUserAbout] = useState("");

  // Advanced settings state
  const [runOnStart, setRunOnStart] = useState(false);
  const [keepAlive, setKeepAlive] = useState(true);
  const [memoryEnabled, setMemoryEnabled] = useState(true);

  // MCP Servers state
  interface McpServerConfig {
    id: string;
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
  }
  const [mcpManagerOpen, setMcpManagerOpen] = useState(false);
  const [skillsDialogOpen, setSkillsDialogOpen] = useState(false);
  const [allowedDirsDialogOpen, setAllowedDirsDialogOpen] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mcpLoaded, setMcpLoaded] = useState(false);

  useEffect(() => {
    // Load MCP servers: try server first, fallback to localStorage
    (async () => {
      try {
        const res = await fetch("/api/mcp/sync");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.servers) && data.servers.length > 0) {
            setMcpServers(data.servers);
            try { localStorage.setItem("qube-custom-mcp-servers", JSON.stringify(data.servers)); } catch {}
            setMcpLoaded(true);
            return;
          }
        }
      } catch {}
      try {
        const stored = localStorage.getItem("qube-custom-mcp-servers");
        if (stored) setMcpServers(JSON.parse(stored));
      } catch { /* ignore */ }
      setMcpLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (mcpLoaded) {
      localStorage.setItem("qube-custom-mcp-servers", JSON.stringify(mcpServers));
      // Sync to server for Pi harness
      fetch("/api/mcp/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ servers: mcpServers }),
      }).catch(() => {});
    }
  }, [mcpServers, mcpLoaded]);

  // MCP form state
  const [mcpEditingId, setMcpEditingId] = useState<string | null>(null);
  const [mcpFormView, setMcpFormView] = useState(false);
  const [mcpSaved, setMcpSaved] = useState(false);
  const [mcpDeleteConfirm, setMcpDeleteConfirm] = useState<string | null>(null);
  const [mcpFormName, setMcpFormName] = useState("");
  const [mcpFormCommand, setMcpFormCommand] = useState("");
  const [mcpFormArgs, setMcpFormArgs] = useState("");
  const [mcpFormEnv, setMcpFormEnv] = useState("");

  // Composio API key state (Settings → Advanced → Composio API Key)
  const [composioKeyOpen, setComposioKeyOpen] = useState(false);
  const [composioMode, setComposioMode] = useState<"builtin" | "custom">("builtin");
  const [composioHasCustom, setComposioHasCustom] = useState(false);
  const [composioMasked, setComposioMasked] = useState<string | null>(null);
  const [composioHasBuiltin, setComposioHasBuiltin] = useState(true);
  const [composioKeyInput, setComposioKeyInput] = useState("");
  const [composioShowKey, setComposioShowKey] = useState(false);
  const [composioSaving, setComposioSaving] = useState(false);
  const [composioSaved, setComposioSaved] = useState(false);
  const [composioError, setComposioError] = useState<string | null>(null);

  const fetchComposioKeyStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/connectors/composio-key");
      if (!res.ok) return;
      const data = await res.json();
      if (data.mode === "custom" || data.mode === "builtin") setComposioMode(data.mode);
      setComposioHasCustom(!!data.hasCustomKey);
      setComposioMasked(typeof data.customKeyMasked === "string" ? data.customKeyMasked : null);
      if (typeof data.hasBuiltInKey === "boolean") setComposioHasBuiltin(data.hasBuiltInKey);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchComposioKeyStatus();
  }, [fetchComposioKeyStatus]);

  useEffect(() => {
    if (composioKeyOpen) {
      setComposioError(null);
      setComposioKeyInput("");
      setComposioShowKey(false);
      fetchComposioKeyStatus();
    }
  }, [composioKeyOpen, fetchComposioKeyStatus]);

  const handleSaveComposioKey = async () => {
    setComposioSaving(true);
    setComposioError(null);
    try {
      const body: { mode: "builtin" | "custom"; customKey?: string } = { mode: composioMode };
      if (composioMode === "custom" && composioKeyInput.trim()) {
        body.customKey = composioKeyInput.trim();
      }
      const res = await fetch("/api/connectors/composio-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to save Composio API key.");
      }
      if (data.mode === "custom" || data.mode === "builtin") setComposioMode(data.mode);
      setComposioHasCustom(!!data.hasCustomKey);
      setComposioMasked(typeof data.customKeyMasked === "string" ? data.customKeyMasked : null);
      if (typeof data.hasBuiltInKey === "boolean") setComposioHasBuiltin(data.hasBuiltInKey);
      setComposioKeyInput("");
      setComposioSaved(true);
      setTimeout(() => {
        setComposioSaved(false);
        setComposioKeyOpen(false);
      }, 800);
    } catch (e) {
      setComposioError(e instanceof Error ? e.message : String(e));
    } finally {
      setComposioSaving(false);
    }
  };

  const fetchMemories = useCallback(async () => {
    setLoadingMemories(true);
    try {
      const res = await fetch("/api/settings/memory");
      const data = await res.json();
      if (data.entries) setMemories(data.entries);
      if (data.stats) setMemoryStats(data.stats);
    } catch { /* ignore */ }
    finally { setLoadingMemories(false); }
  }, []);

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await fetch("/api/settings/sessions");
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
    } catch { /* ignore */ }
    finally { setLoadingSessions(false); }
  }, []);

  const handleDeleteMemory = async (id: string) => {
    setDeletingMemoryId(id);
    try {
      const res = await fetch(`/api/settings/memory?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.entries) setMemories(data.entries);
      if (data.stats) setMemoryStats(data.stats);
    } catch { /* ignore */ }
    finally { setDeletingMemoryId(null); }
  };

  const handleClearMemories = async () => {
    try {
      const res = await fetch("/api/settings/memory", { method: "DELETE" });
      const data = await res.json();
      if (data.entries !== undefined) setMemories([]);
      if (data.stats) setMemoryStats(data.stats);
      else setMemoryStats({ left: 0, right: 0, cross: 0, total: 0, warmedUp: true, prefetchCache: 0, stm: 0, ltm: 0 });
    } catch { /* ignore */ }
  };

  const handleDeleteSession = async (id: string) => {
    setDeletingSessionId(id);
    try {
      const res = await fetch(`/api/settings/sessions?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
    } catch { /* ignore */ }
    finally { setDeletingSessionId(null); }
  };

  const handleClearSessions = async () => {
    try {
      const res = await fetch("/api/settings/sessions", { method: "DELETE" });
      const data = await res.json();
      if (data.sessions !== undefined) setSessions([]);
    } catch { /* ignore */ }
  };

  const handleSavePreferences = () => {
    localStorage.setItem("qube-default-model", defaultModel);
    localStorage.setItem("qube-custom-system-prompt", customSystemPrompt);
    localStorage.setItem("qube-temperature", String(temperature));
    localStorage.setItem("qube-user-name", userName);
    localStorage.setItem("qube-user-about", userAbout);

    fetch("/api/providers/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers, defaultModelId: defaultModel }),
    }).catch((e) => console.error("[SettingsDialog] Failed to sync preferences:", e));

    saveSettingsToServer();
  };

  // Providers & models states
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [configureProvider, setConfigureProvider] = useState<ProviderConfig | null>(null);
  const [manageProvider, setManageProvider] = useState<ProviderConfig | null>(null);
  const chatGptForOpenAI = useLoginWithChatGPT();
  const [chatGptCodeDialogOpen, setChatGptCodeDialogOpen] = useState(false);
  const [browseIconModelId, setBrowseIconModelId] = useState<string | null>(null);
  const [addCustomModelOpen, setAddCustomModelOpen] = useState(false);
  const [customModelName, setCustomModelName] = useState("");
  const [customModelCode, setCustomModelCode] = useState("");
  const [customInstructionsOpen, setCustomInstructionsOpen] = useState(false);
  const [tempInstructions, setTempInstructions] = useState("");

  const [savingInstructions, setSavingInstructions] = useState(false);
  const [savedInstructions, setSavedInstructions] = useState(false);

  const saveSettingsToServer = useCallback(() => {
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          defaultModel,
          customSystemPrompt,
          temperature,
          userName,
          userAbout,
          runOnStart,
          keepAlive,
          memoryEnabled,
        },
      }),
    }).catch(() => {});
  }, [defaultModel, customSystemPrompt, temperature, userName, userAbout, runOnStart, keepAlive, memoryEnabled]);

  const [savingConfigure, setSavingConfigure] = useState(false);
  const [savedConfigure, setSavedConfigure] = useState(false);
  const [configApiKey, setConfigApiKey] = useState("");
  const [configBaseUrl, setConfigBaseUrl] = useState("");
  const [configHasApiKey, setConfigHasApiKey] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const [savingManage, setSavingManage] = useState(false);
  const [savedManage, setSavedManage] = useState(false);
  const [manageModels, setManageModels] = useState<any[]>([]);

  const [savingCustomModel, setSavingCustomModel] = useState(false);
  const [savedCustomModel, setSavedCustomModel] = useState(false);

  const [refreshingModels, setRefreshingModels] = useState(false);
  const [refreshedModels, setRefreshedModels] = useState(false);

  // ChatGPT code dialog for OpenAI popup
  useEffect(() => {
    if (chatGptForOpenAI.status === "pending" && chatGptForOpenAI.userCode) {
      setChatGptCodeDialogOpen(true);
    } else if (chatGptForOpenAI.status === "authenticated" || chatGptForOpenAI.status === "unauthenticated") {
      setChatGptCodeDialogOpen(false);
      if (chatGptForOpenAI.status === "authenticated") {
        // Sync the ChatGPT provider into localStorage (this hook instance has no
        // other component doing it on its behalf, unlike chatgpt-preferences /
        // chatgpt-onboarding which sync themselves).
        syncChatGPTProvider(chatGptForOpenAI.user);
      }
    }
  }, [chatGptForOpenAI.status, chatGptForOpenAI.userCode]);

  // Keep providers state in sync when this hook instance's session changes
  // (the shared qube-providers-changed listener below also handles this, but
  // listening for the local change avoids a re-render gap for the user).
  useEffect(() => {
    if (chatGptForOpenAI.status !== "authenticated") return;
    try {
      const raw = localStorage.getItem("qube-providers");
      if (raw) setProviders(JSON.parse(raw));
      const def = localStorage.getItem("qube-default-model");
      if (def) setDefaultModel(def);
    } catch {}
  }, [chatGptForOpenAI.status, chatGptForOpenAI.user]);

  const saveProviders = (updated: ProviderConfig[]) => {
    setProviders(updated);
    localStorage.setItem("qube-providers", JSON.stringify(updated));
    const defaultModel = localStorage.getItem("qube-default-model") || null;
    fetch("/api/providers/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers: updated, defaultModelId: defaultModel }),
    }).catch(() => {});
    window.dispatchEvent(new Event("qube-providers-changed"));
  };

  const handleSaveInstructions = async () => {
    setSavingInstructions(true);
    await new Promise((r) => setTimeout(r, 400));
    setSavedInstructions(true);
    await new Promise((r) => setTimeout(r, 600));
    setCustomSystemPrompt(tempInstructions);
    localStorage.setItem("qube-custom-system-prompt", tempInstructions);
    saveSettingsToServer();
    setSavingInstructions(false);
    setSavedInstructions(false);
    setCustomInstructionsOpen(false);
  };

  const handleSaveConfigure = async () => {
    if (!configureProvider) return;
    setConfigError(null);
    setSavingConfigure(true);

    try {
      const fetchedModels = await fetchProviderModels(configBaseUrl || "", configApiKey || "");
      const provId = configureProvider.id;
      const autoDetectIcons = ["custom", "ollama", "lmstudio", "openrouter"];
      const providerIcon = PROVIDER_ID_TO_ICON[provId] || provId.charAt(0).toUpperCase() + provId.slice(1);
      const qualifiedModels = fetchedModels.map((model) => ({
        id: `${provId}:${model.id}`,
        name: model.id,
        enabled: false,
        icon: autoDetectIcons.includes(provId) ? detectModelIcon(model.id, provId) : providerIcon,
        imageInput: model.imageInput,
        reasoning: model.reasoning,
      }));

      await new Promise((r) => setTimeout(r, 400));
      setSavedConfigure(true);
      await new Promise((r) => setTimeout(r, 600));

      const existingIdx = providers.findIndex((p) => p.id === configureProvider.id);
      let updated: ProviderConfig[];
      if (existingIdx >= 0) {
        updated = providers.map((p, i) => {
          if (i === existingIdx) {
            return {
              ...p,
              enabled: true,
              apiKey: configApiKey,
              baseURL: configBaseUrl,
              hasApiKey: configHasApiKey,
              models: qualifiedModels,
            };
          }
          return p;
        });
      } else {
        const newProv: ProviderConfig = {
          ...configureProvider,
          enabled: true,
          apiKey: configApiKey,
          baseURL: configBaseUrl,
          hasApiKey: configHasApiKey,
          models: qualifiedModels,
        } as ProviderConfig;
        updated = [...providers, newProv];
      }
      saveProviders(updated);

      setSavingConfigure(false);
      setSavedConfigure(false);
      setConfigureProvider(null);
      setAddProviderOpen(false);
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "Failed to validate provider");
      setSavingConfigure(false);
    }
  };

  const handleSaveManage = async () => {
    if (!manageProvider) return;
    setSavingManage(true);
    await new Promise((r) => setTimeout(r, 400));
    setSavedManage(true);
    await new Promise((r) => setTimeout(r, 600));

    const updated = providers.map((p) => {
      if (p.id === manageProvider.id) {
        return {
          ...p,
          models: manageModels,
        };
      }
      return p;
    });
    saveProviders(updated);

    setSavingManage(false);
    setSavedManage(false);
    setManageProvider(null);
  };

  const handleDeleteProvider = () => {
    if (!manageProvider) return;
    if ((manageProvider as any).isBuiltIn) return;
    setDeleteConfirm(true);
  };

  const handleConfirmDeleteProvider = () => {
    if (!manageProvider) return;
    const isChatGPT = manageProvider.id === "chatgpt";
    // Only disconnect ChatGPT if it was the provider and not connected via API (ChatGPT is always via Login, not API)
    if (isChatGPT) {
      // Check if ChatGPT was actually connected via Login (has provider enabled) vs API (never for chatgpt id)
      // We consider it "not via API" if the provider has no apiKey (ChatGPT has hasApiKey=false)
      const wasConnectedViaLogin = manageProvider.enabled && !manageProvider.apiKey;
      if (wasConnectedViaLogin) {
        fetch("/api/chatgpt/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
        // Also clear localStorage session check — the hook will handle unauthenticated state
        // We do not need to wait for it
      }
    }
    const updated = providers.map((p) => {
      if (p.id === manageProvider.id) {
        return {
          ...p,
          enabled: false,
          models: [],
        };
      }
      return p;
    });
    saveProviders(updated);
    // If it was ChatGPT, also clear default model if it was a chatgpt: model
    if (isChatGPT) {
      const def = localStorage.getItem("qube-default-model");
      if (def && def.startsWith("chatgpt:")) {
        localStorage.removeItem("qube-default-model");
        fetch("/api/providers/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providers: updated, defaultModelId: null }),
        }).catch(() => {});
      }
      window.dispatchEvent(new Event("qube-providers-changed"));
    }
    setManageProvider(null);
    setDeleteConfirm(false);
  };

  const handleHardReset = async () => {
    setHardResetConfirm(false);
    // Disconnect ChatGPT (clears server-side session)
    try { await fetch("/api/chatgpt/logout", { method: "POST", credentials: "same-origin" }); } catch {}
    // Wipe all server-side data files (providers, chatgpt-sessions, lwc-secret, memories, sessions, etc.)
    try { await fetch("/api/reset", { method: "POST", credentials: "same-origin" }); } catch {}
    // Clear all localStorage (providers, models, preferences, sessions metadata, etc.)
    try { localStorage.clear(); } catch {}
    setTimeout(() => location.reload(), 300);
  };

  const handleCheckForUpdate = async () => {
    setUpdateChecking(true);
    setUpdateError(null);
    setUpdateNoUpdate(false);
    const start = Date.now();
    const minSpin = 700;
    try {
      const res = await checkForUpdates();
      const elapsed = Date.now() - start;
      if (elapsed < minSpin) await new Promise((r) => setTimeout(r, minSpin - elapsed));
      if (res.available) {
        updaterStore.setAvailable(res.info);
        // Only the top toast (UpdateToast) is shown; the centered install dialog was removed.
      } else {
        // Show white "up to date" popup (same shape as update, auto dismiss after 2s)
        updaterStore.setShowUpToDate(true);
      }
    } catch (e) {
      const elapsed = Date.now() - start;
      if (elapsed < minSpin) await new Promise((r) => setTimeout(r, minSpin - elapsed));
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleSaveCustomModel = async () => {
    if (!customModelCode.trim() || !customModelName.trim()) return;
    setSavingCustomModel(true);
    await new Promise((r) => setTimeout(r, 400));
    setSavedCustomModel(true);
    await new Promise((r) => setTimeout(r, 600));

    const provId = manageProvider?.id || "";
    const autoDetectIcons = ["custom", "ollama", "lmstudio", "openrouter"];
    const providerIcon = PROVIDER_ID_TO_ICON[provId] || provId.charAt(0).toUpperCase() + provId.slice(1);
    const newModel = {
      id: customModelCode.trim(),
      name: customModelName.trim(),
      enabled: true,
      icon: autoDetectIcons.includes(provId) ? detectModelIcon(customModelCode.trim(), provId) : providerIcon,
      imageInput: detectModelImageSupport(customModelCode.trim()),
      reasoning: detectModelThinkingSupport(customModelCode.trim()),
    };

    setManageModels((prev) => [...prev, newModel]);

    setSavingCustomModel(false);
    setSavedCustomModel(false);
    setAddCustomModelOpen(false);
    setCustomModelName("");
    setCustomModelCode("");
  };

  const handleRefreshModels = async () => {
    if (!manageProvider) return;
    setRefreshingModels(true);
    try {
      const fetchedModels = await fetchProviderModels(manageProvider.baseURL || "", manageProvider.apiKey || "");
      const provId = manageProvider.id;
      const autoDetectIcons = ["custom", "ollama", "lmstudio", "openrouter"];
      const providerIcon = PROVIDER_ID_TO_ICON[provId] || provId.charAt(0).toUpperCase() + provId.slice(1);
      const qualified = fetchedModels.map((model) => {
        const existing = manageModels.find((m) => m.id === `${provId}:${model.id}`);
        return {
          id: `${provId}:${model.id}`,
          name: model.id,
          enabled: existing ? existing.enabled : false,
          icon: autoDetectIcons.includes(provId) ? detectModelIcon(model.id, provId) : providerIcon,
          imageInput: model.imageInput,
          reasoning: model.reasoning,
        };
      });
      setManageModels(qualified);
      setRefreshedModels(true);
      await new Promise((r) => setTimeout(r, 1500));
      setRefreshedModels(false);
    } catch {}
    setRefreshingModels(false);
  };

  const handleToggleModel = (modelId: string, enabled: boolean) => {
    if (enabled) {
      const currentToggledCount = providers.reduce((acc, p) => {
        if (p.enabled) {
          if (manageProvider && p.id === manageProvider.id) {
            return acc + manageModels.reduce((sum, m) => sum + (m.enabled ? 1 : 0), 0);
          } else {
            return acc + p.models.reduce((sum, m) => sum + (m.enabled ? 1 : 0), 0);
          }
        }
        return acc;
      }, 0);

      if (currentToggledCount >= 5) {
        alert("You can have a max of 5 models toggled in total.");
        return;
      }
    }

    setManageModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, enabled } : m))
    );
  };

  const handleDeactivateModel = (modelId: string) => {
    const updated = providers.map((p) => ({
      ...p,
      models: p.models.map((m) =>
        m.id === modelId ? { ...m, enabled: false } : m
      ),
    }));
    saveProviders(updated);

    const defaultM = localStorage.getItem("qube-default-model");
    if (defaultM === modelId) {
      localStorage.removeItem("qube-default-model");
      setDefaultModel("");
    }
  };

  const handleSetDefaultModel = (modelId: string) => {
    localStorage.setItem("qube-default-model", modelId);
    setDefaultModel(modelId);

    // Sync change to backend immediately
    fetch("/api/providers/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers, defaultModelId: modelId }),
    }).catch((e) => console.error("[SettingsDialog] Failed to sync default model:", e));
  };

  // Load prefs when dialog opens
  useEffect(() => {
    if (!open) return;
    if (typeof window !== "undefined") {
      const lsDefaultModel = localStorage.getItem("qube-default-model");
      const lsCustomPrompt = localStorage.getItem("qube-custom-system-prompt");
      const lsTemperature = localStorage.getItem("qube-temperature");
      const lsUserName = localStorage.getItem("qube-user-name");
      const lsUserAbout = localStorage.getItem("qube-user-about");
      const lsRunOnStart = localStorage.getItem("qube-run-on-start");
      const lsKeepAlive = localStorage.getItem("qube-keep-alive");
      const lsMemoryEnabled = localStorage.getItem("qube-memory-enabled");

      setDefaultModel(lsDefaultModel || "");
      setCustomSystemPrompt(lsCustomPrompt || "");
      if (lsTemperature) setTemperature(parseFloat(lsTemperature));
      setUserName(lsUserName || "");
      setUserAbout(lsUserAbout || "");
      setRunOnStart(lsRunOnStart === "true");
      setKeepAlive(lsKeepAlive === "true");
      setMemoryEnabled(lsMemoryEnabled === null ? true : lsMemoryEnabled === "true");

      // Fetch server-side settings and merge for any keys missing from localStorage
      (async () => {
        try {
          const res = await fetch("/api/settings");
          if (res.ok) {
            const data = await res.json();
            if (data.version) setAppVersion(data.version);
            const s = data.settings;
            if (s) {
              if (!lsDefaultModel && s.defaultModel) setDefaultModel(s.defaultModel);
              if (!lsCustomPrompt && s.customSystemPrompt) setCustomSystemPrompt(s.customSystemPrompt);
              if (!lsTemperature && s.temperature !== undefined) setTemperature(s.temperature);
              if (!lsUserName && s.userName) setUserName(s.userName);
              if (!lsUserAbout && s.userAbout) setUserAbout(s.userAbout);
              if (!lsRunOnStart && s.runOnStart !== undefined) setRunOnStart(s.runOnStart);
              if (!lsKeepAlive && s.keepAlive !== undefined) setKeepAlive(s.keepAlive);
              if (lsMemoryEnabled === null && s.memoryEnabled !== undefined) setMemoryEnabled(s.memoryEnabled !== false);
            }
          }
        } catch {}

      })();

      const storedProviders = localStorage.getItem("qube-providers");
      if (storedProviders) {
        try {
          const parsed: ProviderConfig[] = JSON.parse(storedProviders);
          setProviders(parsed);
        } catch {
          setProviders(DEFAULT_PROVIDERS);
        }
      } else {
        (async () => {
          try {
            const res = await fetch("/api/providers/sync");
            if (res.ok) {
              const data = await res.json();
              if (data.providers && data.providers.length > 0) {
                const providers = data.providers as ProviderConfig[];
                setProviders(providers);
                if (data.defaultModelId) setDefaultModel(data.defaultModelId);
                localStorage.setItem("qube-providers", JSON.stringify(providers));
                if (data.defaultModelId) localStorage.setItem("qube-default-model", data.defaultModelId);
                window.dispatchEvent(new Event("qube-providers-changed"));
                return;
              }
            }
          } catch {}
          setProviders(DEFAULT_PROVIDERS);
          localStorage.setItem("qube-providers", JSON.stringify(DEFAULT_PROVIDERS));
        })();
      }
    }
  }, [open]);

  // Keep providers state in sync with localStorage when other components (e.g. ChatGPT sync)
  // mutate the provider list. Without this, opening the Add Provider popup after a
  // background provider change would show stale data.
  useEffect(() => {
    const handler = () => {
      try {
        const raw = localStorage.getItem("qube-providers");
        if (!raw) return;
        const parsed: ProviderConfig[] = JSON.parse(raw);
        setProviders(parsed);
        const def = localStorage.getItem("qube-default-model");
        if (def) setDefaultModel(def);
      } catch {}
    };
    window.addEventListener("qube-providers-changed", handler);
    return () => window.removeEventListener("qube-providers-changed", handler);
  }, []);

  // Programmatic open (e.g. home-page connectors tray): detail.tab selects
  // one of the settings tabs. Matches the qube-* window-event convention.
  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const tab = (e as CustomEvent).detail?.tab;
        if (tab === "preferences" || tab === "connectors" || tab === "scheduling" || tab === "advanced") {
          setTabValue(tab);
        }
      } catch {}
      setOpen(true);
    };
    window.addEventListener("qube-open-settings", handler);
    return () => window.removeEventListener("qube-open-settings", handler);
  }, []);

  // Auto-save all settings when dialog closes
  const handleOpenChange = (next: boolean) => {
    const childDialogOpen = clearConfirm !== null
      || addProviderOpen
      || configureProvider !== null
      || manageProvider !== null
      || customInstructionsOpen
      || hardResetConfirm
      || termsOpen
      || deleteConfirm
      || !!browseIconModelId
      || addCustomModelOpen
       || mcpManagerOpen
       || skillsDialogOpen
       || allowedDirsDialogOpen
       || mcpDeleteConfirm !== null
      || chatGptCodeDialogOpen;

    if (!next && childDialogOpen) return;

    if (!next && open) {
      localStorage.setItem("qube-default-model", defaultModel);
      localStorage.setItem("qube-custom-system-prompt", customSystemPrompt);
      localStorage.setItem("qube-temperature", String(temperature));
      localStorage.setItem("qube-user-name", userName);
      localStorage.setItem("qube-user-about", userAbout);
      localStorage.setItem("qube-run-on-start", String(runOnStart));
      localStorage.setItem("qube-keep-alive", String(keepAlive));
      localStorage.setItem("qube-memory-enabled", String(memoryEnabled));
      syncTauriAutostart(runOnStart);
      saveSettingsToServer();
      fetch("/api/providers/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers, defaultModelId: defaultModel }),
      }).catch(() => {});
      window.dispatchEvent(new Event("qube-providers-changed"));
    }
    setOpen(next);
  };

  // Auto-save current tab's settings when switching tabs
  const handleTabChange = (next: string) => {
    if (next !== tabValue) {
      if (tabValue === "preferences") {
        localStorage.setItem("qube-user-name", userName);
        localStorage.setItem("qube-user-about", userAbout);
      } else if (tabValue === "advanced") {
        localStorage.setItem("qube-run-on-start", String(runOnStart));
        localStorage.setItem("qube-keep-alive", String(keepAlive));
        localStorage.setItem("qube-memory-enabled", String(memoryEnabled));
        syncTauriAutostart(runOnStart);
      }
      saveSettingsToServer();
    }
    setTabValue(next);
  };


  // Auto-save custom instructions when its popup closes
  const handleInstructionsOpenChange = (v: boolean) => {
    if (!v && customInstructionsOpen) {
      setCustomSystemPrompt(tempInstructions);
      localStorage.setItem("qube-custom-system-prompt", tempInstructions);
      fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            defaultModel,
            customSystemPrompt: tempInstructions,
            temperature,
            userName,
            userAbout,
            runOnStart,
            keepAlive,
            memoryEnabled,
          },
        }),
      }).catch(() => {});
    }
    setCustomInstructionsOpen(v);
  };

  // Load data when tab changes
  useEffect(() => {
    if (!open) return;
    if (tabValue === "memories") {
      fetchMemories();
      fetchSessions();
    }
  }, [open, tabValue, fetchMemories, fetchSessions]);

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent
        showCloseButton={false}
        className="sm:max-w-4xl max-w-4xl w-full p-0 flex flex-col rounded-3xl border border-border bg-background shadow-2xl overflow-hidden"
        style={{ height: "min(660px, 90vh)" }}
      >
        <Tabs value={tabValue} onValueChange={handleTabChange} className="flex flex-col flex-1 overflow-hidden">
    <div className="flex items-center px-6 py-3">
      <div className="flex-1" />
      <TabsList variant="pills" className="bg-muted rounded-full p-1">
        <TabsTrigger value="preferences">
          <SlidersIcon className="size-4" />
          Preferences
        </TabsTrigger>
        <TabsTrigger value="connectors">
          <LayoutGridIcon className="size-4" />
          Connectors
        </TabsTrigger>
        <TabsTrigger value="scheduling">
          <Clock className="size-4" />
          Scheduling
        </TabsTrigger>
        <TabsTrigger value="advanced">
          <Settings2Icon className="size-4" />
          Advanced
        </TabsTrigger>
      </TabsList>
      <div className="flex flex-1 justify-end">
        <DialogClose className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground flex size-8 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100 hover:bg-accent focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </DialogClose>
      </div>
    </div>

          {/* Preferences Tab */}
          <TabsContent value="preferences" className="flex-1 flex flex-col overflow-hidden p-6 mt-0 data-[state=inactive]:hidden">
            <motion.div
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
            <div className="flex-1 overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden space-y-6">
              {/* Your Name */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">Your Name</label>
                <p className="text-xs text-muted-foreground">What Qube should call you in session conversations.</p>
                <input
                  type="text"
                  placeholder="Enter your name..."
                  value={userName}
                  onChange={(e) => {
                    setUserName(e.target.value);
                    try { localStorage.setItem("qube-user-name", e.target.value); } catch {}
                  }}
                  className="w-full px-3.5 py-2.5 mt-1 rounded-xl border border-border bg-muted/10 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {/* About You */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">About You</label>
                <p className="text-xs text-muted-foreground">Tell Qube about yourself and your preferences for personalized responses.</p>
                <textarea
                  placeholder="E.g. I'm a full-stack developer who loves Rust, React, and TypeScript..."
                  value={userAbout}
                  onChange={(e) => {
                    setUserAbout(e.target.value);
                    try { localStorage.setItem("qube-user-about", e.target.value); } catch {}
                  }}
                  rows={4}
                  className="w-full px-3.5 py-2.5 mt-1 rounded-xl border border-border bg-muted/10 text-sm outline-none focus:ring-1 focus:ring-ring resize-none leading-relaxed"
                />
              </div>

              {/* Allowed directories */}
              <AllowedDirectoriesSection onDialogOpenChange={setAllowedDirsDialogOpen} />

              <div className="pt-1">
                <ChatGPTPreferencesCard />
              </div>

              {/* Theme */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-base font-semibold text-foreground">Theme</label>
                    <p className="text-sm text-muted-foreground">Choose your preferred appearance.</p>
                  </div>
                  <Tabs value={themePref} onValueChange={(v) => { setThemePref(v); setTheme(v); }}>
                    <TabsList variant="pills" className="bg-muted rounded-full p-1">
                      <TabsTrigger value="light" className="!size-7 !min-w-7 !p-0 rounded-full flex items-center justify-center"><SunIcon className="size-4" /></TabsTrigger>
                      <TabsTrigger value="dark" className="!size-7 !min-w-7 !p-0 rounded-full flex items-center justify-center"><MoonIcon className="size-4" /></TabsTrigger>
                      <TabsTrigger value="system" className="!size-7 !min-w-7 !p-0 rounded-full flex items-center justify-center"><MonitorIcon className="size-4" /></TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </div>
            </div>

            </motion.div>
          </TabsContent>

          {/* Connectors Tab */}
          <TabsContent value="connectors" className="flex-1 flex flex-col overflow-hidden p-6 mt-0 data-[state=inactive]:hidden">
            <ConnectorsTab />
          </TabsContent>

          {/* Advanced Tab */}
          <TabsContent value="advanced" className="flex-1 flex flex-col overflow-hidden p-6 mt-0 data-[state=inactive]:hidden">
            <motion.div
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              <div className="flex-1 overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden space-y-8">
                {/* About & Hard Reset — radius in axis with inner buttons (like update popup): outer = button radius (16 for h-8) + container padding (20 for p-5) = 36 */}
                <div className="rounded-[36px] border border-border/60 bg-muted/10 p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="Qube" className="size-8 rounded-lg" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Qube</p>
                      <p className="text-xs text-muted-foreground">v{appVersion}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    An AI agent for anyone
                  </p>
                  <div className="flex justify-between gap-2 items-center">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={handleCheckForUpdate}
                        disabled={updateChecking}
                        className="rounded-full font-semibold h-8 px-4 flex items-center justify-center gap-1.5 min-w-[150px] whitespace-nowrap"
                        size="sm"
                      >
                        {updateChecking ? (
                          <Loader2Icon className="size-3.5 animate-spin" />
                        ) : (
                          <ArrowUpCircleIcon className="size-3.5" />
                        )}
                        Check for updates
                      </Button>
                      {updateError && (
                        <span className="text-xs text-red-500 max-w-[140px] truncate" title={updateError}>{updateError}</span>
                      )}
                      {showTestPopup && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.dispatchEvent(new CustomEvent("qube-show-update-mock", { detail: { version: "9.9.9", currentVersion: appVersion || "0.0.30", body: "Test update — your data will be preserved. The app will restart after updating." } }))}
                          className="rounded-full h-6 px-2 text-[11px] font-medium"
                          title="Show test update popup (enabled via qube-dev-enable-update-test)"
                        >
                          Test popup
                        </Button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setTermsOpen(true)}
                        className="rounded-full font-semibold h-8 px-4"
                        size="sm"
                      >
                        Terms of Service and Privacy Policy
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setHardResetConfirm(true)}
                        className="rounded-full font-semibold h-8 px-4 text-red-500 border-red-500/30 hover:bg-red-500/10 hover:text-red-600"
                        size="sm"
                      >
                        <Trash2Icon className="size-3.5 mr-1.5" />
                        Hard Reset
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Providers Section */}
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-foreground">Providers & Models</h3>
                      <p className="text-xs text-muted-foreground">Manage your external AI providers and toggle up to 5 models in total.</p>
                    </div>
                    <Button
                      onClick={() => {
                        setSearchQuery("");
                        setAddProviderOpen(true);
                      }}
                      className="rounded-full font-semibold px-4 h-8 flex items-center gap-1.5"
                      size="sm"
                    >
                      <PlusIcon className="size-3.5" />
                      Add Provider
                    </Button>
                  </div>

                  {providers.filter((p) => p.enabled).length > 0 ? (
                    <div className="flex flex-wrap gap-4 py-2 px-1 justify-start w-full">
                      {providers.filter((p) => p.enabled).map((p) => {
                        const detectedIcon = PROVIDER_ID_TO_ICON[p.id] || p.id.charAt(0).toUpperCase() + p.id.slice(1);
                        return (
                          <div
                            key={p.id}
                            onClick={() => {
                              setManageProvider(p);
                              const seen = new Set<string>();
                              setManageModels([...p.models].filter((m) => {
                                if (seen.has(m.id)) return false;
                                seen.add(m.id);
                                return true;
                              }));
                            }}
                            className="flex flex-col items-center justify-center size-20 rounded-3xl ring-1 ring-inset ring-border bg-muted/20 hover:bg-muted/40 cursor-pointer transition-all hover:scale-105 active:scale-95 shadow-xs text-center p-2 gap-1 group relative"
                          >
                            <div className="size-8 flex items-center justify-center shrink-0">
                              {renderLobeIcon(detectedIcon, 24)}
                            </div>
                            <span className="text-[10px] font-semibold truncate w-full text-foreground/80 group-hover:text-foreground transition-colors">
                              {p.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="w-full py-8 text-center text-xs text-muted-foreground/60 border border-dashed border-border/80 rounded-2xl bg-muted/5 flex flex-col items-center justify-center gap-2">
                      <Settings2Icon className="size-5 text-muted-foreground/40" />
                      No active providers configured. Click "Add Provider" to get started.
                    </div>
                  )}
                </div>

                {/* Active Models Section */}
                {(() => {
                  const activeModels = providers.flatMap((p) =>
                    p.enabled
                      ? p.models
                          .filter((m) => m.enabled)
                          .map((m) => ({ ...m, provider: p }))
                      : []
                  );
                  return (
                    <div className="pt-4 space-y-4">
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-foreground">Active Models</h3>
                        <p className="text-xs text-muted-foreground">
                          Select a default model or deactivate models directly.
                        </p>
                      </div>
                      {activeModels.length === 0 ? (
                        <div className="p-4 rounded-xl border border-dashed border-border/50 text-center text-xs text-muted-foreground/70">
                          No active models. Enable one by clicking on a provider icon above.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {activeModels.map((m) => {
                            const provIcon = PROVIDER_ID_TO_ICON[m.provider.id] || m.provider.id.charAt(0).toUpperCase() + m.provider.id.slice(1);
                            const iconName = m.icon || detectModelIcon(m.id, m.provider.id);
                            const isDefault = m.id === defaultModel;
                            return (
                              <div
                                key={m.id}
                                className="flex items-center justify-between p-3 rounded-[20px] border border-border bg-muted/10 hover:bg-muted/20 transition-all gap-3"
                              >
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                  <button
                                    onClick={() => handleSetDefaultModel(m.id)}
                                    type="button"
                                    title={isDefault ? "Default model" : "Set as default"}
                                    className={`size-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-all cursor-pointer overflow-hidden ${
                                      isDefault
                                        ? "border-emerald-500 bg-emerald-500"
                                        : "border-muted-foreground/30 hover:border-emerald-400"
                                    }`}
                                  >
                                    <AnimatePresence mode="wait">
                                      {isDefault && (
                                        <motion.div
                                          key="check"
                                          initial={{ scale: 2.5, rotate: -20, opacity: 0 }}
                                          animate={{ scale: 1, rotate: 0, opacity: 1 }}
                                          exit={{ scale: 0, rotate: 20, opacity: 0 }}
                                          transition={{ type: "spring", stiffness: 400, damping: 15 }}
                                          className="flex items-center justify-center"
                                        >
                                          <CheckIcon className="size-3 text-white" />
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </button>
                                  <div className="size-7 flex items-center justify-center shrink-0">
                                    {renderLobeIcon(iconName, 16)}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold truncate text-foreground">{m.name}</p>
                                    <p className="text-xs text-muted-foreground/70 truncate flex items-center gap-1">
                                      {renderLobeIcon(provIcon, 10)}
                                      <span>{m.provider.name}</span>
                                    </p>
                                  </div>
                                </div>
                                {/* Built-in Qube models have no delete/deactivate button */}
                                {(m as any).isBuiltIn || (m.provider as any).isBuiltIn ? null : (
                                  <button
                                    onClick={() => handleDeactivateModel(m.id)}
                                    type="button"
                                    className="size-7 flex items-center justify-center rounded-lg transition-colors text-muted-foreground hover:text-red-500 shrink-0 cursor-pointer"
                                    title="Deactivate model"
                                  >
                                    <Trash2Icon className="size-3.5" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* MCP Servers Section */}
                <div className="border-t border-border/40 pt-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-foreground">MCP Servers</h3>
                      <p className="text-xs text-muted-foreground">
                        Add custom MCP servers to give the agent access to additional tools and data sources.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => setMcpManagerOpen(true)}
                        variant="outline"
                        className="rounded-full font-semibold px-4 h-8 flex items-center gap-1.5"
                        size="sm"
                      >
                        <PlusIcon className="size-3.5" />
                        {mcpServers.length > 0 ? "Manage" : "Add Server"}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Composio API Key Section */}
                <div className="border-t border-border/40 pt-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-foreground">Composio API Key</h3>
                      <p className="text-xs text-muted-foreground">
                        Powers Gmail, Drive, Calendar, Slack and other app connections. Releases include a built-in key — switch to your own for higher limits or private projects.
                      </p>
                      <p className="text-[11px] text-muted-foreground/70">
                        {composioMode === "custom" && composioHasCustom
                          ? `Using your custom key${composioMasked ? ` (${composioMasked})` : ""}.`
                          : composioHasBuiltin
                            ? "Using the built-in key."
                            : "No built-in key found in this build — add your own key to use app connections."}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => setComposioKeyOpen(true)}
                        variant="outline"
                        className="rounded-full font-semibold px-4 h-8 flex items-center gap-1.5"
                        size="sm"
                      >
                        Manage
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Skills Section (under MCP) */}
                <SkillsTab onDialogOpenChange={setSkillsDialogOpen} />

                {/* Custom Instructions Section */}
                <div className="border-t border-border/40 pt-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-foreground">Custom Instructions</h3>
                      <p className="text-xs text-muted-foreground">Provide system instructions that append to every conversation.</p>
                    </div>
                    <Button
                      onClick={() => {
                        setTempInstructions(customSystemPrompt);
                        setCustomInstructionsOpen(true);
                      }}
                      variant="outline"
                      className="rounded-full font-semibold px-4 h-8"
                      size="sm"
                    >
                      Configure
                    </Button>
                  </div>
                  {customSystemPrompt ? (
                    <div className="text-xs text-muted-foreground bg-muted/15 rounded-xl border border-border/60 p-3 line-clamp-3 leading-relaxed">
                      {customSystemPrompt}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/60 italic">No custom system instructions configured.</p>
                  )}
                </div>

                {/* Memory Section */}
                <div className="border-t border-border/40 pt-6 space-y-4">
                  <div className="rounded-xl border border-border/60 divide-y divide-border/40">
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="space-y-0.5">
                        <span className="text-sm font-medium text-foreground">Memory</span>
                        <p className="text-xs text-muted-foreground">Qube recalls and saves memories across chats.</p>
                      </div>
                      <SwitchToggle checked={memoryEnabled} onCheckedChange={(v) => {
                        setMemoryEnabled(v);
                        try { localStorage.setItem("qube-memory-enabled", String(v)); } catch {}
                        fetch("/api/settings", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            settings: {
                              defaultModel,
                              customSystemPrompt,
                              temperature,
                              userName,
                              userAbout,
                              runOnStart,
                              keepAlive,
                              memoryEnabled: v,
                            },
                          }),
                        }).catch(() => {});
                      }} />
                    </div>
                  </div>
                </div>

                {/* Startup & Background Section */}
                <div className="border-t border-border/40 pt-6 space-y-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-foreground">Startup & Background</h3>
                    <p className="text-xs text-muted-foreground">Control how Qube starts and stays active.</p>
                  </div>
                  <div className="rounded-xl border border-border/60 divide-y divide-border/40">
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="space-y-0.5">
                        <span className="text-sm font-medium text-foreground">Run on start</span>
                        <p className="text-xs text-muted-foreground">Launch Qube automatically when you log in.</p>
                      </div>
                      <SwitchToggle checked={runOnStart} onCheckedChange={(v) => {
                        setRunOnStart(v);
                        try { localStorage.setItem("qube-run-on-start", String(v)); } catch {}
                        syncTauriAutostart(v);
                        saveSettingsToServer();
                      }} />
                    </div>
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="space-y-0.5">
                        <span className="text-sm font-medium text-foreground">Keep server running</span>
                        <p className="text-xs text-muted-foreground">Maintain the background server for scheduled tasks and heartbeat monitoring.</p>
                      </div>
                      <SwitchToggle checked={keepAlive} onCheckedChange={(v) => {
                        setKeepAlive(v);
                        try { localStorage.setItem("qube-keep-alive", String(v)); } catch {}
                        saveSettingsToServer();
                      }} />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </TabsContent>

          {/* Scheduling Tab */}
          <TabsContent value="scheduling" className="flex-1 flex flex-col overflow-hidden p-6 mt-0 data-[state=inactive]:hidden">
            <SchedulingTab />
            </TabsContent>
        </Tabs>

      <Dialog open={!!clearConfirm} onOpenChange={(v) => { if (!v) setClearConfirm(null); }}>
        <DialogContent className="sm:max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Clear {clearConfirm === "memories" ? "Memories" : "Sessions"}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete all {clearConfirm === "memories" ? "long-term memories" : "past sessions"}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="rounded-full h-8">Cancel</Button>
            </DialogClose>
            <Button
              variant="outline"
              onClick={() => {
                if (clearConfirm === "memories") handleClearMemories();
                else handleClearSessions();
                setClearConfirm(null);
              }}
              className="rounded-full text-red-500 border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5 px-3 h-8"
            >
              <Trash2Icon className="size-3.5" />
              Clear All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addProviderOpen} onOpenChange={(v) => {
        if (!v && configureProvider !== null) return;
        setAddProviderOpen(v);
      }}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Add Provider</DialogTitle>
            <DialogDescription>
              Search and select an AI provider to configure credentials.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search providers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-muted/10 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="grid grid-cols-4 gap-3 max-h-[300px] overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-2 px-1 justify-items-center content-start mx-auto">
              {Array.from(new Map(
                [
                  ...DEFAULT_PROVIDERS,
                  ...providers.filter((p) => !(p as any).isBuiltIn && !DEFAULT_PROVIDERS.some((dp) => dp.id === p.id)),
                ].map((p) => [p.id, p])
              ).values())
                .filter((p) => !(p as any).isBuiltIn)
                .filter((p) => p.id !== "chatgpt")
                .filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.id.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((p) => {
                  const detectedIcon = PROVIDER_ID_TO_ICON[p.id] || p.id.charAt(0).toUpperCase() + p.id.slice(1);
                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        setConfigureProvider(p);
                        setConfigApiKey(p.apiKey || "");
                        setConfigBaseUrl(p.baseURL || "");
                        setConfigHasApiKey(p.hasApiKey !== undefined ? p.hasApiKey : true);
                      }}
                      className="flex flex-col items-center justify-center size-20 rounded-3xl ring-1 ring-inset ring-border bg-background hover:bg-muted/40 cursor-pointer transition-all hover:scale-105 active:scale-95 text-center p-2 gap-1 group"
                    >
                      <div className="size-8 flex items-center justify-center shrink-0">
                        {renderLobeIcon(detectedIcon, 24)}
                      </div>
                      <span className="text-[9px] font-semibold truncate w-full text-foreground/80 group-hover:text-foreground">
                        {p.name}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={configureProvider !== null} onOpenChange={(v) => {
        if (v) return;
        setConfigureProvider(null);
        setAddProviderOpen(true);
      }}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Configure {configureProvider?.name}</DialogTitle>
            <DialogDescription>
              Enter credentials and settings for this provider.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {configureProvider && !["ollama", "lmstudio", "custom"].includes(configureProvider.id) ? (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">API Key</label>
                <input
                  type="password"
                  placeholder="Enter API Key..."
                  value={configApiKey}
                  onChange={(e) => setConfigApiKey(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between py-2 border-b border-border/40">
                  <span className="text-sm font-semibold text-foreground">Require API Key</span>
                  <SwitchToggle
                    checked={configHasApiKey}
                    onCheckedChange={setConfigHasApiKey}
                  />
                </div>

                {configHasApiKey && (
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">API Key</label>
                    <input
                      type="password"
                      placeholder="Enter API Key..."
                      value={configApiKey}
                      onChange={(e) => setConfigApiKey(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                )}
              </>
            )}

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Base URL</label>
              <input
                type="text"
                placeholder={configureProvider?.id === "custom" ? "https://api.yourprovider.com/v1" : "Base URL..."}
                value={configBaseUrl}
                onChange={(e) => setConfigBaseUrl(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {configureProvider?.id === "openai" && (
              <>
                <div className="flex items-center justify-center py-1">
                  <span className="text-[11px] font-medium text-muted-foreground/60 tracking-wide">or</span>
                </div>
                <div className="rounded-[30px] border border-border bg-muted/5 min-h-[56px] p-3 w-full flex items-center justify-center overflow-hidden">
                  <div className="flex items-center justify-between gap-4 w-full">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-9 flex items-center justify-center shrink-0">
                        {renderLobeIcon("OpenAI", 22)}
                      </div>
                      {chatGptForOpenAI.status === "authenticated" ? (
                        <div className="space-y-0.5 text-left min-w-0">
                          <h4 className="text-xs font-semibold text-foreground">ChatGPT</h4>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {chatGptForOpenAI.user?.email || (chatGptForOpenAI.user?.plan ? `${chatGptForOpenAI.user.plan} plan` : "Connected")}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-0.5 text-left min-w-0">
                          <h4 className="text-xs font-semibold text-foreground">Connect OpenAI subscription</h4>
                          <p className="text-[11px] text-muted-foreground">Use your ChatGPT subscription</p>
                        </div>
                      )}
                    </div>
                    {chatGptForOpenAI.status === "authenticated" ? (
                      <CheckIcon className="size-4 text-emerald-500 shrink-0" />
                    ) : (
                      <Button
                        onClick={() => chatGptForOpenAI.login()}
                        disabled={chatGptForOpenAI.isConnecting || chatGptForOpenAI.status === "pending"}
                        className="rounded-full font-semibold px-5 h-9 flex items-center gap-1.5 shrink-0"
                        size="sm"
                      >
                        {chatGptForOpenAI.isConnecting || chatGptForOpenAI.status === "pending" ? (
                          <Loader2Icon className="size-4 animate-spin" />
                        ) : null}
                        {chatGptForOpenAI.isConnecting || chatGptForOpenAI.status === "pending" ? "Connecting…" : "Connect"}
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}

            {configError && (
              <div className="text-xs text-red-500 bg-red-500/10 rounded-xl px-3 py-2 border border-red-500/20">
                {configError}
              </div>
            )}
            {configureProvider?.id === "openai" && chatGptForOpenAI.error && chatGptForOpenAI.status !== "pending" && (
              <p className="text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20 text-center">
                {chatGptForOpenAI.error}
              </p>
            )}
          </div>

          <DialogFooter className="pt-2">
            <ConfirmGroup
              onCancel={() => setConfigureProvider(null)}
              onConfirm={handleSaveConfigure}
              saving={savingConfigure}
              saved={savedConfigure}
              confirmDisabled={configHasApiKey && !configApiKey.trim()}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ChatGPT code popup for OpenAI connect */}
      <Dialog open={chatGptCodeDialogOpen} onOpenChange={(open) => {
        if (!open && (chatGptForOpenAI.status === "pending" || (chatGptForOpenAI as any).status === "connecting")) {
          try { chatGptForOpenAI.logout(); } catch {}
          try {
            const w = window.open("", "login-with-chatgpt");
            if (w && !w.closed) w.close();
          } catch {}
        }
        setChatGptCodeDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Connect ChatGPT</DialogTitle>
            <DialogDescription>Enter this code in the opened browser tab to authorize Qube.</DialogDescription>
          </DialogHeader>
          <div className="py-4 flex flex-col items-center gap-4">
            <div className="group relative flex justify-center items-center w-full">
              <code className="text-3xl font-mono font-bold tracking-[0.2em] select-all text-center">{chatGptForOpenAI.userCode || "— — — —"}</code>
            </div>
            {chatGptForOpenAI.verificationUrl && (
              <a href={chatGptForOpenAI.verificationUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline font-medium">
                Open verification page ↗
              </a>
            )}
          </div>
          <div className="flex justify-end pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                try { chatGptForOpenAI.logout(); } catch {}
                try {
                  const w = window.open("", "login-with-chatgpt");
                  if (w && !w.closed) w.close();
                } catch {}
                setChatGptCodeDialogOpen(false);
              }}
              className="rounded-full h-8 px-4 text-red-500 border-red-500/30 hover:bg-red-500/10 hover:text-red-600"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={manageProvider !== null} onOpenChange={(v) => {
        if (!v && manageProvider) {
          const updated = providers.map((p) => {
            if (p.id === manageProvider.id) return { ...p, models: manageModels };
            return p;
          });
          saveProviders(updated);
        }
        if (!v) setManageProvider(null);
      }}>
        <DialogContent className="sm:max-w-xl rounded-3xl max-h-[90vh] overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <DialogHeader>
            <DialogTitle>{manageProvider?.name} Settings</DialogTitle>
            <DialogDescription>
              Manage models for this provider. You can have a max of 5 models toggled in total.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 min-w-0">
            <div className="flex items-center justify-between pb-2 border-b border-border/40">
              <span className="text-sm font-semibold text-foreground">Models</span>
              <div className="flex items-center gap-2">
                {(manageProvider as any)?.isBuiltIn ? null : (
                  <Button
                    onClick={handleRefreshModels}
                    variant="outline"
                    className="rounded-full h-7 w-7 p-0 flex items-center justify-center"
                    size="sm"
                    disabled={refreshingModels || refreshedModels}
                  >
                    <RefreshCwIcon className={`size-3 ${refreshingModels ? "animate-spin" : ""}`} />
                  </Button>
                )}
                {(manageProvider as any)?.isBuiltIn ? null : (
                  <Button
                    onClick={() => {
                      setCustomModelName("");
                      setCustomModelCode("");
                      setAddCustomModelOpen(true);
                    }}
                    variant="outline"
                    className="rounded-full font-semibold px-3 h-7 text-xs flex items-center gap-1 shrink-0"
                    size="sm"
                  >
                    <PlusIcon className="size-3" />
                    Add Custom Model
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {manageModels.map((m) => {
                const provId = manageProvider?.id || "";
                const iconName = m.icon || detectModelIcon(m.id, provId);
                const isCustomModel = !manageProvider?.models.some((orig) => orig.id === m.id);

                return (
                  <div
                    key={m.id}
                    className="flex w-full max-w-full items-center justify-between p-3.5 rounded-[20px] border border-border bg-muted/10 hover:bg-muted/20 transition-all gap-4 overflow-hidden"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <button
                        onClick={() => setBrowseIconModelId(m.id)}
                        type="button"
                        className="size-8 flex items-center justify-center rounded-xl bg-background border border-border/80 hover:bg-muted transition-colors shrink-0 cursor-pointer"
                        title="Browse icon"
                      >
                        {renderLobeIcon(iconName, 18)}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate text-foreground">{m.name}</p>
                        <p className="text-xs font-mono text-muted-foreground truncate">{m.id}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      {/* Built-in Qube models have no delete button */}
                      {(m as any).isBuiltIn ? null : isCustomModel && (
                        <button
                          onClick={() => {
                            setManageModels((prev) => prev.filter((prevM) => prevM.id !== m.id));
                          }}
                          className="size-8 flex items-center justify-center rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors shrink-0 cursor-pointer"
                          title="Delete Custom Model"
                        >
                          <Trash2Icon className="size-4" />
                        </button>
                      )}
                      {m.imageInput ? <EyeIcon className="size-3.5 text-muted-foreground/50 shrink-0" /> : null}
                      {m.reasoning ? <BrainIcon className="size-3.5 text-muted-foreground/50 shrink-0" /> : null}
                      <SwitchToggle
                        checked={m.enabled}
                        onCheckedChange={(checked) => handleToggleModel(m.id, checked)}
                      />
                    </div>
                  </div>
                );
              })}
              {manageModels.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground/60 italic">
                  No models configured. Add a custom model above.
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="pt-2 flex items-center justify-between min-w-0">
            {(manageProvider as any)?.isBuiltIn ? (
              <div />
            ) : (
              <Button
                onClick={handleDeleteProvider}
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full text-red-500 border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5 px-3 h-8"
              >
                <Trash2Icon className="size-3.5" />
                Delete
              </Button>
            )}
            <ConfirmGroup
              onCancel={() => setManageProvider(null)}
              onConfirm={handleSaveManage}
              saving={savingManage}
              saved={savedManage}
            />
          </DialogFooter>

          <Dialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
            <DialogContent className="sm:max-w-sm rounded-3xl">
              <DialogHeader>
                <DialogTitle>Delete Provider</DialogTitle>
                <DialogDescription>
                  Are you sure you want to remove {manageProvider?.name}? All configured models will be deleted.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <div className="flex items-center gap-2 ml-auto">
                  <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(false)} className="rounded-full h-8 px-4">
                    Cancel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleConfirmDeleteProvider}
                    className="rounded-full text-red-500 border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5 px-3 h-8"
                  >
                    <Trash2Icon className="size-3.5" />
                    Delete
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={browseIconModelId !== null} onOpenChange={(v) => { if (!v) setBrowseIconModelId(null); }}>
            <DialogContent className="sm:max-w-md rounded-3xl">
              <DialogHeader>
                <DialogTitle>Select Model Icon</DialogTitle>
                <DialogDescription>
                  Choose a Lobe icon to represent this model.
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-5 gap-3 py-4 px-1 max-h-[350px] overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden justify-items-center content-start mx-auto">
                {Object.keys(LOBE_ICONS_MAP).map((iconName) => (
                  <div
                    key={iconName}
                    onClick={() => {
                      if (browseIconModelId) {
                        setManageModels((prev) =>
                          prev.map((m) => (m.id === browseIconModelId ? { ...m, icon: iconName } : m))
                        );
                        setBrowseIconModelId(null);
                      }
                    }}
                    className="flex flex-col items-center justify-center size-14 rounded-2xl ring-1 ring-inset ring-border bg-background hover:bg-muted/40 cursor-pointer transition-all hover:scale-105 active:scale-95 text-center p-2 gap-1 group"
                  >
                    {renderLobeIcon(iconName, 20)}
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={addCustomModelOpen} onOpenChange={setAddCustomModelOpen}>
            <DialogContent className="sm:max-w-md rounded-3xl">
              <DialogHeader>
                <DialogTitle>Add Custom Model</DialogTitle>
                <DialogDescription>
                  Enter the details of the custom model code and name.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">Model Name</label>
                  <input
                    type="text"
                    placeholder="My custom model..."
                    value={customModelName}
                    onChange={(e) => setCustomModelName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">Model Code (ID)</label>
                  <input
                    type="text"
                    placeholder="deepseek-r1:14b..."
                    value={customModelCode}
                    onChange={(e) => setCustomModelCode(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>

              <DialogFooter className="pt-2">
                <ConfirmGroup
                  onCancel={() => setAddCustomModelOpen(false)}
                  onConfirm={handleSaveCustomModel}
                  saving={savingCustomModel}
                  saved={savedCustomModel}
                  confirmDisabled={!customModelName.trim() || !customModelCode.trim()}
                />
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>

          <Dialog open={hardResetConfirm} onOpenChange={setHardResetConfirm}>
            <DialogContent className="sm:max-w-sm rounded-3xl">
              <DialogHeader>
                <DialogTitle>Hard Reset</DialogTitle>
                <DialogDescription>
                  This will permanently delete all providers, models, ChatGPT login, memories, sessions, and settings, then reload Qube. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <div className="flex items-center gap-2 ml-auto">
                  <Button variant="outline" size="sm" onClick={() => setHardResetConfirm(false)} className="rounded-full h-8 px-4">
                    Cancel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleHardReset}
                    className="rounded-full text-red-500 border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5 px-3 h-8"
                  >
                    <Trash2Icon className="size-3.5" />
                    Hard Reset
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={termsOpen} onOpenChange={setTermsOpen}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col rounded-3xl p-0 overflow-hidden gap-0 bg-background">
              <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
                <DialogTitle>Terms of Service and Privacy Policy</DialogTitle>
                <DialogDescription className="sr-only">Review and revoke consent</DialogDescription>
              </DialogHeader>
              {/* container stays still — only text scrolls inside — inner 28 = button 16 + inset 12 (bottom-3) — popup reverted to original rounded-3xl per request */}
              <div className="flex-1 min-h-0 flex flex-col px-5 pb-5 overflow-hidden">
                <div className="flex-1 min-h-0 flex flex-col rounded-[28px] border border-border/60 bg-muted/20 overflow-hidden relative">
                  <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden p-4 pb-16 text-xs text-muted-foreground leading-relaxed">
                    <TermsPrivacyContent />
                  </div>
                  {/* revoke button hovers container — no full-width dark bar */}
                  <div className="absolute bottom-3 right-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        try { localStorage.setItem("qube-terms-accepted", "false"); } catch {}
                        setTermsOpen(false);
                        setOpen(false);
                        setTimeout(() => {
                          window.dispatchEvent(new CustomEvent("qube-revoke-consent"));
                          window.dispatchEvent(new CustomEvent("qube-open-onboarding", { detail: { stage: 2 } } as any));
                        }, 100);
                      }}
                      className="rounded-full h-8 px-4 text-red-500 border-red-500/30 hover:bg-red-500/10 bg-background/90 backdrop-blur-md shadow-md dark:bg-background/90 dark:border-red-500/40"
                    >
                      Revoke consent
                    </Button>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>

      <Dialog open={customInstructionsOpen} onOpenChange={handleInstructionsOpenChange}>
        <DialogContent className="sm:max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle>Custom System Instructions</DialogTitle>
            <DialogDescription>
              Appends extra system prompt details to every new chat request.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <textarea
              placeholder="E.g. Always respond in Italian. Prefer functional programming patterns. Never use semicolons in JS…"
              value={tempInstructions}
              onChange={(e) => setTempInstructions(e.target.value)}
              rows={5}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring resize-none leading-relaxed"
            />
          </div>

          <DialogFooter className="pt-2">
            <ConfirmGroup
              onCancel={() => setCustomInstructionsOpen(false)}
              onConfirm={handleSaveInstructions}
              saving={savingInstructions}
              saved={savedInstructions}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mcpManagerOpen} onOpenChange={(v) => {
        if (!v) { setMcpFormView(false); setMcpManagerOpen(false); }
      }}>
        <DialogContent className="sm:max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle>MCP Servers</DialogTitle>
            <DialogDescription>
              Add or remove custom MCP servers to extend the agent's capabilities.
            </DialogDescription>
          </DialogHeader>

          {mcpFormView ? (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Name</label>
                <input
                  type="text"
                  placeholder="My Database"
                  value={mcpFormName}
                  onChange={(e) => setMcpFormName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Command</label>
                <input
                  type="text"
                  placeholder="npx"
                  value={mcpFormCommand}
                  onChange={(e) => setMcpFormCommand(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Arguments (optional)</label>
                <input
                  type="text"
                  placeholder="-y @modelcontextprotocol/server-filesystem /path"
                  value={mcpFormArgs}
                  onChange={(e) => setMcpFormArgs(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Environment Variables</label>
                <textarea
                  placeholder="KEY=VALUE (one per line)"
                  value={mcpFormEnv}
                  onChange={(e) => setMcpFormEnv(e.target.value)}
                  rows={3}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>
              <div className="pt-4 flex items-center justify-between">
                {mcpEditingId ? (
                  <Button
                    onClick={() => setMcpDeleteConfirm(mcpEditingId)}
                    variant="outline"
                    size="sm"
                    className="rounded-full text-red-500 border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5 px-3 h-8"
                  >
                    <Trash2Icon className="size-3.5" />
                    Delete
                  </Button>
                ) : <div />}
                <div className="w-fit flex items-center gap-2 rounded-full border border-border/60 bg-muted/10 hover:bg-muted/20 transition-colors px-1.5 py-1.5 shrink-0">
                  <button
                    onClick={() => {
                      setMcpEditingId(null);
                      setMcpFormView(false);
                    }}
                    type="button"
                    className="flex items-center justify-center size-8 rounded-full text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                    title="Cancel"
                  >
                    <XIcon className="size-4" />
                  </button>
                  <div className="relative">
                    <AnimatePresence mode="wait">
                      {mcpSaved ? (
                        <motion.div
                          key="saved"
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.8, opacity: 0 }}
                          className="flex items-center justify-center size-8 rounded-full bg-emerald-500 text-white"
                        >
                          <CheckIcon className="size-4" />
                        </motion.div>
                      ) : (
                        <motion.div
                          key="save"
                          initial={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.8, opacity: 0 }}
                        >
                          <Button
                            className="rounded-full font-semibold h-8 px-4"
                            size="sm"
                            disabled={!mcpFormName.trim() || !mcpFormCommand.trim()}
                            onClick={() => {
                              const name = mcpFormName.trim();
                              const command = mcpFormCommand.trim();
                              const argsStr = mcpFormArgs.trim();
                              // Quote-aware split: respects "double quotes" and 'single quotes',
                              // empty string → no args (many servers need zero args).
                              const args: string[] = [];
                              if (argsStr) {
                                const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
                                let m: RegExpExecArray | null;
                                while ((m = re.exec(argsStr)) !== null) {
                                  args.push(m[1] ?? m[2] ?? m[3]);
                                }
                              }
                              const env: Record<string, string> = {};
                              for (const line of mcpFormEnv.split("\n")) {
                                const trimmed = line.trim();
                                if (!trimmed) continue;
                                const eqIdx = trimmed.indexOf("=");
                                if (eqIdx > 0) {
                                  env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
                                }
                              }
                              if (mcpEditingId) {
                                setMcpServers((prev) => prev.map((s) => s.id === mcpEditingId ? {
                                  ...s,
                                  name,
                                  command,
                                  args,
                                  env,
                                } : s));
                              } else {
                                setMcpServers((prev) => [...prev, {
                                  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                                  name,
                                  command,
                                  args,
                                  env,
                                }]);
                              }
                              setMcpSaved(true);
                              setTimeout(() => {
                                setMcpSaved(false);
                                setMcpEditingId(null);
                                setMcpFormName("");
                                setMcpFormCommand("");
                                setMcpFormArgs("");
                                setMcpFormEnv("");
                                setMcpFormView(false);
                              }, 800);
                            }}
                          >
                            {mcpEditingId ? "Save" : "Add Server"}
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              {mcpServers.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-border/50 text-center text-xs text-muted-foreground/70">
                  No custom MCP servers configured.
                </div>
              ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto overflow-x-hidden scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden min-w-0">
                  {mcpServers.map((srv) => (
                    <div key={srv.id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/10 gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate text-foreground">{srv.name}</p>
                        <p className="text-xs text-muted-foreground/70 truncate font-mono">{srv.command} {srv.args.join(" ")}</p>
                        {Object.keys(srv.env).length > 0 && (
                          <p className="text-xs text-muted-foreground/50 truncate mt-0.5">{Object.keys(srv.env).length} env var(s)</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => {
                            setMcpEditingId(srv.id);
                            setMcpFormName(srv.name);
                            setMcpFormCommand(srv.command);
                            setMcpFormArgs(srv.args.join(" "));
                            setMcpFormEnv(Object.entries(srv.env).map(([k, v]) => `${k}=${v}`).join("\n"));
                            setMcpFormView(true);
                          }}
                          type="button"
                          className="size-7 flex items-center justify-center rounded-lg transition-colors text-muted-foreground hover:text-blue-500 cursor-pointer"
                          title="Edit server"
                        >
                          <PencilIcon className="size-3.5" />
                        </button>
                        <button
                          onClick={() => setMcpDeleteConfirm(srv.id)}
                          type="button"
                          className="size-7 flex items-center justify-center rounded-lg transition-colors text-muted-foreground hover:text-red-500 cursor-pointer"
                          title="Remove server"
                        >
                          <Trash2Icon className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end pt-2">
                <Button
                  onClick={() => {
                    setMcpEditingId(null);
                    setMcpFormName("");
                    setMcpFormCommand("");
                    setMcpFormArgs("");
                    setMcpFormEnv("");
                    setMcpFormView(true);
                  }}
                  className="rounded-full font-semibold"
                  size="sm"
                >
                  <PlusIcon className="size-3.5 mr-1.5" />
                  Add New Server
                </Button>
              </div>
            </div>
          )}

      <Dialog open={mcpDeleteConfirm !== null} onOpenChange={(v) => { if (!v) setMcpDeleteConfirm(null); }}>
        <DialogContent className="sm:max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Delete MCP Server</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this MCP server?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={() => setMcpDeleteConfirm(null)} className="rounded-full h-8 px-4">
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (mcpDeleteConfirm) {
                    setMcpServers((prev) => prev.filter((s) => s.id !== mcpDeleteConfirm));
                    setMcpEditingId(null);
                    setMcpFormView(false);
                  }
                  setMcpDeleteConfirm(null);
                }}
                className="rounded-full text-red-500 border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5 px-3 h-8"
              >
                <Trash2Icon className="size-3.5" />
                Delete
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

        </DialogContent>
      </Dialog>

      <Dialog open={composioKeyOpen} onOpenChange={(v) => { if (!v) setComposioKeyOpen(false); }}>
        <DialogContent className="sm:max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle>Composio API Key</DialogTitle>
            <DialogDescription>
              Choose which key powers your app connections (Gmail, Drive, Calendar, Slack and others).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <button
              type="button"
              onClick={() => setComposioMode("builtin")}
              className={cn(
                "w-full text-left p-3.5 rounded-2xl border transition-all cursor-pointer",
                composioMode === "builtin"
                  ? "border-emerald-500/60 bg-emerald-500/5"
                  : "border-border bg-muted/10 hover:bg-muted/20"
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  "size-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-all",
                  composioMode === "builtin" ? "border-emerald-500 bg-emerald-500" : "border-muted-foreground/30"
                )}>
                  {composioMode === "builtin" && <CheckIcon className="size-3 text-white" />}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Built-in key <span className="text-[10px] font-medium text-muted-foreground">(recommended)</span></p>
                  <p className="text-xs text-muted-foreground/80 leading-relaxed">
                    {composioHasBuiltin
                      ? "Included with Qube releases. Nothing to paste."
                      : "Not found in this build — releases include one, or add your own below."}
                  </p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setComposioMode("custom")}
              className={cn(
                "w-full text-left p-3.5 rounded-2xl border transition-all cursor-pointer",
                composioMode === "custom"
                  ? "border-emerald-500/60 bg-emerald-500/5"
                  : "border-border bg-muted/10 hover:bg-muted/20"
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  "size-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-all",
                  composioMode === "custom" ? "border-emerald-500 bg-emerald-500" : "border-muted-foreground/30"
                )}>
                  {composioMode === "custom" && <CheckIcon className="size-3 text-white" />}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Custom key</p>
                  <p className="text-xs text-muted-foreground/80 leading-relaxed">
                    Use your own key from dashboard.composio.dev — for higher limits or private projects.
                    {composioHasCustom && composioMasked ? ` Saved key ends in ${composioMasked}.` : ""}
                  </p>
                </div>
              </div>
            </button>

            {composioMode === "custom" && (
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-semibold text-foreground">
                  {composioHasCustom ? "Replace custom key (leave empty to keep the saved one)" : "Custom Composio API key"}
                </label>
                <div className="relative">
                  <input
                    type={composioShowKey ? "text" : "password"}
                    placeholder={composioHasCustom ? "Paste a new key to replace the saved one" : "Paste your key (starts with ak_…)"}
                    value={composioKeyInput}
                    onChange={(e) => setComposioKeyInput(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full px-3.5 py-2.5 pr-11 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setComposioShowKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 size-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title={composioShowKey ? "Hide key" : "Show key"}
                  >
                    <EyeIcon className="size-4" />
                  </button>
                </div>
              </div>
            )}

            {composioError && (
              <p className="text-xs text-red-500 leading-relaxed">{composioError}</p>
            )}
          </div>

          <DialogFooter className="pt-2">
            <ConfirmGroup
              onCancel={() => setComposioKeyOpen(false)}
              onConfirm={handleSaveComposioKey}
              saving={composioSaving}
              saved={composioSaved}
              confirmDisabled={composioMode === "custom" && !composioHasCustom && !composioKeyInput.trim()}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </DialogContent>
    </Dialog>

    </>
  );
}

function ConfirmGroup({
  onCancel,
  onConfirm,
  saving,
  saved,
  confirmDisabled = false,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
  saved: boolean;
  confirmDisabled?: boolean;
}) {
  return (
    <div className="w-fit ml-auto flex items-center gap-2 rounded-full border border-border/60 bg-muted/10 hover:bg-muted/20 transition-colors px-1.5 py-1.5 shrink-0">
      <button
        onClick={onCancel}
        type="button"
        className="flex items-center justify-center size-8 rounded-full text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
        title="Cancel"
      >
        <XIcon className="size-4" />
      </button>
      <div className="relative">
        <AnimatePresence mode="wait">
          {saved ? (
            <motion.div
              key="saved"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="flex items-center justify-center size-8 rounded-full bg-emerald-500 text-white"
            >
              <CheckIcon className="size-4" />
            </motion.div>
          ) : (
            <motion.div
              key="save"
              initial={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
            >
              <Button
                onClick={onConfirm}
                disabled={saving || confirmDisabled}
                className="rounded-full font-semibold h-8 px-4"
                size="sm"
              >
                {saving ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  "Confirm"
                )}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
