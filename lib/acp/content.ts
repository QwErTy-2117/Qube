/**
 * ACP ContentBlock <-> UIMessage conversion.
 *
 * Baseline support: text + resource_link (required by spec).
 * Best-effort: resource (embedded), image (via promptCapabilities.image).
 * Audio is acknowledged but downgraded to a placeholder note since the
 * underlying chat models have no audio input path.
 */

type AnyRecord = Record<string, unknown>;

function textOfBlock(b: AnyRecord): string | null {
  if (b.type === "text" && typeof b.text === "string") return b.text as string;
  return null;
}

function describeResourceLink(b: AnyRecord): string {
  const uri = (b.uri as string) || (b.url as string) || "unknown";
  const name = (b.name as string) || uri;
  return `[@${name}](${uri})`;
}

function describeEmbeddedResource(b: AnyRecord): string {
  try {
    const res = b.resource as AnyRecord | undefined;
    const uri = (res?.uri as string) || (b.uri as string) || "embedded-resource";
    const text = (res?.text as string) || "";
    const blob = text ? `:\n\`\`\`\n${String(text).slice(0, 20000)}\n\`\`\`` : "";
    return `Embedded resource ${uri}${blob}`;
  } catch {
    return "Embedded resource (unreadable)";
  }
}

/**
 * Convert ACP prompt blocks to a single user UIMessage.
 * Returns { message, images } — images are data URLs for model input.
 */
export function acpPromptToUIMessage(prompt: AnyRecord[]): {
  message: AnyRecord;
  warnings: string[];
} {
  const warnings: string[] = [];
  const textParts: string[] = [];
  const parts: AnyRecord[] = [];

  for (const b of prompt) {
    const t = textOfBlock(b);
    if (t !== null) {
      textParts.push(t);
      parts.push({ type: "text", text: t });
      continue;
    }
    if (b.type === "resource_link") {
      const desc = describeResourceLink(b);
      textParts.push(desc);
      parts.push({ type: "text", text: desc });
      continue;
    }
    if (b.type === "resource") {
      const desc = describeEmbeddedResource(b);
      textParts.push(desc);
      parts.push({ type: "text", text: desc });
      continue;
    }
    if (b.type === "image") {
      const data = b.data as string | undefined;
      const mimeType = (b.mimeType as string) || "image/png";
      if (data) {
        parts.push({ type: "file", mediaType: mimeType, url: `data:${mimeType};base64,${data}` });
        textParts.push("[image attached]");
      } else {
        warnings.push("Image block without data ignored");
      }
      continue;
    }
    if (b.type === "audio") {
      warnings.push("Audio blocks are not supported by the chat model; noted as placeholder");
      textParts.push("[audio input omitted — not supported]");
      parts.push({ type: "text", text: "[audio input omitted — not supported]" });
      continue;
    }
    warnings.push(`Unknown content block type "${(b as AnyRecord).type}" stringified`);
    textParts.push(`\`\`\`json\n${JSON.stringify(b).slice(0, 4000)}\n\`\`\``);
  }

  return {
    message: {
      role: "user",
      parts,
    },
    warnings,
  };
}

/** Extract plain text from a UIMessage-ish object (for transcripts/titles). */
export function extractUiText(m: AnyRecord): string {
  const parts = m.parts as AnyRecord[] | undefined;
  if (Array.isArray(parts) && parts.length > 0) {
    return parts
      .map((p) => {
        if (typeof p.text === "string") return p.text as string;
        if (p.type === "tool-call") return `[tool call: ${p.toolName}]`;
        if (p.type === "tool-result") return `[tool result: ${p.toolName}]`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof m.content === "string") return m.content;
  return "";
}

/** Join prompt blocks to plain text (titles, logs). */
export function acpPromptToText(prompt: AnyRecord[]): string {
  return prompt
    .map((b) => {
      if (b.type === "text") return (b.text as string) || "";
      if (b.type === "resource_link") return describeResourceLink(b);
      if (b.type === "resource") return describeEmbeddedResource(b).slice(0, 500);
      if (b.type === "image") return "[image]";
      if (b.type === "audio") return "[audio]";
      return JSON.stringify(b).slice(0, 200);
    })
    .join("\n");
}
