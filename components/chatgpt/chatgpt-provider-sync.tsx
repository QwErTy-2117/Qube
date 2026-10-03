"use client";

import { useEffect, useCallback } from "react";
import { useLoginWithChatGPT } from "@opencoredev/loginwithchatgpt-react";
import type { ProviderConfig } from "@/components/shared/settings-dialog";
import { detectModelIcon } from "@/lib/provider-icons";
import { detectModelImageSupport } from "@/lib/agent/vision-support";
import { detectModelThinkingSupport } from "@/lib/agent/thinking-support";

const CHATGPT_PROVIDER_ID = "chatgpt";
const CHATGPT_PROVIDER_NAME = "ChatGPT";

export function useChatGPTProviderSync() {
  const chatgpt = useLoginWithChatGPT({
    onAuthenticated: () => {
      // will be handled via effect that watches isAuthenticated
    },
  });

  const syncProvidersWithChatGPT = useCallback(async (isAuthenticated: boolean, user?: any) => {
    // Read current providers from localStorage
    let providers: ProviderConfig[] = [];
    try {
      const raw = localStorage.getItem("qube-providers");
      if (raw) providers = JSON.parse(raw);
    } catch {}

    // If not authenticated, ensure ChatGPT provider is disabled/removed
    if (!isAuthenticated) {
      const hasChatGPT = providers.some((p) => p.id === CHATGPT_PROVIDER_ID);
      if (hasChatGPT) {
        const updated = providers.map((p) =>
          p.id === CHATGPT_PROVIDER_ID ? { ...p, enabled: false, models: [] } : p
        );
        // Optionally keep disabled entry so it shows as inactive; or filter out. We keep disabled.
        localStorage.setItem("qube-providers", JSON.stringify(updated));
        const def = localStorage.getItem("qube-default-model");
        if (def && def.startsWith("chatgpt:")) {
          // clear default if it was a chatgpt model
          localStorage.removeItem("qube-default-model");
        }
        fetch("/api/providers/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providers: updated, defaultModelId: localStorage.getItem("qube-default-model") || null }),
        }).catch(() => {});
        window.dispatchEvent(new Event("qube-providers-changed"));
      }
      return;
    }

    // Authenticated: fetch models
    try {
      const res = await fetch("/api/chatgpt/models", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Failed to fetch ChatGPT models");
      const data = await res.json();
      const models: string[] = Array.isArray(data.models) ? data.models : Array.isArray(data.data) ? data.data.map((m: any) => m.id) : [];
      if (models.length === 0) return;

      // Build qualified models
      const qualifiedModels = models.map((mid, idx) => ({
        id: `${CHATGPT_PROVIDER_ID}:${mid}`,
        name: mid,
        enabled: idx === 0, // enable first model by default
        icon: detectModelIcon(mid, CHATGPT_PROVIDER_ID),
        imageInput: detectModelImageSupport(mid),
        reasoning: detectModelThinkingSupport(mid),
      }));

      // Find existing or create new provider entry
      let existing = providers.find((p) => p.id === CHATGPT_PROVIDER_ID);
      if (!existing) {
        // Try to import DEFAULT_PROVIDERS to get template? fallback to minimal
        const newProvider: ProviderConfig = {
          id: CHATGPT_PROVIDER_ID,
          name: CHATGPT_PROVIDER_NAME,
          baseURL: "/api/chatgpt",
          enabled: true,
          hasApiKey: false,
          models: qualifiedModels,
        };
        providers = [...providers, newProvider];
      } else {
        // Preserve enabled flags for models that already existed
        const existingMap = new Map(existing.models.map((m) => [m.id, m]));
        const merged = qualifiedModels.map((m) => {
          const prev = existingMap.get(m.id);
          return prev ? { ...m, enabled: prev.enabled } : m;
        });
        // If none enabled, enable first
        if (merged.length > 0 && !merged.some((m) => m.enabled)) {
          merged[0].enabled = true;
        }
        providers = providers.map((p) => (p.id === CHATGPT_PROVIDER_ID ? { ...p, enabled: true, models: merged } : p));
      }

      localStorage.setItem("qube-providers", JSON.stringify(providers));

      // Keep the default valid against the live plan list: set it when empty,
      // and evict it when it points at a ChatGPT model the plan no longer has.
      const currentDefault = localStorage.getItem("qube-default-model");
      const chatgptModels = providers.find(p => p.id===CHATGPT_PROVIDER_ID)?.models || [];
      if (!currentDefault) {
        const firstEnabled = chatgptModels.find(m=>m.enabled) || chatgptModels[0];
        if (firstEnabled) localStorage.setItem("qube-default-model", firstEnabled.id);
      } else if (currentDefault.startsWith("chatgpt:") && !chatgptModels.some(m=>m.id===currentDefault)) {
        const firstEnabled = chatgptModels.find(m=>m.enabled) || chatgptModels[0];
        if (firstEnabled) localStorage.setItem("qube-default-model", firstEnabled.id);
        else localStorage.removeItem("qube-default-model");
      }

      const defaultModelId = localStorage.getItem("qube-default-model") || null;
      fetch("/api/providers/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers, defaultModelId }),
      }).catch(() => {});
      window.dispatchEvent(new Event("qube-providers-changed"));
    } catch (e) {
      console.error("[ChatGPT] Failed to sync models", e);
    }
  }, []);

  useEffect(() => {
    if (chatgpt.status === "authenticated") {
      syncProvidersWithChatGPT(true, chatgpt.user);
    } else if (chatgpt.status === "unauthenticated" || chatgpt.status === "expired") {
      syncProvidersWithChatGPT(false);
    }
  }, [chatgpt.status, chatgpt.user, syncProvidersWithChatGPT]);

  return chatgpt;
}
