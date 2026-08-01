"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  PlusIcon,
  SearchIcon,
  Loader2Icon,
  PencilIcon,
  UnplugIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Highlighter } from "@/components/ui/highlighter";
import { MorphingText } from "@/components/ui/morphing-text";
import {
  DEFAULT_PROVIDERS,
  type ProviderConfig,
  renderLobeIcon,
  detectModelIcon,
} from "./settings-dialog";
import { renderConnectorIcon } from "@/lib/connectors/icons";

const KNOWN_ICON_IDS = new Set([
  "linear","atlassian","trello","airtable","notion",
  "slack","github","google","hubspot","asana","dropbox",
]);

function getInstanceId(): string {
  if (typeof window === "undefined") return "qube-default-user";
  return localStorage.getItem("qube-instance-id") || "qube-default-user";
}

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

interface FetchedModel {
  id: string;
  imageInput: boolean;
  reasoning: boolean;
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
    throw new Error(`Failed to fetch models: ${res.status} ${res.statusText}`);
  }

  const body = await res.json();
  if (body?.data && Array.isArray(body.data)) {
    const seen = new Set<string>();
    const models: FetchedModel[] = [];
    for (const m of body.data) {
      if (m.object === "model" || !m.object) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        models.push({
          id: m.id,
          imageInput: false,
          reasoning: false,
        });
      }
    }
    return models;
  }
  throw new Error("Unexpected model list format");
}

