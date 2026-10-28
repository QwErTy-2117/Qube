"use client";

/**
 * Client-safe message conversion helpers (no node imports).
 * Rebuilds a plain AI SDK UIMessage from a ThreadMessage when bound inner
 * messages are unavailable (legacy snapshots, unbound content).
 */

import {
  mediaTypeFromFilename,
  parseAttachmentDataUrl,
} from "./attachments";

export function threadMessageToUIMessage(tm: any): any | null {
  if (!tm || typeof tm !== "object") return null;
  const role = tm.role;
  if (role !== "user" && role !== "assistant" && role !== "system") return null;
  const content = Array.isArray(tm.content) ? tm.content : [];
  const parts: any[] = [];
  for (const p of content) {
    if (!p || typeof p !== "object") continue;
    if ((p.type === "text" || p.type === "reasoning") && typeof p.text === "string") {
      parts.push({ type: p.type, text: p.text });
    } else if (p.type === "tool-call") {
      parts.push({ type: "text", text: `[tool: ${p.toolName ?? "unknown"}]` });
    } else if (p.type === "file" && typeof p.data === "string") {
      // Preserve sent attachments: otherwise a legacy/history round-trip drops
      // the data URL and the restored preview says no text is available.
      const filename = typeof p.filename === "string" ? p.filename : undefined;
      const parsed = parseAttachmentDataUrl(p.data);
      parts.push({
        type: "file",
        url: p.data,
        mediaType: p.mimeType || parsed?.mediaType || mediaTypeFromFilename(filename),
        ...(filename ? { filename } : {}),
      });
    } else if (p.type === "image" && typeof p.image === "string") {
      const filename = typeof p.filename === "string" ? p.filename : undefined;
      const parsed = parseAttachmentDataUrl(p.image);
      parts.push({
        type: "file",
        url: p.image,
        mediaType: p.mimeType || parsed?.mediaType || "image/png",
        ...(filename ? { filename } : {}),
      });
    } else if (typeof (p as any).text === "string") {
      parts.push({ type: "text", text: (p as any).text });
    } else if (typeof (p as any).content === "string" && (p as any).content.trim()) {
      parts.push({ type: "text", text: (p as any).content });
    }
  }
  if (parts.length === 0) return null;
  return {
    id: typeof tm.id === "string" ? tm.id : `m_${Date.now().toString(36)}`,
    role,
    parts,
  };
}

/** Plain-text extraction from UI-message or ThreadMessage parts. */
export function messageText(m: any): string {
  const parts = Array.isArray(m?.parts) ? m.parts : Array.isArray(m?.content) ? m.content : [];
  return parts
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
