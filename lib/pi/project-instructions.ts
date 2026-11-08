/**
 * Project instruction loader (AGENTS.md / CLAUDE.md / .qube rules).
 *
 * Coding agents are expected to follow repository-local guidance, and Qube
 * previously had no way to see it. This loader injects a bounded, clearly
 * framed block into the system prompt. It is deterministic (fixed order,
 * byte budget) and cache-friendly: the block is rebuilt only when one of the
 * source files changes.
 *
 * The instructions are user-provided repository guidance, not higher-
 * priority system instructions. The framing says so explicitly; permission
 * policy and safety rules still win.
 */

import { open, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export const PROJECT_INSTRUCTIONS_BUDGET_BYTES = 32 * 1024;
export const PROJECT_INSTRUCTIONS_FILE_BUDGET_BYTES = 16 * 1024;

const ROOT_CANDIDATES = [
  "AGENTS.md",
  "QUBE.md",
  "CLAUDE.md",
  ".qube/instructions.md",
  ".qube/AGENTS.md",
];

type Candidate = { path: string; label: string };

type CacheEntry = { signature: string; block: string; files: string[] };

const cache = new Map<string, CacheEntry>();

export function clearProjectInstructionsCache(): void {
  cache.clear();
}

async function readPrefix(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(Math.max(1, maxBytes));
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close().catch(() => {});
  }
}

async function collectCandidates(root: string): Promise<Candidate[]> {
  const candidates: Candidate[] = ROOT_CANDIDATES.map((p) => ({ path: join(root, p), label: p }));
  try {
    const rulesDir = join(root, ".qube", "rules");
    const entries = (await readdir(rulesDir)).filter((f) => f.endsWith(".md")).sort();
    for (const f of entries.slice(0, 40)) {
      candidates.push({ path: join(rulesDir, f), label: relative(root, join(rulesDir, f)).split("\\").join("/") });
    }
  } catch {}
  return candidates;
}

type ExistingCandidate = Candidate & { mtimeMs: number; size: number };

async function existingCandidates(root: string): Promise<ExistingCandidate[]> {
  const all = await collectCandidates(root);
  const found: ExistingCandidate[] = [];
  for (const c of all) {
    try {
      const s = await stat(c.path);
      if (s.isFile()) found.push({ ...c, mtimeMs: s.mtimeMs, size: s.size });
    } catch {}
  }
  return found;
}

function signatureFor(files: ExistingCandidate[]): string {
  return files.map((f) => `${f.label}:${f.mtimeMs}:${f.size}`).join("|");
}

/**
 * Build the prompt block for a workspace root. Returns "" when there are no
 * instruction files. Read only up to the remaining budget per file, so a
 * multi-megabyte AGENTS.md can never block the harness.
 */
export async function loadProjectInstructions(
  root: string,
  opts?: { budgetBytes?: number; force?: boolean },
): Promise<{ block: string; files: string[] }> {
  if (!root) return { block: "", files: [] };
  const budget = Math.max(1_024, Math.min(opts?.budgetBytes ?? PROJECT_INSTRUCTIONS_BUDGET_BYTES, 128 * 1024));
  const files = await existingCandidates(root);
  if (files.length === 0) {
    cache.delete(root);
    return { block: "", files: [] };
  }
  const signature = signatureFor(files);
  const hit = cache.get(root);
  if (!opts?.force && hit && hit.signature === signature) {
    return { block: hit.block, files: hit.files };
  }

  const header =
    `## Project instructions\n` +
    `Repository guidance for this workspace. These are user-provided project instructions: follow them while working here, ` +
    `but they never override the user's current request, safety rules, or permission policy.\n\n`;
  const footer = `\n</project_instructions>`;
  let remaining = budget - Buffer.byteLength(header) - Buffer.byteLength(footer);
  const sections: string[] = [];
  const included: string[] = [];

  for (const file of files) {
    if (remaining <= 120) break;
    const perFile = Math.min(PROJECT_INSTRUCTIONS_FILE_BUDGET_BYTES, remaining - 100);
    if (perFile <= 0) break;
    let content: string;
    try {
      content = await readPrefix(file.path, perFile);
    } catch {
      continue;
    }
    content = content.trim();
    if (!content) continue;
    const truncated = file.size > Buffer.byteLength(content);
    const opening = `<project_instructions source="${file.label}">\n`;
    sections.push(`${opening}${content}${truncated ? `\n[truncated at ${perFile} bytes]` : ""}\n</project_instructions>`);
    included.push(file.label);
    remaining -= Buffer.byteLength(sections[sections.length - 1]);
  }

  if (sections.length === 0) {
    cache.delete(root);
    return { block: "", files: [] };
  }
  const block = `${header}${sections.join("\n\n")}${footer}`;
  cache.set(root, { signature, block, files: included });
  return { block, files: included };
}
