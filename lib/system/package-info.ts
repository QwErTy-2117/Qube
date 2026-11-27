/**
 * Distro/package awareness for the updater.
 *
 * Linux desktop apps are packaged per distro family: Debian/Ubuntu use .deb,
 * Fedora/RHEL/openSUSE use .rpm. There is no single native package that works
 * everywhere. Qube's auto-updater installs the package type it was built as,
 * so a .deb installed on Fedora can never be updated by `dpkg` there. This
 * module turns that state into an actionable message instead of a generic
 * "Failed to install package".
 *
 * Pure functions only — safe to import in the browser bundle. The server-side
 * detection lives in package-info-server.ts.
 */

export type DistroFamily = "debian" | "rpm" | "other";

export type OsRelease = {
  id: string;
  like: string[];
  name: string;
  family: DistroFamily;
};

export type PackagePresence = {
  installed: boolean;
  version?: string;
  /** dpkg status word, e.g. "install ok unpacked" / "install ok installed". */
  status?: string;
};

export type BinaryOwner = "deb" | "rpm" | "both" | "none" | "unknown";

export type PackageState = {
  platform: string;
  /** Node's process.arch ("x64", "arm64", …). */
  arch: string;
  distro: OsRelease;
  deb: PackagePresence | null;
  rpm: PackagePresence | null;
  binaryOwner: BinaryOwner;
  /** Package type the running Tauri binary was built as (from its marker). */
  bundleType: "deb" | "rpm" | "unknown";
  /** True when the running package type does not match the distro family. */
  mismatch: boolean;
  /** True when both package managers claim Qube (usually a manual install). */
  mixed: boolean;
  /** Package type that works natively on this distro. */
  recommended: "deb" | "rpm" | null;
  /** Native package manager for this distro. */
  packageManager: "dnf" | "zypper" | "apt" | null;
};

const DEBIAN_IDS = new Set([
  "debian",
  "ubuntu",
  "linuxmint",
  "pop",
  "elementary",
  "zorin",
  "kali",
  "raspbian",
  "devuan",
  "mx",
  "neon",
]);

const RPM_IDS = new Set([
  "fedora",
  "rhel",
  "centos",
  "rocky",
  "almalinux",
  "ol",
  "opensuse",
  "opensuse-leap",
  "opensuse-tumbleweed",
  "suse",
  "sles",
  "mageia",
  "amzn",
]);

