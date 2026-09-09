/**
 * @deprecated Codex install is obsolete — Pi harness has no external CLI.
 * Shim retained for backward compat; always returns false / no-op.
 */
export async function ensureCodexInstalled(): Promise<boolean> {
  console.log("[codex-install] DEPRECATED shim: Pi harness requires no Codex CLI");
  return false;
}

export function isCodexAvailableSync(): boolean {
  return false;
}