export function OnboardingModal() {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<1 | 2 | 3 | 4>(1);

  // Profile preferences
  const [userName, setUserName] = useState("");
  const [userAbout, setUserAbout] = useState("");

  // Providers & models state
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [defaultModel, setDefaultModel] = useState("");

  // Sub-dialogs in Stage 2
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [configureProvider, setConfigureProvider] = useState<ProviderConfig | null>(null);
  const [configApiKey, setConfigApiKey] = useState("");
  const [configBaseUrl, setConfigBaseUrl] = useState("");
  const [configHasApiKey, setConfigHasApiKey] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [savingConfigure, setSavingConfigure] = useState(false);

  // Model selection popup after provider configured
  const [selectModelOpen, setSelectModelOpen] = useState(false);
  const [newlyConfiguredProv, setNewlyConfiguredProv] = useState<ProviderConfig | null>(null);

  // Stage 4 confirmation animation
  const [confirmed, setConfirmed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [expandedWidth, setExpandedWidth] = useState(0);
  const continueTextRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (continueTextRef.current) {
      setExpandedWidth(continueTextRef.current.offsetWidth);
    }
  }, [open]);

  useEffect(() => {
    if (stage === 4) {
      const t = setTimeout(() => setConfirmed(true), 600);
      return () => clearTimeout(t);
    }
    setConfirmed(false);
    setFinished(false);
  }, [stage]);

  // Connectors state for Stage 3
  const [connectors, setConnectors] = useState<any[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectorQuery, setConnectorQuery] = useState("");
  const [disconnectTarget, setDisconnectTarget] = useState<any | null>(null);

  const fetchConnectors = useCallback(async () => {
    setConnectorsLoading(true);
    try {
      const res = await fetch(`/api/connectors/list?instanceId=${getInstanceId()}`);
      const data = await res.json();
      setConnectors(data.connectors || []);
    } catch {}
    setConnectorsLoading(false);
  }, []);

  useEffect(() => {
    if (open && stage === 3) fetchConnectors();
  }, [open, stage, fetchConnectors]);

  useEffect(() => {
    if (!connectingId) return;
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/connectors/list?instanceId=${getInstanceId()}`);
        const data = await res.json();
        const updated = (data.connectors || []) as any[];
        const match = updated.find((c: any) => c.id === connectingId);
        if (match?.connected) {
          setConnectors(updated);
          setConnectingId(null);
          clearInterval(pollInterval);
        }
      } catch {}
    }, 2000);
    const timeout = setTimeout(() => { clearInterval(pollInterval); setConnectingId(null); }, 120_000);
    return () => { clearInterval(pollInterval); clearTimeout(timeout); };
  }, [connectingId]);

  // First time auto-trigger check
  useEffect(() => {
    if (typeof window === "undefined") return;

    const completed = localStorage.getItem("qube-onboarding-completed");
    if (completed !== "true") {
      setOpen(true);
    }

    const handleReopen = () => {
      setStage(1);
      setOpen(true);
    };

    window.addEventListener("qube-open-onboarding", handleReopen);
    return () => window.removeEventListener("qube-open-onboarding", handleReopen);
  }, []);

  // Load existing values into state when opening
  useEffect(() => {
    if (!open) return;

    const name = localStorage.getItem("qube-user-name") || "";
    const about = localStorage.getItem("qube-user-about") || "";
    const defM = localStorage.getItem("qube-default-model") || "";
    const stored = localStorage.getItem("qube-providers");

    setUserName(name);
    setUserAbout(about);
    setDefaultModel(defM);

    if (stored) {
      try {
        setProviders(JSON.parse(stored));
      } catch {
        setProviders(DEFAULT_PROVIDERS);
      }
    } else {
      setProviders(DEFAULT_PROVIDERS);
    }
  }, [open]);

  const saveProvidersList = (updated: ProviderConfig[]) => {
    setProviders(updated);
    localStorage.setItem("qube-providers", JSON.stringify(updated));
    fetch("/api/providers/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers: updated, defaultModelId: defaultModel }),
    }).catch(() => {});
    window.dispatchEvent(new Event("qube-providers-changed"));
  };

  const handleSaveProfile = () => {
    localStorage.setItem("qube-user-name", userName);
    localStorage.setItem("qube-user-about", userAbout);
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { userName, userAbout },
      }),
    }).catch(() => {});
  };

  const handleConfigureProvider = async () => {
    if (!configureProvider) return;
    setConfigError(null);
    setSavingConfigure(true);

    try {
      const fetchedModels = await fetchProviderModels(configBaseUrl || "", configApiKey || "");
      const provId = configureProvider.id;
      const autoDetectIcons = ["custom", "ollama", "lmstudio", "openrouter"];
      const providerIcon = PROVIDER_ID_TO_ICON[provId] || provId.charAt(0).toUpperCase() + provId.slice(1);

      const qualifiedModels = fetchedModels.map((model, idx) => ({
        id: `${provId}:${model.id}`,
        name: model.id,
        // Enable first model by default if none active
        enabled: idx === 0,
        icon: autoDetectIcons.includes(provId) ? detectModelIcon(model.id, provId) : providerIcon,
        imageInput: model.imageInput,
        reasoning: model.reasoning,
      }));

      const targetProv: ProviderConfig = {
        ...configureProvider,
        enabled: true,
        apiKey: configApiKey,
        baseURL: configBaseUrl,
        hasApiKey: configHasApiKey,
        models: qualifiedModels,
      };

      const updated = providers.map((p) => (p.id === configureProvider.id ? targetProv : p));
      saveProvidersList(updated);

      if (qualifiedModels.length > 0 && !defaultModel) {
        setDefaultModel(qualifiedModels[0].id);
        localStorage.setItem("qube-default-model", qualifiedModels[0].id);
      }

      setSavingConfigure(false);
      setConfigureProvider(null);
      setAddProviderOpen(false);

      // Show available models popup for user selection
      setNewlyConfiguredProv(targetProv);
      setSelectModelOpen(true);
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "Failed to validate provider credentials");
      setSavingConfigure(false);
    }
  };

  const handleSelectDefaultModel = (modelId: string) => {
    setDefaultModel(modelId);
    localStorage.setItem("qube-default-model", modelId);

    // Make sure model is enabled in provider config
    if (newlyConfiguredProv) {
      const updated = providers.map((p) => {
        if (p.id === newlyConfiguredProv.id) {
          return {
            ...p,
            models: p.models.map((m) => (m.id === modelId ? { ...m, enabled: true } : m)),
          };
        }
        return p;
      });
      saveProvidersList(updated);
    }
    setSelectModelOpen(false);
  };

  const handleFinishOnboarding = () => {
    handleSaveProfile();
    localStorage.setItem("qube-onboarding-completed", "true");
    setOpen(false);
  };

  const handleNext = () => {
    if (stage < 4) {
      setStage((prev) => (prev + 1) as any);
    } else {
      setFinished(true);
      setTimeout(() => handleFinishOnboarding(), 600);
    }
  };

  const handleBack = () => {
    if (stage === 4 && confirmed) {
      setConfirmed(false);
      setFinished(false);
      setTimeout(() => setStage(3), 450);
    } else if (stage > 1) {
      setStage((prev) => (prev - 1) as any);
    }
  };

  const handleConnect = async (connectorId: string) => {
    setConnectingId(connectorId);
    try {
      const res = await fetch(`/api/connectors/link?instanceId=${getInstanceId()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId }),
      });
      const data = await res.json();
      if (data.redirectUrl) {
        try {
          const { open } = await import("@tauri-apps/plugin-shell");
          await open(data.redirectUrl);
        } catch {
          window.open(data.redirectUrl, "_blank", "noopener,noreferrer");
        }
      } else {
        setConnectingId(null);
        fetchConnectors();
      }
    } catch {
      setConnectingId(null);
    }
  };

  const handleDisconnect = async (connectorId: string) => {
    setDisconnectTarget(null);
    setConnectingId(connectorId);
    try {
      await fetch(`/api/connectors/disconnect?instanceId=${getInstanceId()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId }),
      });
      await fetchConnectors();
    } catch {}
    setConnectingId(null);
  };
  const activeProviders = providers.filter((p) => p.enabled && p.models.length > 0);
  const activeModelsList = activeProviders.flatMap((p) =>
    p.models.map((m) => ({ ...m, providerName: p.name, providerId: p.id }))
  );
  const configuredProvider = activeProviders[0] || null;
  const selectedModel = activeModelsList.find((m) => m.id === defaultModel);
  const stage2Ready = !!configuredProvider && !!defaultModel;

  // Show the model badge only once the model-selection popup has closed,
  // so the compress-into-badge animation is visible (not hidden by the popup).
  const [badgeVisible, setBadgeVisible] = useState(false);

  useEffect(() => {
    if (selectModelOpen) {
      setBadgeVisible(false);
      return;
    }
    if (configuredProvider && selectedModel) {
      const t = setTimeout(() => setBadgeVisible(true), 250);
      return () => clearTimeout(t);
    }
    setBadgeVisible(false);
  }, [selectModelOpen, configuredProvider, selectedModel]);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => {
        if (!v && (addProviderOpen || configureProvider !== null || selectModelOpen)) return;
        setOpen(v);
      }}>
        <DialogContent
          showCloseButton={false}
          onInteractOutside={(e) => e.preventDefault()}
          className="sm:max-w-4xl max-w-4xl w-full p-0 flex flex-col rounded-3xl border border-border bg-background shadow-2xl overflow-hidden"
          style={{ height: "min(620px, 90vh)" }}
        >
          <div className="grid grid-cols-1 md:grid-cols-12 h-full w-full overflow-hidden relative">
            {/* Left Section */}
            <div className="md:col-span-12 p-6 md:p-8 flex flex-col min-h-0">
              <AnimatePresence mode="wait">
                <motion.div
                  key={stage}
                  initial={{ opacity: 0, filter: "blur(4px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, filter: "blur(4px)" }}
                  transition={{ duration: 0.2 }}
                  className={`relative flex-1 overflow-y-auto min-h-0 flex flex-col ${stage !== 4 ? "md:pr-[18rem]" : ""}`}
                >
                  {stage === 1 && (
                    <div className="flex flex-col h-full">
                      <div className="space-y-4">
                        <h2 className="text-2xl font-bold tracking-tight text-foreground">
                          Qube welcomes you
                        </h2>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          Qube is your{" "}
                          <Highlighter action="highlight" color="#f59e0b80">
                            personal AI worker
                          </Highlighter>{" "}
                          — a helper that lives on your computer, ready to get things done for
                          you. You don't need to be technical or know anything about AI to use
                          it. You just describe what you need, and Qube figures out how to make
                          it happen.
                        </p>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          Your worker understands the context of what you're working on, connects
                          to the tools you already use like{" "}
                          <Highlighter action="underline" color="#10b981">
                            your calendar, email, and messaging
                          </Highlighter>
                          , and then works alongside you — organizing, summarizing, and taking
                          tasks off your plate so you can focus on what actually matters.
                        </p>
                      </div>
                    </div>
                  )}

                  {stage === 2 && (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <h2 className="text-2xl font-bold tracking-tight text-foreground">
                          Your worker's brain
                        </h2>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          Your AI worker thinks with a brain made of an AI provider and a model.
                          The provider is the service that powers it — like{" "}
                          <Highlighter action="circle" color="#8b5cf680">
                            OpenAI
                          </Highlighter>{" "}
                          or a local model running on your machine. The model is the specific
                          brain inside it that understands and answers you.
                        </p>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          Don't worry about the details — just{" "}
                          <Highlighter action="underline" color="#10b981">
                            click the button below
                          </Highlighter>
                          , pick a provider you already have, and choose a model. We'll handle
                          the rest.
                        </p>
                      </div>

                      <motion.div
                        layout
                        transition={{ type: "spring", stiffness: 260, damping: 20 }}
                        className={`rounded-2xl border flex items-center justify-center overflow-hidden transition-colors duration-300 mx-auto mt-8 ${
                          badgeVisible
                            ? "border-border/60 bg-background/60 px-3 py-2 w-fit"
                            : "border-border bg-muted/5 min-h-[56px] p-3 w-full"
                        }`}
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          {badgeVisible && configuredProvider && selectedModel ? (
                            <motion.div
                              key="badge"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.15 }}
                              className="flex items-center gap-2.5"
                            >
                              <div className="size-9 flex items-center justify-center shrink-0">
                                {renderLobeIcon(
                                  selectedModel.icon ||
                                    PROVIDER_ID_TO_ICON[selectedModel.providerId] ||
                                    selectedModel.providerName,
                                  22
                                )}
                              </div>
                              <div className="min-w-0 text-left flex-1">
                                <p className="text-xs font-semibold text-foreground truncate">
                                  {selectedModel.name}
                                </p>
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {selectedModel.providerName}
                                </p>
                              </div>
                              <CheckIcon className="size-4 text-emerald-500 shrink-0" />
                              <button
                                onClick={() => {
                                  setSearchQuery("");
                                  setAddProviderOpen(true);
                                }}
                                className="flex items-center justify-center size-7 rounded-full text-foreground/50 hover:bg-muted/40 hover:text-foreground transition-colors shrink-0 cursor-pointer"
                                title="Edit Provider"
                              >
                                <PencilIcon className="size-3.5" />
                              </button>
                            </motion.div>
                          ) : (
                            <motion.div
                              key="button"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.15 }}
                              className="flex items-center justify-between gap-4 w-full"
                            >
                              <div className="space-y-0.5 text-left min-w-0">
                                <h4 className="text-xs font-semibold text-foreground">
                                  Configure Provider
                                </h4>
                                <p className="text-[11px] text-muted-foreground">
                                  Pick a provider and choose a model
                                </p>
                              </div>
                              <Button
                                onClick={() => {
                                  setSearchQuery("");
                                  setAddProviderOpen(true);
                                }}
                                className="rounded-full font-semibold px-5 h-9 flex items-center gap-1.5 shrink-0"
                                size="sm"
                              >
                                <PlusIcon className="size-4" />
                                Configure
                              </Button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    </div>
                  )}

                  {stage === 3 && (
                    <div className="flex flex-col min-h-0">
                      <div className="space-y-2">
                        <h2 className="text-2xl font-bold tracking-tight text-foreground">
                          <MorphingText
                            texts={["Your tools", "Qube's tools"]}
                            morphTime={3.5}
                            cooldownTime={1.5}
                            className="h-8 text-2xl leading-8 font-bold tracking-tight text-foreground text-left max-w-none mx-0 md:h-8 lg:text-2xl"
                          />
                        </h2>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          These are the{" "}
                          <Highlighter action="box" color="#3b82f680">
                            tools your AI worker can use
                          </Highlighter>
                          . Connect the ones you already use and Qube will tap into them when it
                          works for you.
                        </p>
                      </div>
                      <div className="flex flex-col flex-1 min-h-0 pt-8">
                        {connectorsLoading ? (
                          <Loader2Icon className="size-8 animate-spin text-muted-foreground mx-auto mt-8" />
                        ) : (
                          <>
                            <div className="relative mb-4 max-w-md mx-auto w-full px-8 shrink-0">
                              <SearchIcon className="absolute left-10 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50 pointer-events-none" />
                              <input
                                value={connectorQuery}
                                onChange={(e) => setConnectorQuery(e.target.value)}
                                placeholder="Search tools..."
                                className="w-full h-8 rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-ring transition-colors placeholder:text-muted-foreground/40"
                              />
                            </div>
                            <div className="flex-1 min-h-0 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                              <div className="grid grid-cols-5 gap-2 w-full max-w-md mx-auto px-8 pb-2">
                                {connectors
                                  .filter((c: any) => c.name.toLowerCase().includes(connectorQuery.trim().toLowerCase()))
                                  .map((connector: any) => {
                                    const isConnecting = connectingId === connector.id;
                                    return (
                                      <button
                                        key={connector.id}
                                        onClick={() => {
                                          if (isConnecting) return;
                                          if (connector.connected) {
                                            setDisconnectTarget(connector);
                                          } else {
                                            handleConnect(connector.id);
                                          }
                                        }}
                                        className={`p-0.5 rounded-xl border transition-all aspect-square flex items-center justify-center ${
                                          connector.connected
                                            ? "border-emerald-500/40 hover:border-red-500/50"
                                            : "border-border/50 bg-background/80 backdrop-blur-sm shadow-md hover:border-primary/40 hover:shadow-lg"
                                        } ${isConnecting ? "opacity-60 pointer-events-none" : "cursor-pointer hover:scale-105 active:scale-95"}`}
                                      >
                                        {isConnecting ? (
                                          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                                        ) : (
                                          <div className="size-8 rounded-lg bg-muted/20 flex items-center justify-center">
                                            {KNOWN_ICON_IDS.has(connector.id)
                                              ? renderConnectorIcon(connector.id, 22)
                                              : connector.hasIcon && connector.icon
                                                ? <img src={connector.icon} alt="" className="size-6 object-contain" />
                                                : <span className="text-lg font-bold text-foreground/80">{connector.name?.charAt(0).toUpperCase()}</span>}
                                          </div>
                                        )}
                                      </button>
                                    );
                                  })}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {stage === 4 && (
                    <div className="flex flex-col items-center justify-center h-full space-y-4">
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 200, damping: 15 }}
                        className="size-20 rounded-full bg-emerald-500/15 flex items-center justify-center"
                      >
                        <CheckIcon className="size-10 text-emerald-500" />
                      </motion.div>
                      <div className="text-center space-y-1">
                        <h2 className="text-2xl font-bold tracking-tight text-foreground">
                          Qube is ready
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          Your AI worker is set up and ready to get to work.
                        </p>
                      </div>
                    </div>
                  )}

                  {stage !== 4 && (
                    <div className="absolute top-0 right-0 bottom-0 w-60 rounded-[calc(1.5rem-0.75rem)] border-2 border-border/40 bg-muted/10 overflow-hidden flex items-center justify-center pointer-events-none">
                      <img
                        src={
                          stage === 1
                            ? "/onboarding-hero.png"
                            : stage === 2
                              ? "/onboarding-create.png"
                              : "/onboarding-tools.png"
                        }
                        alt=""
                        className="w-full h-full object-contain p-3"
                      />
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Bottom bar: indicator left, buttons right */}
              <div className="flex items-center justify-between pt-6 shrink-0">
                <div className="flex items-center gap-1.5">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={`size-2 rounded-full transition-all duration-300 ${
                        stage === i ? "w-5 bg-primary" : "bg-muted-foreground/30"
                      }`}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-1 rounded-full border border-border/60 bg-background/60 backdrop-blur-sm px-1.5 py-1.5">
                  <button
                    onClick={handleBack}
                    disabled={stage === 1}
                    type="button"
                    className="flex items-center justify-center size-7 rounded-full text-foreground/70 hover:bg-muted/40 transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                    title="Go Back"
                  >
                    <ChevronLeftIcon className="size-4" />
                  </button>
                  <motion.button
                    onClick={handleNext}
                    disabled={stage === 2 && !stage2Ready}
                    type="button"
                    animate={{ width: finished ? 28 : stage === 4 && confirmed ? expandedWidth || 76 : 28 }}
                    transition={{ type: "spring", stiffness: 260, damping: 26 }}
                    className="relative flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-30 disabled:pointer-events-none overflow-hidden"
                    title={stage === 4 ? "Complete Setup" : "Next"}
                  >
                    <motion.span
                      animate={{ opacity: finished ? 0 : stage === 4 && confirmed ? 0 : 1 }}
                      transition={{ duration: 0.12 }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <ChevronRightIcon className="size-4" />
                    </motion.span>
                    <motion.span
                      ref={continueTextRef}
                      animate={{ opacity: finished ? 0 : stage === 4 && confirmed ? 1 : 0 }}
                      transition={{ duration: 0.12 }}
                      className="flex items-center justify-center px-3 h-7 text-xs font-semibold whitespace-nowrap shrink-0"
                    >
                      Continue
                    </motion.span>
                    <motion.span
                      animate={{ opacity: finished ? 1 : 0, scale: finished ? 1 : 0.7 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20 }}
                      className="absolute inset-0 flex items-center justify-center rounded-full bg-emerald-500 text-white"
                    >
                      <CheckIcon className="size-4" />
                    </motion.span>
                  </motion.button>
                </div>
              </div>
            </div>
          </div>

      {/* Sub-Dialog 1: Add Provider Selection Modal */}
      <Dialog open={addProviderOpen} onOpenChange={(v) => {
        if (!v && configureProvider !== null) return;
        setAddProviderOpen(v);
      }}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Add AI Provider</DialogTitle>
            <DialogDescription>
              Select an AI provider to configure its API key or endpoint.
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

            <div className="grid grid-cols-4 gap-3 max-h-[280px] overflow-y-auto pr-1 py-1">
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

      {/* Sub-Dialog 2: Configure Provider Credentials */}
      <Dialog open={configureProvider !== null} onOpenChange={(v) => { if (!v) { setConfigureProvider(null); setAddProviderOpen(false); } }}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Configure {configureProvider?.name}</DialogTitle>
            <DialogDescription>
              Enter API Key and Base URL to fetch available models.
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
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">API Key (Optional)</label>
                <input
                  type="password"
                  placeholder="Enter API Key..."
                  value={configApiKey}
                  onChange={(e) => setConfigApiKey(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
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
            <Button
              variant="outline"
              onClick={() => { setConfigureProvider(null); setAddProviderOpen(false); }}
              className="rounded-full h-8 px-4"
              size="sm"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfigureProvider}
              disabled={savingConfigure}
              className="rounded-full font-semibold h-8 px-4"
              size="sm"
            >
              {savingConfigure ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                "Save & Fetch Models"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-Dialog 3: Available Models Popup */}
      <Dialog open={selectModelOpen} onOpenChange={setSelectModelOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Select Default Model</DialogTitle>
            <DialogDescription>
              {newlyConfiguredProv?.name} has been configured! Select a default model to use for conversations.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2 max-h-[300px] overflow-y-auto pr-1">
            {newlyConfiguredProv?.models.map((m) => (
              <div
                key={m.id}
                onClick={() => handleSelectDefaultModel(m.id)}
                className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                  defaultModel === m.id
                    ? "border-emerald-500/60 bg-emerald-500/10"
                    : "border-border hover:bg-muted/30"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground truncate">{m.name}</p>
                  <p className="text-[10px] text-muted-foreground">{newlyConfiguredProv.name}</p>
                </div>
                {defaultModel === m.id && (
                  <CheckIcon className="size-4 text-emerald-500 shrink-0" />
                )}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              onClick={() => setSelectModelOpen(false)}
              className="rounded-full font-semibold h-8 px-4"
              size="sm"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disconnect Confirmation Dialog */}
      <Dialog open={!!disconnectTarget} onOpenChange={(v) => { if (!v) setDisconnectTarget(null); }}>
        <DialogContent className="sm:max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Disconnect {disconnectTarget?.name}</DialogTitle>
            <DialogDescription>
              Are you sure you want to disconnect {disconnectTarget?.name}? The agent will no longer have access to this service.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="rounded-full h-8">Cancel</Button>
            </DialogClose>
            <Button
              variant="outline"
              onClick={() => disconnectTarget && handleDisconnect(disconnectTarget.id)}
              className="rounded-full text-red-500 border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5 px-3 h-8"
            >
              <UnplugIcon className="size-3.5" />
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </DialogContent>
      </Dialog>
    </>
  );
}
