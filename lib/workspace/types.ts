/**
 * Unified workspace / artifact model.
 * Browser + Document + Spreadsheet + Presentation + Code share one
 * contextual request shape so the agent always knows the source.
 */

export type WorkspaceKind = "browser" | "pdf" | "doc" | "sheet" | "slides" | "code" | "text";

export type SelectionRef =
  | { kind: "pdf"; page: number; text: string }
  | { kind: "doc"; paragraph: number; text: string }
  | { kind: "sheet"; sheet: string; range: string; values: string[][] }
  | { kind: "slides"; slide: number; text: string }
  | { kind: "code"; startLine: number; endLine: number; text: string }
  | { kind: "text"; startLine: number; endLine: number; text: string }
  | { kind: "browser"; url: string; text: string };

export type WorkspaceSelection = SelectionRef & { id: string; at: number };

// Distributive omit so addSelection accepts any single variant without id/at
export type NewSelection = SelectionRef;

export type WorkspaceArtifact = {
  id: string;
  kind: WorkspaceKind;
  title: string;
  filePath?: string; // workspace-relative for documents
  downloadUrl?: string;
};

export type AgentContext =
  | { type: "browser"; url: string; title?: string; selections: WorkspaceSelection[] }
  | { type: "document"; artifactId: string; filePath: string; selections: WorkspaceSelection[] }
  | { type: "spreadsheet"; artifactId: string; filePath: string; sheet?: string; selections: WorkspaceSelection[] }
  | { type: "presentation"; artifactId: string; filePath: string; slide?: number; selections: WorkspaceSelection[] }
  | { type: "code"; artifactId: string; filePath: string; selections: WorkspaceSelection[] };

export function buildContextMessage(input: { message: string; artifact: WorkspaceArtifact; selections: WorkspaceSelection[] }): string {
  const { message, artifact, selections } = input;
  if (selections.length === 0) {
    return artifact.filePath
      ? `[workspace ${artifact.kind} ${artifact.filePath}]\n\n${message}`
      : `[workspace ${artifact.kind} ${artifact.title}]\n\n${message}`;
  }
  const refs = selections
    .map((s, i) => {
      if (s.kind === "pdf") return `Quote ${i + 1} → PDF page ${s.page}: "${s.text.slice(0, 400)}"`;
      if (s.kind === "doc") return `Quote ${i + 1} → paragraph ${s.paragraph}: "${s.text.slice(0, 400)}"`;
      if (s.kind === "sheet") return `Quote ${i + 1} → Sheet "${s.sheet}" Range ${s.range}`;
      if (s.kind === "slides") return `Quote ${i + 1} → Slide ${s.slide}: "${s.text.slice(0, 400)}"`;
      if (s.kind === "code" || s.kind === "text") return `Quote ${i + 1} → Lines ${s.startLine}–${s.endLine}:\n${s.text.slice(0, 800)}`;
      return `Quote ${i + 1} → ${s.text.slice(0, 400)}`;
    })
    .join("\n");
  const header = artifact.filePath
    ? `[workspace ${artifact.kind} ${artifact.filePath} id=${artifact.id}]`
    : `[workspace ${artifact.kind} ${artifact.title}]`;
  return `${header}\nContext selections:\n${refs}\n\nInstruction:\n${message}`;
}

export function kindForFilename(filename: string): WorkspaceKind {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return "doc";
  if (["xls", "xlsx", "ods"].includes(ext)) return "sheet";
  if (ext === "csv") return "sheet";
  if (["ppt", "pptx", "odp"].includes(ext)) return "slides";
  if (["js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "css", "html", "json", "yml", "yaml", "toml", "sh", "sql", "xml"].includes(ext)) return "code";
  return "text";
}
