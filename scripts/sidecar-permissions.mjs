/**
 * Shared permission rules for the shipped `sidecar-dist` tree.
 *
 * Qube copies the entire sidecar to a writable temp dir at startup. That copy
 * runs as the installing user, so every file and directory in the bundle must
 * be world-readable (POSIX `o+r`) and directories world-traversable (`o+x`).
 * Playwright's Chromium cache contains `0600` metadata files and `0700`
 * directories; scripts/build-sidecar.js used to copy those modes verbatim,
 * which produced "Permission denied (os error 13)" at startup on Linux.
 *
 * On Windows POSIX bits do not apply; callers skip normalization/guarding
 * there rather than pretending the check passed.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DIR_MODE = 0o755;
const FILE_MODE = 0o644;
const SPECIAL_BITS = 0o7000; // setuid/setgid/sticky
const EXEC_BITS = 0o111;

/** Yield the root plus every entry below it (symlinks yielded, not followed). */
function* walk(root) {
  yield { path: root, stat: fs.lstatSync(root) };
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const stat = fs.lstatSync(fullPath);
      yield { path: fullPath, stat };
      if (stat.isDirectory()) stack.push(fullPath);
    }
  }
}

function ensureRoot(root) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('sidecar root path is required');
  }
  if (!fs.existsSync(root)) {
    throw new Error(`sidecar root does not exist: ${root}`);
  }
}

function isWindows() {
  return process.platform === 'win32';
}

/**
 * Make the whole sidecar tree readable and traversable by every user.
 * Directories become 0755; files get at least 0644. Existing executable bits
 * (owner/group/other) and setuid/setgid/sticky bits are preserved, so
 * `chrome` and `chrome_sandbox` keep working after the copy.
 *
 * @returns {{checked: number, changed: number, skipped: boolean}}
 */
export function normalizeSidecarPermissions(root) {
  ensureRoot(root);
  if (isWindows()) return { checked: 0, changed: 0, skipped: true };

  let checked = 0;
  let changed = 0;
  for (const { path: entryPath, stat } of walk(root)) {
    checked += 1;
    // chmod() on a symlink follows the target, which may live outside the
    // bundle. copySync() resolves symlinks, so leave any stray link alone.
    if (stat.isSymbolicLink()) continue;

    const current = stat.mode & 0o7777;
    const desired = stat.isDirectory()
      ? (current & SPECIAL_BITS) | DIR_MODE
      : (current & (SPECIAL_BITS | EXEC_BITS)) | FILE_MODE;
    if (desired === current) continue;

    fs.chmodSync(entryPath, desired);
    changed += 1;
  }
  return { checked, changed, skipped: false };
}

/**
 * Fail if any entry under `root` is not world-readable. Files need all of
 * `0444`, directories all of `0111` (read + traverse + list). This is the CI
 * guard that catches a future dependency reintroducing private modes.
 *
 * @returns {{checked: number, failures: string[], skipped: boolean}}
 * @throws {Error} when one or more entries fail the guard
 */
export function assertWorldReadable(root) {
  ensureRoot(root);
  if (isWindows()) return { checked: 0, failures: [], skipped: true };

  let checked = 0;
  const failures = [];
  for (const { path: entryPath, stat } of walk(root)) {
    checked += 1;
    const mode = stat.mode;
    const required = stat.isDirectory() ? 0o111 : 0o444;
    if ((mode & required) === required) continue;
    failures.push(`${path.relative(root, entryPath) || '.'}: ${mode.toString(8).padStart(4, '0')}`);
  }
  if (failures.length > 0) {
    const preview = failures.slice(0, 50).join('\n  ');
    const more = failures.length > 50 ? `\n  ... and ${failures.length - 50} more` : '';
    throw new Error(
      `${failures.length} sidecar entr${failures.length === 1 ? 'y is' : 'ies are'} not world-readable under ${root}:\n  ${preview}${more}`,
    );
  }
  return { checked, failures, skipped: false };
}
