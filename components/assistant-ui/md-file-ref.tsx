"use client";

import { visit } from "unist-util-visit";
import { FileCard } from "./tools/file-card";

/** Matches `[file: path]` markers and literal `present_file(path="...")` calls in chat text. */
export const FILE_REF_RE = /(\[file:\s*(.+?)\]|present_file\(\s*path\s*=\s*"([^"]+)"\s*\))/gi;

export function extractFileRefsFromText(text: string): string[] {
  const out: string[] = [];
  FILE_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FILE_REF_RE.exec(text)) !== null) {
    const p = (m[2] ?? m[3] ?? "").trim();
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

export function fileCardPropsForPath(path: string): {
  filename: string;
  filePath?: string;
  downloadUrl: string;
} {
  const filePath = path.trim();
  const filename = filePath.split("/").pop() || filePath;
  const isExternal = filePath.startsWith("/") || filePath.startsWith("~");
  const encodePath = (p: string) => p.split("/").map((s) => encodeURIComponent(s)).join("/");
  const downloadUrl = isExternal
    ? `/api/external-files/${encodePath(filePath.replace(/^\//, "").replace(/^~\//, ""))}`
    : `/api/files/${encodePath(filePath)}`;
  return { filename, filePath: isExternal ? undefined : filePath, downloadUrl };
}

/**
 * Remark plugin: turns `[file: path]` markers and literal
 * `present_file(path="...")` text into `fileCard` nodes rendered inline
 * at their exact position — so agent-emitted file references always show
 * as cards where they were written, never as raw text.
 *
 * File cards are block-level (div): a second pass hoists them out of
 * paragraphs into `fileCardGroup` siblings so React never renders
 * <div> inside <p> (hydration error).
 */
export function remarkFileRefs() {
  return (tree: any) => {
    visit(tree, "text", (node: any, index: number | undefined, parent: any) => {
      if (!parent || typeof index !== "number" || typeof node.value !== "string") return;
      FILE_REF_RE.lastIndex = 0;
      const value: string = node.value;
      let m: RegExpExecArray | null;
      let last = 0;
      const children: any[] = [];
      let matched = false;
      while ((m = FILE_REF_RE.exec(value)) !== null) {
        matched = true;
        if (m.index > last) children.push({ type: "text", value: value.slice(last, m.index) });
        children.push({ type: "fileCard", path: (m[2] ?? m[3] ?? "").trim() });
        last = m.index + m[0].length;
      }
      if (!matched) return;
      if (last < value.length) children.push({ type: "text", value: value.slice(last) });
      parent.children.splice(index, 1, ...children);
      return index + children.length;
    });

    // Hoist fileCards out of paragraphs: split each affected paragraph
    // into text runs (stay in <p>) and card groups (own <div> siblings).
    visit(tree, "paragraph", (node: any, index: number | undefined, parent: any) => {
      if (!parent || typeof index !== "number" || !Array.isArray(node.children)) return;
      if (!node.children.some((c: any) => c?.type === "fileCard")) return;
      const out: any[] = [];
      let textRun: any[] = [];
      const flushText = () => {
        // Drop pure-whitespace runs (flex gap handles card spacing).
        const meaningful = textRun.filter(
          (c) => c.type !== "text" || (typeof c.value === "string" && c.value.trim() !== "")
        );
        if (meaningful.length) out.push({ type: "paragraph", children: textRun });
        textRun = [];
      };
      for (const c of node.children) {
        if (c?.type === "fileCard") {
          flushText();
          out.push({ type: "fileCardGroup", children: [c] });
        } else {
          textRun.push(c);
        }
      }
      flushText();
      parent.children.splice(index, 1, ...out);
      return index + out.length;
    });
  };
}

/** Renderer for `fileCard` nodes produced by remarkFileRefs. */
export function MdFileCardNode({ node }: any) {
  const path = typeof node?.path === "string" ? node.path : "";
  if (!path) return null;
  const props = fileCardPropsForPath(path);
  return <FileCard filename={props.filename} filePath={props.filePath} downloadUrl={props.downloadUrl} />;
}

/** Renderer for `fileCardGroup` wrappers (block-level card rows). */
export function MdFileCardGroupNode({ node }: any) {
  const cards = Array.isArray(node?.children) ? node.children : [];
  if (cards.length === 0) return null;
  return (
    <div className="my-2 flex flex-wrap items-center gap-2">
      {cards.map((c: any, i: number) => (
        <MdFileCardNode key={i} node={c} />
      ))}
    </div>
  );
}
