import type { createModels } from "@earendil-works/pi-ai/models";
import { providerStore } from "@/lib/pi/provider-store";
import { qubeProviderForPiAi } from "@/lib/pi/durable-models";

/** Derived from createModels so we don't reach into an unexported subpath. */
type CredentialStore = NonNullable<NonNullable<Parameters<typeof createModels>[0]>["credentials"]>;

/**
 * BYOK credential store: resolves each pi-ai provider to the user's
 * stored Qube key (Settings → Model) instead of process env vars. This
 * is what makes "bring the AI you already pay for" work on the durable
 * path, not just the legacy harness.
 *
 * Writes/deletes are no-ops: credentials are owned by the Qube settings
 * store, and the durable harness only reads them.
 */
export function createQubeCredentialStore(): CredentialStore {
  const apiKeyFor = (piAiProviderId: string): string | undefined => {
    const qubeId = qubeProviderForPiAi(piAiProviderId) ?? piAiProviderId;
    try {
      const provider = providerStore.getProvider(qubeId);
      const key = provider?.apiKey?.trim();
      return key || undefined;
    } catch {
      return undefined;
    }
  };

  return {
    async read(providerId: string) {
      const key = apiKeyFor(providerId);
      if (!key) return undefined;
      return { type: "api_key", key };
    },
    async list() {
      try {
        return providerStore
          .getAllProviders()
          .filter((p) => p.apiKey && p.apiKey.trim())
          .map((p) => ({ providerId: p.id, type: "api_key" as const }));
      } catch {
        return [];
      }
    },
    async modify() {
      // Settings own credential writes; nothing to persist here.
      return undefined;
    },
    async delete() {
      // No-op by design.
    },
  };
}
