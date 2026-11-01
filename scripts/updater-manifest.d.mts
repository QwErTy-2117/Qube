export type BundleMeta = {
  os: "darwin" | "windows" | "linux";
  arch: "x86_64" | "aarch64";
  bundle: string;
};

export type ManifestEntry = {
  signature: string;
  url: string;
};

export const PRIMARY_BUNDLE: Record<string, string[]>;

export function archFromName(name: string): "aarch64" | "x86_64" | null;
export function bundlePlatform(name: string): BundleMeta | null;
export function platformKey(meta: BundleMeta): string;
export function plainKey(meta: BundleMeta): string;
export function pickPreferred<T extends BundleMeta>(list: T[]): T | null;
export function mergeManifest(input: {
  existing: Record<string, ManifestEntry>;
  computed: Map<string, ManifestEntry>;
  liveAssetIds: Set<string>;
}): {
  platforms: Record<string, ManifestEntry>;
  added: string[];
  repaired: string[];
  removed: string[];
};
export function planPlatformKeys(metas: BundleMeta[]): Map<string, BundleMeta>;
