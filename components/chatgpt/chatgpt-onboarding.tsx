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
import { Loader2Icon, CheckIcon } from "lucide-react";
import type { ProviderConfig } from "@/components/shared/settings-dialog";
import { detectModelIcon, renderLobeIcon } from "@/lib/provider-icons";
import { detectModelImageSupport } from "@/lib/agent/vision-support";
import { detectModelThinkingSupport } from "@/lib/agent/thinking-support";
import { motion, AnimatePresence } from "motion/react";

const CHATGPT_PROVIDER_ID = "chatgpt";

export function ChatGPTOnboardingSection({
  onProvidersChanged,
}: {
  onProvidersChanged?: () => void;
}) {
  const chatgpt = useLoginWithChatGPT();
  const [syncing, setSyncing] = useState(false);
  const [codeDialogOpen, setCodeDialogOpen] = useState(false);

  // When authenticated, sync ChatGPT provider into localStorage
  useEffect(() => {
    if (chatgpt.status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      setSyncing(true);
      try {
        const res = await fetch("/api/chatgpt/models", { credentials: "same-origin" });
        if (!res.ok) throw new Error("models fetch failed");
        const data = await res.json();
        const models: string[] = Array.isArray(data.models) ? data.models : [];
        if (models.length === 0) return;
        if (cancelled) return;

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
        } catch { providers = []; }

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
          providers = providers.map((p) =>
            p.id === CHATGPT_PROVIDER_ID ? { ...p, enabled: true, models: merged } : p
          );
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
        onProvidersChanged?.();
      } catch (e) {
        console.error("[ChatGPT onboarding] sync failed", e);
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatgpt.status, onProvidersChanged]);

  // When unauthenticated/expired, disable provider
  useEffect(() => {
    if (chatgpt.status !== "unauthenticated" && chatgpt.status !== "expired") return;
    const raw = localStorage.getItem("qube-providers");
    if (!raw) return;
    try {
      const providers: ProviderConfig[] = JSON.parse(raw);
      const has = providers.some((p) => p.id === CHATGPT_PROVIDER_ID && p.enabled);
      if (!has) return;
      const updated = providers.map((p) =>
        p.id === CHATGPT_PROVIDER_ID ? { ...p, enabled: false, models: [] } : p
      );
      localStorage.setItem("qube-providers", JSON.stringify(updated));
      const def = localStorage.getItem("qube-default-model");
      if (def && def.startsWith("chatgpt:")) localStorage.removeItem("qube-default-model");
      fetch("/api/providers/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers: updated, defaultModelId: localStorage.getItem("qube-default-model") || null }),
      }).catch(() => {});
      window.dispatchEvent(new Event("qube-providers-changed"));
      onProvidersChanged?.();
    } catch {}
  }, [chatgpt.status, onProvidersChanged]);

  // Open code dialog when pending/connecting and we have a code
  useEffect(() => {
    if (chatgpt.status === "pending" && chatgpt.userCode) {
      setCodeDialogOpen(true);
    } else if (chatgpt.status === "authenticated" || chatgpt.status === "unauthenticated") {
      setCodeDialogOpen(false);
    }
  }, [chatgpt.status, chatgpt.userCode]);

  const isAuthenticated = chatgpt.status === "authenticated";
  const isLoading = chatgpt.status === "loading";

  if (isLoading) {
    return (
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className="rounded-[30px] border border-border bg-muted/5 min-h-[56px] p-3 w-full flex items-center justify-center mx-auto"
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Checking ChatGPT session…
        </div>
      </motion.div>
    );
  }

  // Authenticated: same compressed badge layout as provider on top — no disconnect, tick on the right
  if (isAuthenticated) {
    return (
      <>
        <motion.div
          layout
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="rounded-[30px] border border-border/60 bg-background/60 px-3 py-2 w-fit mx-auto flex items-center justify-center overflow-hidden"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key="badge"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-2.5"
            >
              <div className="size-9 flex items-center justify-center shrink-0">
                {renderLobeIcon("OpenAI", 22)}
              </div>
              <div className="min-w-0 text-left flex-1">
                <p className="text-xs font-semibold text-foreground truncate">ChatGPT</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {chatgpt.user?.email || (chatgpt.user?.plan ? `${chatgpt.user.plan} plan` : "Connected")}
                </p>
              </div>
              <CheckIcon className="size-4 text-emerald-500 shrink-0" />
            </motion.div>
          </AnimatePresence>
        </motion.div>

        {chatgpt.error && (
          <p className="text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20 mx-auto mt-2 max-w-md text-center">
            {chatgpt.error}
          </p>
        )}
      </>
    );
  }

  // Unauthenticated / pending trigger: same dimensions as compressed "Configure Provider" row
  return (
    <>
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className="rounded-[30px] border border-border bg-muted/5 min-h-[56px] p-3 w-full flex items-center justify-center overflow-hidden mx-auto"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center justify-between gap-4 w-full"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="size-9 flex items-center justify-center shrink-0">
                {renderLobeIcon("OpenAI", 22)}
              </div>
              <div className="space-y-0.5 text-left min-w-0">
                <h4 className="text-xs font-semibold text-foreground">Login with ChatGPT</h4>
                <p className="text-[11px] text-muted-foreground">Use your ChatGPT subscription</p>
              </div>
            </div>
            <Button
              onClick={() => chatgpt.login()}
              disabled={chatgpt.isConnecting || chatgpt.status === "pending"}
              className="rounded-full font-semibold px-5 h-9 flex items-center gap-1.5 shrink-0"
              size="sm"
            >
              {chatgpt.isConnecting || chatgpt.status === "pending" ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : null}
              {chatgpt.isConnecting || chatgpt.status === "pending" ? "Connecting…" : "Connect"}
            </Button>
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {chatgpt.error && chatgpt.status !== "pending" && (
        <p className="text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20 mx-auto mt-2 max-w-md text-center">
          {chatgpt.error}
        </p>
      )}

      {/* Code popup with same style as other app dialogs */}
      <Dialog open={codeDialogOpen} onOpenChange={setCodeDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Connect ChatGPT</DialogTitle>
            <DialogDescription>Enter this code in the opened browser tab to authorize Qube.</DialogDescription>
          </DialogHeader>

          <div className="py-4 flex flex-col items-center gap-4">
            <div className="group relative flex justify-center items-center w-full">
              <code className="text-3xl font-mono font-bold tracking-[0.2em] select-all text-center">{chatgpt.userCode || "— — — —"}</code>
            </div>
            {chatgpt.verificationUrl && (
              <a
                href={chatgpt.verificationUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline font-medium"
              >
                Open verification page ↗
              </a>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCodeDialogOpen(false)}
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
