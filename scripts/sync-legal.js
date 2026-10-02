/**
 * Sync legal docs into public/legal so they are served as static files
 * (/legal/terms.md, /legal/privacy.md) in every runtime:
 * - `npm run dev` (Next serves public/)
 * - standalone sidecar (public/ is bundled next to server.js)
 * - Tauri production on Windows/macOS/Linux (temp-dir copy keeps public/)
 *
 * The onboarding Terms screen fetches the API first (/api/legal/*) and falls
 * back to these static files, so a filesystem-layout miss on one platform
 * can never blank the agreement screen again.
 *
 * Run: node scripts/sync-legal.js (called by build-sidecar.js pre-build).
 */
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const outDir = path.join(rootDir, "public", "legal");

const pairs = [
  ["TERMS.md", "terms.md"],
  ["PRIVACY.md", "privacy.md"],
];

try {
  fs.mkdirSync(outDir, { recursive: true });
} catch (e) {
  console.error(`[sync-legal] cannot create ${outDir}: ${e.message}`);
  process.exit(1);
}

let failed = false;
for (const [src, dest] of pairs) {
  try {
    const srcPath = path.join(rootDir, src);
    const destPath = path.join(outDir, dest);
    fs.copyFileSync(srcPath, destPath);
    console.log(`[sync-legal] ${src} -> public/legal/${dest}`);
  } catch (e) {
    console.error(`[sync-legal] FAILED ${src}: ${e.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
