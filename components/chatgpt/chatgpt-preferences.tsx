"use client";

import { useLoginWithChatGPT } from "@opencoredev/loginwithchatgpt-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2Icon } from "lucide-react";
import type { ProviderConfig } from "@/components/shared/settings-dialog";
import { detectModelIcon, renderLobeIcon } from "@/lib/provider-icons";
import { detectModelImageSupport } from "@/lib/agent/vision-support";
import { detectModelThinkingSupport } from "@/lib/agent/thinking-support";

const CHATGPT_PROVIDER_ID = "chatgpt";

export function ChatGPTPreferencesCard() {
  const chatgpt = useLoginWithChatGPT();
  const [syncing, setSyncing] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [provider, setProvider] = useState<ProviderConfig | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshProviderFromStorage = () => {
    try {
      const raw = localStorage.getItem("qube-providers");
      if (!raw) { setProvider(null); return; }
      const providers: ProviderConfig[] = JSON.parse(raw);
      const found = providers.find((p) => p.id === CHATGPT_PROVIDER_ID) || null;
      setProvider(found);
    } catch { setProvider(null); }
  };

  useEffect(() => {
    refreshProviderFromStorage();
    const handler = () => refreshProviderFromStorage();
    window.addEventListener("qube-providers-changed", handler);
    return () => window.removeEventListener("qube-providers-changed", handler);
  }, []);

  const syncFromModels = async (fetchedModels: string[]) => {
    setSyncing(true);
    try {
      const qualifiedModels = fetchedModels.map((mid, idx) => ({
        id: `${CHATGPT_PROVIDER_ID}:${mid}`,
        name: mid,
        enabled: idx === 0,
        icon: detectModelIcon(mid, CHATGPT_PROVIDER_ID),
        imageInput: detectModelImageSupport(mid),
        reasoning: detectModelThinkingSupport(mid),
      }));

      const raw = localStorage.getItem("qube-providers");
      let providers: ProviderConfig[] = [];
      try { providers = raw ? JSON.parse(raw) : []; } catch { providers = []; }

      let existing = providers.find((p) => p.id === CHATGPT_PROVIDER_ID);
      if (!existing) {
        const newProv: ProviderConfig = {
          id: CHATGPT_PROVIDER_ID,
          name: "ChatGPT",
          baseURL: "/api/chatgpt",
          enabled: true,
          hasApiKey: false,
          models: qualifiedModels,
        };
        providers = [...providers, newProv];
      } else {
        const existingMap = new Map(existing.models.map((m) => [m.id, m]));
        const merged = qualifiedModels.map((m) => {
          const prev = existingMap.get(m.id);
          return prev ? { ...m, enabled: prev.enabled } : m;
        });
        if (merged.length > 0 && !merged.some((m) => m.enabled)) merged[0].enabled = true;
        providers = providers.map((p) => (p.id === CHATGPT_PROVIDER_ID ? { ...p, enabled: true, models: merged } : p));
      }

      localStorage.setItem("qube-providers", JSON.stringify(providers));
      const currentDefault = localStorage.getItem("qube-default-model");
      if (!currentDefault) {
        const first = providers.find((p) => p.id === CHATGPT_PROVIDER_ID)?.models.find((m) => m.enabled);
        if (first) localStorage.setItem("qube-default-model", first.id);
      }
      const defaultModelId = localStorage.getItem("qube-default-model") || null;
      fetch("/api/providers/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers, defaultModelId }),
      }).catch(() => {});
      window.dispatchEvent(new Event("qube-providers-changed"));
      refreshProviderFromStorage();
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (chatgpt.status === "authenticated") {
      (async () => {
        try {
          const res = await fetch("/api/chatgpt/models", { credentials: "same-origin" });
          if (!res.ok) return;
          const data = await res.json();
          const list: string[] = Array.isArray(data.models) ? data.models : [];
          setModels(list);
          if (list.length > 0) await syncFromModels(list);
        } catch {}
      })();
    } else if (chatgpt.status === "unauthenticated" || chatgpt.status === "expired") {
      setModels([]);
      // disable provider in storage
      try {
        const raw = localStorage.getItem("qube-providers");
        if (raw) {
          const providers: ProviderConfig[] = JSON.parse(raw);
          const has = providers.some((p) => p.id === CHATGPT_PROVIDER_ID && p.enabled);
          if (has) {
            const updated = providers.map((p) => (p.id === CHATGPT_PROVIDER_ID ? { ...p, enabled: false, models: [] } : p));
            localStorage.setItem("qube-providers", JSON.stringify(updated));
            const def = localStorage.getItem("qube-default-model");
            if (def && def.startsWith("chatgpt:")) localStorage.removeItem("qube-default-model");
            fetch("/api/providers/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ providers: updated, defaultModelId: localStorage.getItem("qube-default-model") || null }),
            }).catch(() => {});
            window.dispatchEvent(new Event("qube-providers-changed"));
            refreshProviderFromStorage();
          }
        }
      } catch {}
    }
  }, [chatgpt.status]);

  const handleRefresh = async () => {
    if (!chatgpt.isAuthenticated) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/chatgpt/models", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        const list: string[] = Array.isArray(data.models) ? data.models : [];
        setModels(list);
        if (list.length > 0) await syncFromModels(list);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const isAuthenticated = chatgpt.status === "authenticated";
  const isLoading = chatgpt.status === "loading";
  const isPending = chatgpt.status === "pending" || chatgpt.status === "connecting";
  const [codeDialogOpen, setCodeDialogOpen] = useState(false);

  useEffect(() => {
    if (chatgpt.status === "pending" && chatgpt.userCode) {
      setCodeDialogOpen(true);
    } else if (chatgpt.status === "authenticated" || chatgpt.status === "unauthenticated") {
      setCodeDialogOpen(false);
    }
  }, [chatgpt.status, chatgpt.userCode]);

  // Minimal UI: external rectangle — radius in axis with inner button (h-9 r18 + p-3 12 = 30)
  if (isLoading) {
    return (
      <div className="rounded-[30px] border border-border bg-muted/5 min-h-[56px] p-3 w-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Checking…
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <>
        <div className="rounded-[30px] border border-border bg-muted/5 min-h-[56px] p-3 w-full flex items-center justify-center overflow-hidden">
          <div className="flex items-center justify-between gap-4 w-full">
            <div className="flex items-center gap-3 min-w-0">
              <div className="size-9 flex items-center justify-center shrink-0">{renderLobeIcon("OpenAI", 22)}</div>
              <div className="space-y-0.5 text-left min-w-0">
                <h4 className="text-xs font-semibold text-foreground">ChatGPT</h4>
                <p className="text-[11px] text-muted-foreground truncate">{chatgpt.user?.email || "Connected"}</p>
              </div>
            </div>
            <Button
              onClick={() => chatgpt.logout()}
              className="rounded-full font-semibold px-5 h-9 flex items-center gap-1.5 shrink-0"
              size="sm"
            >
              Disconnect
            </Button>
          </div>
        </div>
        {chatgpt.error && <p className="text-xs text-red-500 mt-2">{chatgpt.error}</p>}
      </>
    );
  }

  return (
    <>
      <div className="rounded-[30px] border border-border bg-muted/5 min-h-[56px] p-3 w-full flex items-center justify-center overflow-hidden">
        <div className="flex items-center justify-between gap-4 w-full">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-9 flex items-center justify-center shrink-0">{renderLobeIcon("OpenAI", 22)}</div>
            <div className="space-y-0.5 text-left min-w-0">
              <h4 className="text-xs font-semibold text-foreground">Connect your ChatGPT account</h4>
              <p className="text-[11px] text-muted-foreground hidden sm:block">Use your subscription to power Qube</p>
            </div>
          </div>
          <Button
            onClick={() => chatgpt.login()}
            disabled={chatgpt.isConnecting || isPending}
            className="rounded-full font-semibold px-5 h-9 flex items-center gap-1.5 shrink-0"
            size="sm"
          >
            {(chatgpt.isConnecting || isPending) && <Loader2Icon className="size-4 animate-spin" />}
            {isPending ? "Connecting…" : "Connect"}
          </Button>
        </div>
      </div>
      {chatgpt.error && chatgpt.status !== "pending" && (
        <p className="text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20 mt-2 text-center">{chatgpt.error}</p>
      )}

      <Dialog open={codeDialogOpen} onOpenChange={(open) => {
        if (!open && (chatgpt.status === "pending" || (chatgpt as any).status === "connecting")) {
          try { chatgpt.logout(); } catch {}
          try {
            const w = window.open("", "login-with-chatgpt");
            if (w && !w.closed) w.close();
          } catch {}
        }
        setCodeDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Connect ChatGPT</DialogTitle>
            <DialogDescription>Enter this code in the opened browser tab to authorize Qube.</DialogDescription>
          </DialogHeader>
          <div className="py-4 flex flex-col items-center gap-4">
            <div className="group flex items-center gap-2">
              <code className="text-3xl font-mono font-bold tracking-[0.2em] select-all">{chatgpt.userCode || "— — — —"}</code>
            </div>
            {chatgpt.verificationUrl && (
              <a href={chatgpt.verificationUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline font-medium">
                Open verification page ↗
              </a>
            )}
          </div>
          <div className="flex justify-end pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                try { chatgpt.logout(); } catch {}
                try {
                  const w = window.open("", "login-with-chatgpt");
                  if (w && !w.closed) w.close();
                } catch {}
                setCodeDialogOpen(false);
              }}
              className="rounded-full h-8 px-4 text-red-500 border-red-500/30 hover:bg-red-500/10 hover:text-red-600"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
