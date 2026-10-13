/**
 * Pure OpenUI message segmentation (no React/DOM imports — Node-safe).
 *
 * Splits an assistant reply into alternating prose and OpenUI program
 * segments. The OpenUI `<Renderer />` drops surrounding prose and renders
 * nothing for plain Markdown (verified via SSR), so the client must render
 * text segments as Markdown and only fenced programs via the Renderer.
 */

export type OpenUISegment =
  | { type: "text"; content: string }
  | { type: "openui"; code: string };

const FENCE_RE = /```\s*openui(-lang)?\b[^\n]*\n?/i;

const BARE_ROOT_RE = /(^|\n)\s*root\s*=\s*(Card|Stack)\s*\(/;

/**
 * Returns true when assistant text contains an OpenUI program:
 * - a fenced ```openui or ```openui-lang block (streaming: unclosed ok), or
 * - a bare `root = Card(` / `root = Stack(` program outside of fenced code
 *   blocks (inline mode fallback). Bare roots inside fenced samples (e.g. a
 *   reply discussing OpenUI syntax) stay plain Markdown so nothing is lost.
 */
export function containsOpenUI(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  if (FENCE_RE.test(text)) return true;
  const outsideFences = text.replace(/```[\s\S]*?(```|$)/g, "");
  return BARE_ROOT_RE.test(outsideFences);
}

/**
 * Split a fence-less reply around a bare `root = Card(` / `root = Stack(`
 * program (model skipped the fence). Leading prose stays a text segment so
 * the direct answer survives; everything from the root line on is code.
 * No bare root: returns a single text segment.
 */
export function splitBareRoot(text: string): OpenUISegment[] {
  if (!text || typeof text !== "string") return [];
  const match = BARE_ROOT_RE.exec(text);
  if (!match || match.index === undefined) return [{ type: "text", content: text }];
  const cut = match.index + (match[1] ? match[1].length : 0);
  return [
    { type: "text", content: text.slice(0, cut) },
    { type: "openui", code: text.slice(cut) },
  ];
}

/**
 * Split assistant text on ```openui(-lang) fences.
 * - Closed fences yield {type:"openui", code} without the fence markers.
 * - A trailing unclosed fence (still streaming) yields an openui segment
 *   with whatever code has arrived so far.
 * - Everything else yields {type:"text"} segments (may be empty — callers
 *   should skip blanks).
 * - No fences: returns a single text segment (or [] for empty input).
 */
export function splitOpenUISegments(text: string): OpenUISegment[] {
  if (!text || typeof text !== "string") return [];
  const segments: OpenUISegment[] = [];
  let rest = text;
  for (;;) {
    const openMatch = FENCE_RE.exec(rest);
    if (!openMatch || openMatch.index === undefined) {
      segments.push({ type: "text", content: rest });
      break;
    }
    const before = rest.slice(0, openMatch.index);
    segments.push({ type: "text", content: before });
    const afterOpen = rest.slice(openMatch.index + openMatch[0].length);
    const closeIndex = afterOpen.indexOf("```");
    if (closeIndex === -1) {
      // Unclosed fence — still streaming. Everything after the opener is code.
      segments.push({ type: "openui", code: afterOpen });
      break;
    }
    segments.push({ type: "openui", code: afterOpen.slice(0, closeIndex) });
    rest = afterOpen.slice(closeIndex + 3);
  }
  return segments;
}

/** Minimal shape of an OpenUI action event needed to brief the model. */
export type OpenUIActionEventLike = {
  humanFriendlyMessage: string;
  formState?: unknown;
};

/**
 * Brief the model about a user action inside a generated interface.
 * The click label alone (e.g. "Submit") means nothing without the form
 * values behind it, so both travel in the appended user turn.
 */
export function toModelMessage(event: OpenUIActionEventLike): string {
  const lines = [`User clicked: ${event.humanFriendlyMessage}`];
  if (event.formState !== undefined) {
    try {
      lines.push(`Form values: ${JSON.stringify(event.formState)}`);
    } catch {}
  }
  return lines.join("\n");
}
