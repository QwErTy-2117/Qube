import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ProviderConfig } from "@/components/shared/settings-dialog";
import { getDataDir } from "@/lib/data-dir";

const PROVIDERS_FILE = join(getDataDir(), ".memory", "providers.json");

class ProviderStore {
  private providers = new Map<string, ProviderConfig>();
  private defaultModelId: string | null = null;
  private initialized = false;

  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      if (existsSync(PROVIDERS_FILE)) {
        const raw = readFileSync(PROVIDERS_FILE, "utf-8");
        const data = JSON.parse(raw);
        if (Array.isArray(data?.providers)) {
          this.sync(data.providers, data.defaultModelId, false);
        }
      }
    } catch (e) {
      console.error("[ProviderStore] Failed to load cached providers:", e);
    }
  }

  sync(providers: ProviderConfig[], defaultModelId?: string | null, writeToDisk = true) {
    this.providers.clear();
    for (const p of providers) {
      this.providers.set(p.id, p);
    }
    if (defaultModelId !== undefined) {
      this.defaultModelId = defaultModelId || null;
    }

    if (writeToDisk) {
      try {
        const dir = join(getDataDir(), ".memory");
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(
          PROVIDERS_FILE,
          JSON.stringify({ providers, defaultModelId: this.defaultModelId }, null, 2),
          "utf-8"
        );
      } catch (e) {
        console.error("[ProviderStore] Failed to write providers cache:", e);
      }
    }
  }

  getProvider(providerId: string): ProviderConfig | undefined {
    this.ensureInitialized();
    return this.providers.get(providerId);
  }

  getProviderByModel(qualifiedModelId: string): { provider: ProviderConfig; modelId: string } | null {
    this.ensureInitialized();
    const colonIdx = qualifiedModelId.indexOf(":");
    if (colonIdx < 0) return null;
    const providerId = qualifiedModelId.slice(0, colonIdx);
    const modelId = qualifiedModelId.slice(colonIdx + 1);
    const provider = this.providers.get(providerId);
    if (!provider) return null;
    return { provider, modelId };
  }

  getDefaultModelId(): string | null {
    this.ensureInitialized();
    return this.defaultModelId;
  }

  getAllProviders(): ProviderConfig[] {
    this.ensureInitialized();
    return Array.from(this.providers.values());
  }

  hasProviders(): boolean {
    this.ensureInitialized();
    return this.providers.size > 0;
  }
}

export const providerStore = new ProviderStore();
