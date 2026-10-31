/**
 * Artifact kinds — the single source of truth for "what kind of file is
 * this and how should it open". Pure and dependency-free so the server,
 * the shell, the chat cards and the tests all agree.
 */

export const ARTIFACT_KINDS = ["pdf", "doc", "sheet", "slides", "code", "html", "text"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

const EXT: Record<ArtifactKind, readonly string[]> = {
  pdf: ["pdf"],
  doc: ["doc", "docx", "odt", "rtf", "md", "markdown", "txt"],
  sheet: ["xls", "xlsx", "ods", "csv", "tsv"],
  slides: ["ppt", "pptx", "odp", "key"],
  code: [
    "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "py", "rs", "go", "java",
    "kt", "swift", "c", "h", "cpp", "cc", "cxx", "hpp", "cs", "rb", "php", "css",
    "scss", "sass", "less", "json", "jsonc", "yml", "yaml", "xml", "sql", "sh",
    "bash", "zsh", "ps1", "toml", "ini", "env", "dockerfile", "makefile",
  ],
  html: ["html", "htm", "xhtml"],
  text: ["log", "rst", "text"],
};

/** Extension → kind. Order matters: html is a kind of its own, not code. */
export function detectArtifactKind(filenameOrPath: string): ArtifactKind {
  const base = (filenameOrPath || "").split(/[\\/]/).pop() || "";
  const lower = base.toLowerCase();
  if (lower === "dockerfile" || lower === "makefile") return "code";
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";
  for (const kind of ARTIFACT_KINDS) {
    if (EXT[kind].includes(ext)) return kind;
  }
  return "text";
}

export function isCodeArtifact(filename: string): boolean {
  return detectArtifactKind(filename) === "code";
}

export function isHtmlArtifact(filename: string): boolean {
  return detectArtifactKind(filename) === "html";
}

/** Files the code viewer can highlight with a real grammar. */
export const LANGUAGE_BY_EXT: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  json: "json",
  jsonc: "jsonc",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  sql: "sql",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  ps1: "powershell",
  toml: "toml",
  ini: "ini",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
};

export function languageForPath(filename: string): string {
  const base = (filename || "").split(/[\\/]/).pop()?.toLowerCase() || "";
  if (base === "dockerfile") return "docker";
  if (base === "makefile") return "make";
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  return LANGUAGE_BY_EXT[ext] || "text";
}

/** Line-level content sniffing when the extension is missing/ambiguous. */
export function detectLanguageFromContent(filename: string, content: string): string {
  const fromExt = languageForPath(filename);
  if (fromExt !== "text") return fromExt;
  const head = content.slice(0, 4000);
  if (/^#!/.test(head)) {
    if (/python/.test(head.split("\n")[0])) return "python";
    if (/(bash|sh|zsh)/.test(head.split("\n")[0])) return "shellscript";
    return "shellscript";
  }
  if (/^\s*<!--/.test(head) || /<!doctype html>/i.test(head)) return "html";
  if (/^\s*[{[][\s\S]*["'][\w-]+["']\s*:/.test(head)) return "json";
  if (/^\s*(name|version|dependencies)\s*:/m.test(head)) return "yaml";
  if (/\b(import|export|const|function)\b/.test(head) && /[;{]/.test(head)) return "javascript";
  return "text";
}

/** Hard cap for in-browser editing round-trips (bytes). */
export const MAX_EDITABLE_BYTES = 1_000_000;
/** Preview cap for very large source files (characters). */
export const MAX_PREVIEW_CHARS = 400_000;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? String(Math.round(value)) : String(Number(value.toFixed(1)));
  return `${rounded} ${units[unit]}`;
}
