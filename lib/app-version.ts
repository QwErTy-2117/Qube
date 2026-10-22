import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Version of the running app.
 *
 * The desktop shell spawns the sidecar with `QUBE_APP_VERSION` set to its own
 * compiled version, so this is authoritative even if the sidecar copy in the
 * temp dir is older than the installed binary. Without it, the version shown
 * in Settings came from the `package.json` inside that temp copy — which is
 * exactly how a machine running 0.0.89 could keep reporting 0.0.80.
 *
 * In dev / plain web (`npm run dev`) the variable is unset and we fall back to
 * the repository's package.json.
 */
export function getAppVersion(): string {
  const fromShell = process.env.QUBE_APP_VERSION?.trim();
  if (fromShell) return fromShell;
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
