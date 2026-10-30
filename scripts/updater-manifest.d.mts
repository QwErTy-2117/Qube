/**
 * Type declarations for the plain-JS updater manifest helpers.
 *
 * The helpers live in `scripts/` as ESM so the release workflow can run them
 * with plain `node` (no build step), while the unit test in `tests/` is
 * TypeScript and wants types.
 */

export type BundleMeta = {
  os: "darwin" | "windows" | "linux";
  arch: "aarch64" | "x86_64";
  bundle: string;
};

export type PlatformEntry = {
  signature: string;
  url: string;
};

export declare const PRIMARY_BUNDLE: Record<string, string[]>;

export declare function archFromName(
  name: string,
): "aarch64" | "x86_64" | null;

export declare function bundlePlatform(name: string): BundleMeta | null;

export declare function platformKey(meta: BundleMeta): string;

export declare function plainKey(meta: BundleMeta): string;

export declare function pickPreferred(
  list: BundleMeta[],
): BundleMeta | null;

export declare function planPlatformKeys(
  metas: BundleMeta[],
): Map<string, BundleMeta>;

export declare function mergeManifest(args: {
  existing: Record<string, PlatformEntry>;
  computed: Map<string, PlatformEntry>;
  liveAssetIds: Set<string>;
}): {
  platforms: Record<string, PlatformEntry>;
  added: string[];
  repaired: string[];
  removed: string[];
};
