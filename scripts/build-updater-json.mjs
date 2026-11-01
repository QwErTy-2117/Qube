/**
 * Rebuild the release updater manifest (latest.json) from the assets that are
 * actually attached to the release.
 *
 * WHY THIS EXISTS
 * tauri-action v1 writes `latest.json` with a read-modify-write on a single
 * release asset: it downloads the current manifest, merges its own platform
 * into it, DELETES the old asset and uploads a new one. With a matrix build
 * that read-modify-write runs once per platform job IN PARALLEL, so two jobs
 * can read the same base and the second write drops the first job's platform.
 * v0.0.89 lost exactly that race on linux-x64: the published manifest had no
 * `linux-x86_64*` entry even though `Qube_0.0.89_amd64.deb` and
 * `Qube-0.0.89-1.x86_64.rpm` were uploaded, so the Tauri updater on Linux
 * x86_64 failed with:
 *   None of the fallback platforms `["linux-x86_64-rpm", "linux-x86_64"]`
 *   were found in the response `platforms` object
 * The updater endpoint is `releases/latest/download/latest.json`, so one
 * broken manifest breaks auto-update for every user of that release.
 *
 * This script is the single writer: it reads the manifest tauri-action left
 * behind, fills in ONLY the platform entries that are missing (or point at an
 * asset that no longer exists) and re-uploads it. Entries tauri-action wrote
 * are never rewritten, so it stays the source of truth for what it produced.
 *
 * Usage:
 *   node scripts/build-updater-json.mjs [tag] [--dry-run]
 *
 * Env:
 *   GITHUB_TOKEN | GH_TOKEN  token with `contents: write` on the repo
 *   GITHUB_REPOSITORY        owner/repo (defaults to the git origin remote)
 *   GITHUB_API_URL           API base (defaults to https://api.github.com)
 *   GITHUB_REF_NAME          used to detect a tag push; falls back to the
 *                             version in src-tauri/tauri.conf.json
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import { bundlePlatform, mergeManifest, planPlatformKeys } from "./updater-manifest.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tagArg = args.find((a) => !a.startsWith("--"));

const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(
  /\/+$/,
  "",
);
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

function fail(message) {
  console.error(`[updater-manifest] ERROR: ${message}`);
  process.exit(1);
}

if (!token) fail("GITHUB_TOKEN (or GH_TOKEN) is required");

function repoSlug() {
  const fromEnv = process.env.GITHUB_REPOSITORY;
  if (fromEnv) return fromEnv;
  let remote = "";
  try {
    remote = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
  } catch {
    fail(
      "cannot determine the repository: set GITHUB_REPOSITORY=owner/repo " +
        "(the git origin remote is not readable here)",
    );
  }
  const match = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  // Never echo the remote: it may embed a token in the URL.
  if (!match) fail("cannot parse owner/repo out of the origin remote");
  return `${match[1]}/${match[2]}`;
}

function resolveTag() {
  if (tagArg) return tagArg;
  const ref = process.env.GITHUB_REF_NAME || "";
  if (/^v\d+\.\d+\.\d+/.test(ref)) return ref;
  // workflow_dispatch from a branch: the release tag is derived from the
  // Tauri version, same as the macOS x64 packaging step does.
  const confPath = path.join(
    process.cwd(),
    "src-tauri",
    "tauri.conf.json",
  );
  const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
  return `v${conf.version}`;
}

const repo = repoSlug();
const tag = resolveTag();

async function api(endpoint, options = {}) {
  const res = await fetch(`${apiBase}${endpoint}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "qube-updater-manifest",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    fail(
      `GitHub API ${options.method || "GET"} ${endpoint} -> ` +
        `${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
    );
  }
  return res;
}

async function apiJson(endpoint) {
  return (await api(endpoint)).json();
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

async function assetContent(asset) {
  const res = await api(
    `/repos/${repo}/releases/assets/${asset.id}`,
    { headers: { accept: "application/octet-stream" } },
  );
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`[updater-manifest] repo=${repo} tag=${tag}${dryRun ? " (dry-run)" : ""}`);

const release = await apiJson(
  `/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
);
if (release.draft) {
  fail(`release ${tag} is a draft; publish it before rebuilding the manifest`);
}

const assets = await apiJson(
  `/repos/${repo}/releases/${release.id}/assets?per_page=100`,
);
const byName = new Map();
for (const asset of assets) byName.set(asset.name, asset);

const manifestAsset = byName.get("latest.json");

// Current manifest, if any. It is the base: tauri-action owns these values.
let manifest = {
  version: tag.replace(/^v/, ""),
  notes: release.body || "",
  pub_date: release.published_at || new Date().toISOString(),
  platforms: {},
};
if (manifestAsset) {
  try {
    const current = JSON.parse((await assetContent(manifestAsset)).toString());
    manifest = {
      version: current.version ?? manifest.version,
      notes: current.notes ?? manifest.notes,
      pub_date: current.pub_date ?? manifest.pub_date,
      platforms: current.platforms ?? {},
    };
  } catch (error) {
    console.warn(
      `[updater-manifest] existing latest.json is unreadable (${error.message}); rebuilding it`,
    );
  }
}

// Every .sig on the release is an updater artifact of the bundle it sits
// next to. That gives us the full platform map, independent of what the
// (possibly clobbered) manifest currently holds.
const bundleAssets = new Map(); // bundle name -> asset
for (const asset of assets) {
  if (asset.name.endsWith(".sig")) continue;
  if (bundlePlatform(asset.name)) bundleAssets.set(asset.name, asset);
}

// bundle name -> { meta, signature, url }
const entries = new Map();
for (const sigAsset of assets) {
  if (!sigAsset.name.endsWith(".sig")) continue;
  const bundleName = sigAsset.name.slice(0, -".sig".length);
  const bundleAsset = bundleAssets.get(bundleName);
  if (!bundleAsset) {
    console.warn(
      `[updater-manifest] signature ${sigAsset.name} has no matching bundle asset; skipped`,
    );
    continue;
  }
  const meta = bundlePlatform(bundleName);
  entries.set(bundleName, {
    meta,
    signature: (await assetContent(sigAsset)).toString(),
    url: `${apiBase}/repos/${repo}/releases/assets/${bundleAsset.id}`,
  });
}

// key -> { signature, url }
const computed = new Map();
const byMeta = new Map([...entries.values()].map((entry) => [entry.meta, entry]));
for (const [key, meta] of planPlatformKeys(
  [...entries.values()].map((entry) => entry.meta),
)) {
  const entry = byMeta.get(meta);
  computed.set(key, { signature: entry.signature, url: entry.url });
}

// An entry is broken when its URL points at an asset id that is no longer on
// the release (tauri-action deletes and re-uploads an asset when it clobbers
// it, which changes the id).
const liveAssetIds = new Set(assets.map((a) => String(a.id)));

const { platforms: merged, added, repaired, removed } = mergeManifest({
  existing: manifest.platforms,
  computed,
  liveAssetIds,
});

console.log(
  `[updater-manifest] manifest has ${Object.keys(manifest.platforms).length} platform entries, ` +
    `assets provide ${computed.size}`,
);
if (added.length) console.log(`[updater-manifest] missing (added): ${added.join(", ")}`);
if (repaired.length)
  console.log(`[updater-manifest] dangling url (repaired): ${repaired.join(", ")}`);
if (removed.length)
  console.log(`[updater-manifest] dropped: ${removed.join(", ")}`);

const changed =
  added.length > 0 || repaired.length > 0 || removed.length > 0;

if (!changed) {
  console.log("[updater-manifest] manifest is already complete; nothing to do");
  process.exit(0);
}

const output = {
  version: manifest.version,
  notes: manifest.notes,
  pub_date: manifest.pub_date,
  platforms: merged,
};

if (dryRun) {
  console.log("[updater-manifest] dry-run, not uploading:");
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

// Replace the manifest. GitHub has no "update asset content" endpoint, so the
// file has to be uploaded again. Do it in the order that never leaves the
// release without a manifest: upload under a temporary name first, drop the
// old asset, then rename the new one into place.
//
// Same shape tauri-action writes (2-space indent, no trailing newline) so
// the two never fight over the file format.
const body = Buffer.from(JSON.stringify(output, null, 2), "utf8");

async function uploadAsset(name, content) {
  // Asset uploads go to uploads.github.com (the release's `upload_url`), not
  // to api.github.com - POSTing to the api host answers 404.
  const base = (release.upload_url || `${apiBase}/repos/${repo}/releases/${release.id}/assets`).split(
    "{",
  )[0];
  const uploadUrl =
    `${base}?name=${encodeURIComponent(name)}&label=${encodeURIComponent(name)}`;
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "qube-updater-manifest",
      "content-type": "application/octet-stream",
      "content-length": String(content.length),
    },
    body: content,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `${res.status} ${res.statusText}: ${text.slice(0, 200)}`,
    );
  }
  return res.json();
}

// A unique name per attempt: a retried upload must not collide with the
// asset a previous (half-failed) attempt already created.
let newAsset = null;
let lastError = "";
for (let attempt = 1; attempt <= 5 && !newAsset; attempt++) {
  try {
    newAsset = await uploadAsset(
      `latest.json.tmp-${Date.now()}-${attempt}`,
      body,
    );
  } catch (error) {
    lastError = error.message;
    console.warn(
      `[updater-manifest] upload attempt ${attempt} failed (${lastError}); retrying`,
    );
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
}
if (!newAsset) fail(`could not upload latest.json: ${lastError}`);

if (manifestAsset) {
  try {
    await api(`/repos/${repo}/releases/assets/${manifestAsset.id}`, {
      method: "DELETE",
    });
    console.log("[updater-manifest] deleted the old latest.json asset");
  } catch (error) {
    // The old manifest is still in place, so the release is not broken -
    // just clean up the new upload and give up.
    await api(`/repos/${repo}/releases/assets/${newAsset.id}`, {
      method: "DELETE",
    }).catch(() => {});
    fail(`could not delete the old latest.json asset: ${error.message}`);
  }
}

try {
  await api(`/repos/${repo}/releases/assets/${newAsset.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "latest.json", label: "latest.json" }),
  });
} catch (error) {
  // The rename failed and the old asset is already gone: put the manifest
  // back under its real name so the updater endpoint keeps working.
  console.warn(
    `[updater-manifest] rename failed (${error.message}); re-uploading as latest.json`,
  );
  try {
    await uploadAsset("latest.json", body);
    await api(`/repos/${repo}/releases/assets/${newAsset.id}`, {
      method: "DELETE",
    }).catch(() => {});
  } catch (uploadError) {
    fail(
      `could not install latest.json (${error.message}; re-upload failed: ` +
        `${uploadError.message}); the manifest is still on the release as ` +
        `asset ${newAsset.id}`,
    );
  }
}

console.log(
  `[updater-manifest] uploaded latest.json for ${tag} ` +
    `(${Object.keys(merged).length} platform entries)`,
);
