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
  Sparkles,
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
import { Switch } from "radix-ui";

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
  models: {
    id: string;
    name: string;
    enabled: boolean;
    icon?: string;
    imageInput?: boolean;
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
  {
    id: "custom",
    name: "Custom OpenAI",
    baseURL: "",
    enabled: false,
    hasApiKey: true,
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
  custom: "OpenAI",
};

export function renderLobeIcon(iconName: string, size: number = 24, className?: string) {
  const IconComp = LOBE_ICONS_MAP[iconName];
  if (!IconComp) return <Sparkles className={cn("size-6 text-muted-foreground/60", className)} />;
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

  return "OpenAI";
}

import { detectModelImageSupport } from "@/lib/agent/vision-support";

interface FetchedModel {
  id: string;
  imageInput: boolean;
}

async function fetchProviderModels(baseURL: string, apiKey: string): Promise<FetchedModel[]> {
  const base = baseURL.replace(/\/+$/, "");

  const tryFetch = async (url: string): Promise<Response> => {
    return fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
  };

  let url = base + "/models";
  let res = await tryFetch(url);

  if (res.status === 404 && !base.endsWith("/v1")) {
    url = base + "/v1/models";
    res = await tryFetch(url);
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch models from ${url}: ${res.status} ${res.statusText}`);
  }
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
        models.push({ id: m.id, imageInput });
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

export function SettingsDialog({ children }: { children: ReactNode }) {
  const { setTheme } = useTheme();
  const [themePref, setThemePref] = useState("light");
  const [open, setOpen] = useState(false);
  const [tabValue, setTabValue] = useState("preferences");

  useEffect(() => {
    const sync = () => {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark" || stored === "system") {
        setThemePref(stored);
      } else {
        setThemePref(document.documentElement.classList.contains("dark") ? "dark" : "light");
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Memory state
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [deletingMemoryId, setDeletingMemoryId] = useState<string | null>(null);

  // Sessions state
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  // Clear confirmation state
  const [clearConfirm, setClearConfirm] = useState<"memories" | "sessions" | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<boolean>(false);

  // Preferences state
  const [defaultModel, setDefaultModel] = useState("");
  const [customSystemPrompt, setCustomSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [userName, setUserName] = useState("");
  const [userAbout, setUserAbout] = useState("");
  const [savedPrefs, setSavedPrefs] = useState(false);

  // Advanced settings state
  const [runOnStart, setRunOnStart] = useState(false);
  const [keepAlive, setKeepAlive] = useState(false);
  const [savedAdvanced, setSavedAdvanced] = useState(false);

  // Computer Use state
  const [computerUseEnabled, setComputerUseEnabled] = useState(false);


  const fetchMemories = useCallback(async () => {
    setLoadingMemories(true);
    try {
      const res = await fetch("/api/settings/memory");
      const data = await res.json();
      if (data.entries) setMemories(data.entries);
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
    } catch { /* ignore */ }
    finally { setDeletingMemoryId(null); }
  };

  const handleClearMemories = async () => {
    try {
      const res = await fetch("/api/settings/memory", { method: "DELETE" });
      const data = await res.json();
      if (data.entries !== undefined) setMemories([]);
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

    setSavedPrefs(true);
    setTimeout(() => setSavedPrefs(false), 2000);
  };

  const handleSaveUserPreferences = () => {
    localStorage.setItem("qube-user-name", userName);
    localStorage.setItem("qube-user-about", userAbout);
    saveSettingsToServer();
    setSavedPrefs(true);
    setTimeout(() => setSavedPrefs(false), 2000);
  };

  // Providers & models states
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [configureProvider, setConfigureProvider] = useState<ProviderConfig | null>(null);
  const [manageProvider, setManageProvider] = useState<ProviderConfig | null>(null);
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
        },
      }),
    }).catch(() => {});
  }, [defaultModel, customSystemPrompt, temperature, userName, userAbout, runOnStart, keepAlive]);

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
      }));

      await new Promise((r) => setTimeout(r, 400));
      setSavedConfigure(true);
      await new Promise((r) => setTimeout(r, 600));

      const updated = providers.map((p) => {
        if (p.id === configureProvider.id) {
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
    setDeleteConfirm(true);
  };

  const handleConfirmDeleteProvider = () => {
    if (!manageProvider) return;
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
    setManageProvider(null);
    setDeleteConfirm(false);
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

      setDefaultModel(lsDefaultModel || "");
      setCustomSystemPrompt(lsCustomPrompt || "");
      if (lsTemperature) setTemperature(parseFloat(lsTemperature));
      setUserName(lsUserName || "");
      setUserAbout(lsUserAbout || "");
      setRunOnStart(lsRunOnStart === "true");
      setKeepAlive(lsKeepAlive === "true");
      setComputerUseEnabled(localStorage.getItem("qube-computer-use-enabled") === "true");

      // Fetch server-side settings and merge for any keys missing from localStorage
      (async () => {
        try {
          const res = await fetch("/api/settings");
          if (res.ok) {
            const data = await res.json();
            const s = data.settings;
            if (s) {
              if (!lsDefaultModel && s.defaultModel) setDefaultModel(s.defaultModel);
              if (!lsCustomPrompt && s.customSystemPrompt) setCustomSystemPrompt(s.customSystemPrompt);
              if (!lsTemperature && s.temperature !== undefined) setTemperature(s.temperature);
              if (!lsUserName && s.userName) setUserName(s.userName);
              if (!lsUserAbout && s.userAbout) setUserAbout(s.userAbout);
              if (!lsRunOnStart && s.runOnStart !== undefined) setRunOnStart(s.runOnStart);
              if (!lsKeepAlive && s.keepAlive !== undefined) setKeepAlive(s.keepAlive);
            }
          }
        } catch {}

        // Load computer use enabled from server
        try {
          const res = await fetch("/api/computer/settings");
          if (res.ok) {
            const data = await res.json();
            const cs = data.settings;
            if (cs && !localStorage.getItem("qube-computer-use-enabled") && cs.enabled !== undefined) {
              setComputerUseEnabled(cs.enabled);
            }
          }
        } catch {}
      })();

      const storedProviders = localStorage.getItem("qube-providers");
      if (storedProviders) {
        try {
          setProviders(JSON.parse(storedProviders));
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
                setProviders(data.providers);
                if (data.defaultModelId) setDefaultModel(data.defaultModelId);
                localStorage.setItem("qube-providers", JSON.stringify(data.providers));
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

  // Auto-save all settings when dialog closes
  const handleOpenChange = (next: boolean) => {
    const childDialogOpen = clearConfirm !== null
      || addProviderOpen
      || configureProvider !== null
      || manageProvider !== null
      || customInstructionsOpen;

    if (!next && childDialogOpen) return;

    if (!next && open) {
      localStorage.setItem("qube-default-model", defaultModel);
      localStorage.setItem("qube-custom-system-prompt", customSystemPrompt);
      localStorage.setItem("qube-temperature", String(temperature));
      localStorage.setItem("qube-user-name", userName);
      localStorage.setItem("qube-user-about", userAbout);
      localStorage.setItem("qube-run-on-start", String(runOnStart));
      localStorage.setItem("qube-keep-alive", String(keepAlive));
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
    <div className="flex justify-center px-6 pt-5 pb-0 relative">
      <DialogClose className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute end-6 top-1/2 -translate-y-1/2 rounded-full opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
        <XIcon className="size-4" />
        <span className="sr-only">Close</span>
      </DialogClose>
      <TabsList variant="pills" className="bg-muted rounded-full p-1">
        <TabsTrigger value="preferences">
          <SlidersIcon className="size-4" />
          Preferences
        </TabsTrigger>
        <TabsTrigger value="memories">
          <BrainIcon className="size-4" />
          Memories
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
    </div>

          {/* Preferences Tab */}
          <TabsContent value="preferences" className="flex-1 flex flex-col overflow-hidden p-6 mt-0 data-[state=inactive]:hidden">
            <motion.div
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
            <div className="flex-1 overflow-y-auto space-y-6 pr-1">
              {/* Your Name */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">Your Name</label>
                <p className="text-xs text-muted-foreground">What Qube should call you.</p>
                <input
                  type="text"
                  placeholder="Enter your name..."
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full px-3.5 py-2.5 mt-1 rounded-xl border border-border bg-muted/10 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {/* About You */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">About You</label>
                <p className="text-xs text-muted-foreground">Tell Qube about yourself for personalized responses.</p>
                <textarea
                  placeholder="E.g. I'm a full-stack developer who loves Rust and TypeScript..."
                  value={userAbout}
                  onChange={(e) => setUserAbout(e.target.value)}
                  rows={4}
                  className="w-full px-3.5 py-2.5 mt-1 rounded-xl border border-border bg-muted/10 text-sm outline-none focus:ring-1 focus:ring-ring resize-none leading-relaxed"
                />
              </div>

              {/* Theme */}
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-base font-semibold text-foreground">Theme</label>
          <p className="text-sm text-muted-foreground">Choose your preferred appearance.</p>
        </div>
        <Tabs value={themePref} onValueChange={(v) => setTheme(v)}>
          <TabsList variant="pills" className="bg-muted rounded-full p-1">
            <TabsTrigger value="light" className="!size-7 !min-w-7 !p-0 rounded-full flex items-center justify-center"><SunIcon className="size-4" /></TabsTrigger>
            <TabsTrigger value="dark" className="!size-7 !min-w-7 !p-0 rounded-full flex items-center justify-center"><MoonIcon className="size-4" /></TabsTrigger>
            <TabsTrigger value="system" className="!size-7 !min-w-7 !p-0 rounded-full flex items-center justify-center"><MonitorIcon className="size-4" /></TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  </div>

            {/* Save button */}
            <div className="pt-4 border-t border-border/60 mt-4 flex justify-end shrink-0">
              <Button
                onClick={handleSaveUserPreferences}
                className={cn("font-semibold px-5 rounded-full transition-all", savedPrefs && "bg-emerald-600 hover:bg-emerald-700")}
              >
                {savedPrefs
                  ? <CheckIcon className="size-4" />
                  : "Save Preferences"
                }
              </Button>
            </div>
            </motion.div>
          </TabsContent>

          {/* Memories Tab */}
          <TabsContent value="memories" className="flex-1 flex flex-col overflow-hidden p-6 mt-0 data-[state=inactive]:hidden">
            <motion.div
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
            <div className="flex-1 overflow-y-auto space-y-8 pr-1">
              {/* Long-Term Memories */}
              <div>
                <SectionHeader
                  title="Long-Term Memories"
                  action={
                    memories.length > 0 ? (
                      <Button variant="outline" size="sm" onClick={() => setClearConfirm("memories")} className="h-7 text-xs text-destructive border-destructive/30 hover:text-red-500 hover:bg-destructive/10 rounded-full">
                        <Trash2Icon className="size-3 mr-1" />
                        Clear All
                      </Button>
                    ) : undefined
                  }
                />
                <p className="text-xs text-muted-foreground -mt-2 mb-4 shrink-0">
                  Facts and preferences Qube has automatically learned from your conversations.
                </p>

                <div className="rounded-xl border border-border/60 bg-muted/10">
                  {loadingMemories ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2Icon className="size-5 animate-spin text-muted-foreground/40" />
                    </div>
                  ) : memories.length === 0 ? (
                    <EmptyState
                      icon={BrainIcon}
                      title="No memories yet"
                      description="Start chatting and Qube will automatically extract key facts and preferences to remember."
                    />
                  ) : (
                    <div className="divide-y divide-border/50">
                      {memories.map((entry) => (
                        <div
                          key={entry.id}
                          className="group flex items-start gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <CategoryBadge category={entry.category} />
                            </div>
                            <p className="text-sm text-foreground leading-relaxed">{entry.content}</p>
                            <RelevanceBar relevance={entry.relevance} />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={deletingMemoryId === entry.id}
                            onClick={() => handleDeleteMemory(entry.id)}
                            className="size-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60 hover:text-red-500 rounded-lg mt-0.5"
                          >
                            {deletingMemoryId === entry.id
                              ? <Loader2Icon className="size-3.5 animate-spin" />
                              : <Trash2Icon className="size-3.5" />
                            }
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Past Sessions */}
              <div>
                <SectionHeader
                  title="Past Sessions"
                  action={
                    sessions.length > 0 ? (
                      <Button variant="outline" size="sm" onClick={() => setClearConfirm("sessions")} className="h-7 text-xs text-destructive border-destructive/30 hover:text-red-500 hover:bg-destructive/10 rounded-full">
                        <Trash2Icon className="size-3 mr-1" />
                        Clear All
                      </Button>
                    ) : undefined
                  }
                />
                <p className="text-xs text-muted-foreground -mt-2 mb-4 shrink-0">
                  Your conversation history, stored locally. Qube uses these for long-term context.
                </p>

                <div className="rounded-xl border border-border/60 bg-muted/10">
                  {loadingSessions ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2Icon className="size-5 animate-spin text-muted-foreground/40" />
                    </div>
                  ) : sessions.length === 0 ? (
                    <EmptyState
                      icon={CalendarIcon}
                      title="No sessions recorded"
                      description="Start a conversation and it will be saved here for reference."
                    />
                  ) : (
                    <div className="divide-y divide-border/50">
                      {sessions.map((session) => {
                        const date = new Date(session.updatedAt);
                        const isToday = date.toDateString() === new Date().toDateString();
                        const dateStr = isToday
                          ? `Today at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                          : date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

                        return (
                          <div
                            key={session.id}
                            className="group flex items-start gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors"
                          >
                            <div className="flex-1 min-w-0 space-y-1">
                              <h4 className="text-sm font-semibold text-foreground truncate">
                                {session.title || "Untitled Conversation"}
                              </h4>
                              {session.summary && (
                                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                                  {session.summary}
                                </p>
                              )}
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 font-medium pt-0.5">
                                <CalendarIcon className="size-3" />
                                {dateStr}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={deletingSessionId === session.id}
                              onClick={() => handleDeleteSession(session.id)}
                              className="size-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60 hover:text-red-500 rounded-lg mt-0.5"
                            >
                              {deletingSessionId === session.id
                                ? <Loader2Icon className="size-3.5 animate-spin" />
                                : <Trash2Icon className="size-3.5" />
                              }
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            </motion.div>
          </TabsContent>

          {/* Advanced Tab */}
          <TabsContent value="advanced" className="flex-1 flex flex-col overflow-hidden p-6 mt-0 data-[state=inactive]:hidden">
            <motion.div
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              <div className="flex-1 overflow-y-auto space-y-8 pr-1">
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

                  <div className="flex flex-wrap gap-4 pt-2">
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
                          className="flex flex-col items-center justify-center size-20 rounded-3xl border border-border bg-muted/20 hover:bg-muted/40 cursor-pointer transition-all hover:scale-105 active:scale-95 shadow-xs text-center p-2 gap-1 group relative"
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
                    {providers.filter((p) => p.enabled).length === 0 && (
                      <div className="w-full py-8 text-center text-xs text-muted-foreground/60 border border-dashed border-border/80 rounded-2xl bg-muted/5 flex flex-col items-center justify-center gap-2">
                        <Settings2Icon className="size-5 text-muted-foreground/40" />
                        No active providers configured. Click "Add Provider" to get started.
                      </div>
                    )}
                  </div>
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
                    <div className="border-t border-border/40 pt-6 space-y-4">
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
                                className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/10 hover:bg-muted/20 transition-all gap-3"
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
                                <button
                                  onClick={() => handleDeactivateModel(m.id)}
                                  type="button"
                                  className="size-7 flex items-center justify-center rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors shrink-0 cursor-pointer"
                                  title="Deactivate model"
                                >
                                  <Trash2Icon className="size-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

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

                {/* Computer Use Section — hidden when model lacks image support */}
                {(() => {
                  const curModel = typeof window !== "undefined" ? localStorage.getItem("qube-default-model") || "" : "";
                  if (!curModel) return null;
                  const stored = typeof window !== "undefined" ? localStorage.getItem("qube-providers") : null;
                  let imageSupported = false;
                  if (stored) {
                    try {
                      const providers = JSON.parse(stored) as ProviderConfig[];
                      for (const p of providers) {
                        const m = p.models.find(m => m.id === curModel);
                        if (m?.imageInput) { imageSupported = true; break; }
                      }
                    } catch {}
                  }
                  if (!imageSupported) return null;
                  return (
                    <div className="border-t border-border/40 pt-6 space-y-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold text-foreground">Computer Use</h3>
                          <p className="text-xs text-muted-foreground">
                            Let the agent control your keyboard and mouse to interact with applications.
                          </p>
                        </div>
                        <SwitchToggle
                          checked={computerUseEnabled}
                          onCheckedChange={(v) => {
                            setComputerUseEnabled(v);
                            localStorage.setItem("qube-computer-use-enabled", String(v));
                            fetch("/api/computer/settings", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ settings: { enabled: v } }),
                            }).catch(() => {});
                          }}
                        />
                      </div>
                    </div>
                  );
                })()}

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
                      <SwitchToggle checked={runOnStart} onCheckedChange={setRunOnStart} />
                    </div>
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="space-y-0.5">
                        <span className="text-sm font-medium text-foreground">Keep server running</span>
                        <p className="text-xs text-muted-foreground">Maintain the background server for scheduled tasks and heartbeat monitoring.</p>
                      </div>
                      <SwitchToggle checked={keepAlive} onCheckedChange={setKeepAlive} />
                    </div>
                  </div>
                  <div className="flex justify-end pt-2">
                    <Button
                      onClick={() => {
                        localStorage.setItem("qube-run-on-start", String(runOnStart));
                        localStorage.setItem("qube-keep-alive", String(keepAlive));
                        saveSettingsToServer();
                        setSavedAdvanced(true);
                        setTimeout(() => setSavedAdvanced(false), 2000);
                      }}
                      className={cn("font-semibold px-5 rounded-full transition-all", savedAdvanced && "bg-emerald-600 hover:bg-emerald-700")}
                    >
                      {savedAdvanced ? <CheckIcon className="size-4" /> : "Save"}
                    </Button>
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
              <Button variant="outline" className="rounded-full">Cancel</Button>
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

      <Dialog open={addProviderOpen} onOpenChange={setAddProviderOpen}>
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

            <div className="grid grid-cols-4 gap-3 max-h-[300px] overflow-y-auto pr-1 py-1">
              {providers
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
                      className="flex flex-col items-center justify-center size-20 rounded-3xl border border-border bg-background hover:bg-muted/40 cursor-pointer transition-all hover:scale-105 active:scale-95 text-center p-2 gap-1 group"
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

      <Dialog open={configureProvider !== null} onOpenChange={(v) => { if (!v) setConfigureProvider(null); }}>
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

            {configError && (
              <div className="text-xs text-red-500 bg-red-500/10 rounded-xl px-3 py-2 border border-red-500/20">
                {configError}
              </div>
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
        <DialogContent className="sm:max-w-xl rounded-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{manageProvider?.name} Settings</DialogTitle>
            <DialogDescription>
              Manage models for this provider. You can have a max of 5 models toggled in total.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between pb-2 border-b border-border/40">
              <span className="text-sm font-semibold text-foreground">Models</span>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleRefreshModels}
                  variant="outline"
                  className="rounded-full h-7 w-7 p-0 flex items-center justify-center"
                  size="sm"
                  disabled={refreshingModels || refreshedModels}
                >
                  <RefreshCwIcon className={`size-3 ${refreshingModels ? "animate-spin" : ""}`} />
                </Button>
                <Button
                  onClick={() => {
                    setCustomModelName("");
                    setCustomModelCode("");
                    setAddCustomModelOpen(true);
                  }}
                  variant="outline"
                  className="rounded-full font-semibold px-3 h-7 text-xs flex items-center gap-1"
                  size="sm"
                >
                  <PlusIcon className="size-3" />
                  Add Custom Model
                </Button>
              </div>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {manageModels.map((m) => {
                const provId = manageProvider?.id || "";
                const iconName = m.icon || detectModelIcon(m.id, provId);
                const isCustomModel = !manageProvider?.models.some((orig) => orig.id === m.id);

                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between p-3.5 rounded-xl border border-border bg-muted/10 hover:bg-muted/20 transition-all gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        onClick={() => setBrowseIconModelId(m.id)}
                        type="button"
                        className="size-8 flex items-center justify-center rounded-xl bg-background border border-border/80 hover:bg-muted transition-colors shrink-0 cursor-pointer"
                        title="Browse icon"
                      >
                        {renderLobeIcon(iconName, 18)}
                      </button>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate text-foreground">{m.name}</p>
                        <p className="text-xs font-mono text-muted-foreground truncate">{m.id}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      {isCustomModel && (
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

          <DialogFooter className="pt-2 flex items-center justify-between">
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

              <div className="grid grid-cols-5 gap-3 py-4 max-h-[350px] overflow-y-auto pr-1">
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
                    className="flex flex-col items-center justify-center size-14 rounded-2xl border border-border bg-background hover:bg-muted/40 cursor-pointer transition-all hover:scale-105 active:scale-95 text-center p-2 gap-1 group"
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
