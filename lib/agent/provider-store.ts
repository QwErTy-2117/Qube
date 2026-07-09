import type { ProviderConfig } from "@/components/shared/settings-dialog";

class ProviderStore {
  private providers = new Map<string, ProviderConfig>();
  private defaultModelId: string | null = null;

  sync(providers: ProviderConfig[], defaultModelId?: string | null) {
    this.providers.clear();
    for (const p of providers) {
      this.providers.set(p.id, p);
    }
    if (defaultModelId !== undefined) {
      this.defaultModelId = defaultModelId || null;
    }
  }

  getProvider(providerId: string): ProviderConfig | undefined {
    return this.providers.get(providerId);
  }

  getProviderByModel(qualifiedModelId: string): { provider: ProviderConfig; modelId: string } | null {
    const colonIdx = qualifiedModelId.indexOf(":");
    if (colonIdx < 0) return null;
    const providerId = qualifiedModelId.slice(0, colonIdx);
    const modelId = qualifiedModelId.slice(colonIdx + 1);
    const provider = this.providers.get(providerId);
    if (!provider) return null;
    return { provider, modelId };
  }

  getDefaultModelId(): string | null {
    return this.defaultModelId;
  }

  hasProviders(): boolean {
    return this.providers.size > 0;
  }
}

export const providerStore = new ProviderStore();
