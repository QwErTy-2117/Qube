/**
 * Platform-key helpers for the release updater manifest (latest.json).
 *
 * Kept free of I/O so the mapping can be unit tested: this mapping decides
 * which platform keys exist in the manifest, and a missing key means the
 * Tauri updater refuses to update that platform ("None of the fallback
 * platforms `["linux-x86_64-rpm", "linux-x86_64"]` were found in the
 * response `platforms` object").
 *
 * Tauri's updater looks up `{os}-{arch}` first and then
 * `{os}-{arch}-{installer}` — the installer being the bundle the user
 * installed from (e.g. "rpm" on an rpm based distro).
 */

// Which bundle the plain `{os}-{arch}` key points at. Mirrors what
// tauri-action produced: macOS -> app.tar.gz, Windows -> NSIS
// (updaterJsonPreferNsis: true), Linux -> deb.
export const PRIMARY_BUNDLE = {
  darwin: ["app"],
  windows: ["nsis", "msi"],
  linux: ["deb", "rpm", "appimage"],
};

export function archFromName(name) {
  if (/aarch64|arm64/.test(name)) return "aarch64";
  if (/x86_64|x64|amd64/.test(name)) return "x86_64";
  return null;
}

/**
 * Classify a bundle asset name into the updater platform coordinates.
 * Returns null for assets that are not updater artifacts (dmg, zip, json...).
 */
export function bundlePlatform(name) {
  let os = null;
  let bundle = null;
  if (name.endsWith(".app.tar.gz")) {
    os = "darwin";
    bundle = "app";
  } else if (name.endsWith("-setup.exe")) {
    os = "windows";
    bundle = "nsis";
  } else if (name.endsWith(".msi")) {
    os = "windows";
    bundle = "msi";
  } else if (name.endsWith(".deb")) {
    os = "linux";
    bundle = "deb";
  } else if (name.endsWith(".rpm")) {
    os = "linux";
    bundle = "rpm";
  } else if (name.endsWith(".AppImage")) {
    os = "linux";
    bundle = "appimage";
  } else {
    return null;
  }
  const arch = archFromName(name);
  if (!arch) return null;
  return { os, arch, bundle };
}

export function platformKey({ os, arch, bundle }) {
  return `${os}-${arch}-${bundle}`;
}

export function plainKey({ os, arch }) {
  return `${os}-${arch}`;
}

/** Pick the bundle the plain `{os}-{arch}` key should point at. */
export function pickPreferred(list) {
  if (!list.length) return null;
  const order = PRIMARY_BUNDLE[list[0].os] || [];
  const rank = (meta) => {
    const index = order.indexOf(meta.bundle);
    return index === -1 ? order.length : index;
  };
  return [...list].sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * Merge the computed platform entries into the manifest that is already on
 * the release.
 *
 * Existing entries win: tauri-action owns them. An entry is only replaced
 * when its URL points at an asset that is no longer on the release
 * (tauri-action deletes and re-uploads an asset when it clobbers it, which
 * changes the asset id).
 */
export function mergeManifest({ existing, computed, liveAssetIds }) {
  const platforms = { ...existing };
  const added = [];
  const repaired = [];
  const isLive = (url) => {
    const id = (url || "").split("/").pop();
    return liveAssetIds.has(String(id));
  };
  for (const [key, value] of computed) {
    const current = platforms[key];
    if (!current) {
      platforms[key] = value;
      added.push(key);
    } else if (!isLive(current.url)) {
      platforms[key] = value;
      repaired.push(key);
    }
  }
  const removed = Object.keys(existing).filter((key) => !platforms[key]);
  return { platforms, added, repaired, removed };
}

/**
 * Turn bundle coordinates into the full set of updater platform keys.
 * Returns a Map<key, meta>.
 */
export function planPlatformKeys(metas) {
  const keys = new Map();
  const groups = new Map();
  for (const meta of metas) {
    keys.set(platformKey(meta), meta);
    const plain = plainKey(meta);
    if (!groups.has(plain)) groups.set(plain, []);
    groups.get(plain).push(meta);
  }
  for (const [plain, list] of groups) {
    const best = pickPreferred(list);
    if (best) keys.set(plain, best);
  }
  return keys;
}