function normalizeId(id: string): string {
  return id.trim().toLowerCase().replace(/["']/g, "");
}

/** Parse /etc/os-release content. Unknown or empty input is safe. */
export function parseOsRelease(text: string): OsRelease {
  const values: Record<string, string> = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[m[1]] = value;
  }
  const id = normalizeId(values.ID || "");
  const like = String(values.ID_LIKE || "")
    .split(/\s+/)
    .map(normalizeId)
    .filter(Boolean);
  const family = familyFor(id, like);
  const name =
    values.PRETTY_NAME ||
    values.NAME ||
    (id ? id.charAt(0).toUpperCase() + id.slice(1) : "this system");
  return { id, like, name, family };
}

/** Classify a distro from its ID and ID_LIKE tokens. */
export function familyFor(id: string, like: string[] = []): DistroFamily {
  const ids = [normalizeId(id), ...like.map(normalizeId)].filter(Boolean);
  if (ids.some((x) => DEBIAN_IDS.has(x))) return "debian";
  if (ids.some((x) => RPM_IDS.has(x))) return "rpm";
  return "other";
}

/** Native package manager for a parsed distro. */
export function packageManagerFor(distro: OsRelease): "dnf" | "zypper" | "apt" | null {
  if (distro.family === "debian") return "apt";
  if (distro.family !== "rpm") return null;
  const ids = [distro.id, ...distro.like];
  if (ids.some((id) => /opensuse|suse|sles/.test(id))) return "zypper";
  return "dnf";
}

/** Build the package state from already-collected facts (pure, testable). */
export function assessPackageState(input: {
  platform: string;
  arch?: string;
  osRelease: string;
  deb: PackagePresence | null;
  rpm: PackagePresence | null;
  dpkgOwnsBinary: boolean;
  rpmOwnsBinary: boolean;
  bundleType?: "deb" | "rpm" | "unknown";
}): PackageState {
  const distro = parseOsRelease(input.osRelease);
  const debInstalled = !!input.deb?.installed;
  const rpmInstalled = !!input.rpm?.installed;
  const binaryOwner: BinaryOwner =
    input.platform !== "linux"
      ? "unknown"
      : input.dpkgOwnsBinary && input.rpmOwnsBinary
        ? "both"
        : input.dpkgOwnsBinary
          ? "deb"
          : input.rpmOwnsBinary
            ? "rpm"
            : "none";
  const mixed =
    input.platform === "linux" &&
    (binaryOwner === "both" || (debInstalled && rpmInstalled));
  const recommended: "deb" | "rpm" | null =
    distro.family === "debian" ? "deb" : distro.family === "rpm" ? "rpm" : null;
  const bundleType = input.bundleType ?? "unknown";
  // The running binary's package type is the strongest signal: the updater
  // dispatches on it. A .deb binary on Fedora will always try dpkg. When the
  // marker is unreadable, fall back to the package databases.
  const mismatch =
    input.platform === "linux" &&
    ((distro.family === "rpm" &&
      (bundleType === "deb" ||
        (bundleType === "unknown" &&
          (debInstalled || binaryOwner === "deb" || binaryOwner === "both")))) ||
      (distro.family === "debian" &&
        (bundleType === "rpm" ||
          (bundleType === "unknown" && (rpmInstalled || binaryOwner === "rpm")))));
  return {
    platform: input.platform,
    arch: input.arch || "x64",
    distro,
    deb: input.deb,
    rpm: input.rpm,
    binaryOwner,
    bundleType,
    mismatch,
    mixed,
    recommended,
    packageManager: packageManagerFor(distro),
  };
}

const RELEASES_URL = "https://github.com/QwErTy-2117/Qube/releases";

/** RPM packages use x86_64/aarch64; Debian packages use amd64/arm64. */
function archToken(kind: "deb" | "rpm", arch: string): string {
  if (kind === "rpm") return arch === "arm64" ? "aarch64" : "x86_64";
  return arch === "arm64" ? "arm64" : "amd64";
}

function packageName(kind: "deb" | "rpm", arch: string): string {
  const token = archToken(kind, arch);
  return kind === "rpm"
    ? `Qube-<version>-1.${token}.rpm`
    : `Qube_<version>_${token}.deb`;
}

function installCommand(state: PackageState, kind: "deb" | "rpm"): string {
  if (state.packageManager === "zypper") return "sudo zypper install";
  if (state.packageManager === "apt" || kind === "deb") return "sudo apt install";
  return "sudo dnf install";
}

/** Remove the package entry from the foreign package manager. */
function purgeCommand(kind: "deb" | "rpm"): string {
  return kind === "deb" ? "sudo dpkg --purge --force-all qube" : "sudo rpm -e qube";
}

/**
 * Turn a raw updater install error into a distro-aware instruction.
 * `state` is null when the host could not be inspected (web/dev, non-Linux,
 * or the API failed); in that case the raw message is returned unchanged.
 */
export function buildPackageInstallHint(
  rawMessage: string,
  state: PackageState | null | undefined,
): string {
  if (!state || state.platform !== "linux") return rawMessage;
  const native = state.recommended;
  if (!native) return rawMessage;

  const installedKind =
    state.bundleType !== "unknown"
      ? state.bundleType
      : state.deb?.installed
        ? "deb"
        : state.rpm?.installed
          ? "rpm"
          : null;
  const nativeLabel = native === "rpm" ? "RPM" : "Debian";
  const foreign: "deb" | "rpm" = native === "rpm" ? "deb" : "rpm";
  const install = `${installCommand(state, native)} ./${packageName(native, state.arch)}`;
  if (state.mismatch) {
    const other = native === "rpm" ? "Debian" : "RPM";
    return (
      `Qube is installed from a ${other} package on ${state.distro.name}, but this system uses ${nativeLabel} packages. ` +
      `The automatic updater cannot replace a package from the other package manager. ` +
      `Close Qube, remove the foreign entry with "${purgeCommand(foreign)}", then install the ${nativeLabel} package once: ` +
      `"${install}" (download it from ${RELEASES_URL}). After that, automatic updates work normally.`
    );
  }
  if (state.mixed && state.bundleType === "unknown") {
    return (
      `Qube is registered with both dpkg and rpm on ${state.distro.name}. ` +
      `Close Qube, remove the foreign entry with "${purgeCommand(foreign)}", then install the ${nativeLabel} package once: ` +
      `"${install}" (download it from ${RELEASES_URL}).`
    );
  }
  if (installedKind === native) {
    return (
      `${rawMessage}. Close Qube, download the latest package from ${RELEASES_URL} and install it with ` +
      `"${install}".`
    );
  }
  return rawMessage;
}
