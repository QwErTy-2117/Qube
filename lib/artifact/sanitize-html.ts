/**
 * Conservative HTML sanitizer + block splitter for converted documents.
 *
 * Document conversions (mammoth, pandoc, …) are untrusted input: a .docx can
 * carry links, forms and script fragments. Everything is inserted with
 * dangerouslySetInnerHTML, so it is rebuilt from an allow-list first.
 *
 * Implemented with a small deterministic tokenizer (no DOMParser) so the
 * same code path runs in the browser, in Node and in unit tests — there is
 * no "works differently on the server" gap.
 */

const ALLOWED_TAGS = new Set([
  "p", "div", "span", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "del", "sup", "sub", "mark", "small",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "blockquote", "pre", "code",
  "a", "img",
]);

const BLOCK_TAGS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table",
  "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "blockquote", "pre",
  "hr", "br", "img", "section", "article", "figure", "figcaption",
]);

/** Tags whose entire content must be dropped, not just the tag. */
const DROP_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math"]);

const VOID_TAGS = new Set(["br", "hr", "img", "col"]);

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeHref(value: string): string | null {
  const v = value.trim();
  if (/^(https?:|mailto:|#|\/)/i.test(v)) return v;
  return null;
}

function safeSrc(value: string): string | null {
  const v = value.trim();
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(v)) return v;
  if (/^(https?:|\/)/i.test(v)) return v;
  return null;
}

type Token =
  | { type: "open"; tag: string; attrs: Array<[string, string]>; selfClosing: boolean; raw: string }
  | { type: "close"; tag: string; raw: string }
  | { type: "text"; value: string; raw: string };

function parseAttrs(raw: string): Array<[string, string]> {
  const attrs: Array<[string, string]> = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    attrs.push([name, value]);
  }
  return attrs;
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html)) !== null) {
    if (m.index > lastIndex) {
      const value = html.slice(lastIndex, m.index);
      tokens.push({ type: "text", value, raw: value });
    }
    lastIndex = m.index + m[0].length;
    const [, closing, rawTag, rawAttrs, selfClose] = m;
    const tag = rawTag.toLowerCase();
    if (closing) tokens.push({ type: "close", tag, raw: m[0] });
    else tokens.push({ type: "open", tag, attrs: parseAttrs(rawAttrs), selfClosing: selfClose === "/", raw: m[0] });
  }
  if (lastIndex < html.length) {
    const value = html.slice(lastIndex);
    tokens.push({ type: "text", value, raw: value });
  }
  return tokens;
}

function keepAttr(tag: string, name: string, value: string): string | null {
  if (tag === "a" && name === "href") return safeHref(value);
  if (tag === "a" && name === "title") return escapeText(value);
  if (tag === "img" && name === "src") return safeSrc(value);
  if (tag === "img" && (name === "alt" || name === "width" || name === "height")) return escapeText(value);
  if ((tag === "td" || tag === "th") && (name === "colspan" || name === "rowspan")) {
    return /^\d{1,3}$/.test(value) ? value : null;
  }
  if (tag === "ol" && name === "start") return /^-?\d{1,6}$/.test(value) ? value : null;
  return null;
}

export function sanitizeHtml(input: string): string {
  const html = (input || "").slice(0, 4_000_000);
  if (!html) return "";
  const tokens = tokenize(html);
  const out: string[] = [];
  // Depth of a dropped subtree; while > 0 everything is ignored.
  let dropDepth = 0;
  let dropTag = "";

  for (const token of tokens) {
    if (dropDepth > 0) {
      if (token.type === "open" && token.tag === dropTag && !token.selfClosing) dropDepth += 1;
      else if (token.type === "close" && token.tag === dropTag) dropDepth = Math.max(0, dropDepth - 1);
      continue;
    }
    if (token.type === "text") {
      out.push(escapeText(token.value));
      continue;
    }
    if (token.type === "close") {
      if (ALLOWED_TAGS.has(token.tag) && !VOID_TAGS.has(token.tag)) out.push(`</${token.tag}>`);
      continue;
    }
    const { tag, attrs, selfClosing } = token;
    if (DROP_CONTENT.has(tag)) {
      if (!selfClosing) {
        dropDepth = 1;
        dropTag = tag;
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) continue; // drop the wrapper, keep the text
    const kept: string[] = [];
    let hasHref = false;
    for (const [name, value] of attrs) {
      if (name.startsWith("on")) continue;
      const safe = keepAttr(tag, name, value);
      if (safe !== null && safe !== "") {
        if (name === "href") hasHref = true;
        kept.push(`${name}="${safe.replace(/"/g, "&quot;")}"`);
      }
    }
    if (tag === "a") {
      if (!hasHref) continue; // a link without a safe target is just text
      kept.push('rel="noreferrer noopener"', 'target="_blank"');
    }
    const attrString = kept.length ? ` ${kept.join(" ")}` : "";
    out.push(VOID_TAGS.has(tag) || selfClosing ? `<${tag}${attrString}>` : `<${tag}${attrString}>`);
  }
  return out.join("");
}

/**
 * Split safe HTML into top-level blocks for pagination. Each block is a
 * complete, balanced fragment so a page can never cut a table row or a
 * bullet away from its list.
 */
export function htmlToBlocks(html: string): string[] {
  const safe = sanitizeHtml(html);
  if (!safe) return [];
  const blocks: string[] = [];
  let depth = 0;
  let current: string[] = [];

  const flush = () => {
    const joined = current.join("").trim();
    current = [];
    if (!joined) return;
    // Keep media-only blocks (an image can be a page of its own).
    if (joined.replace(/<[^>]*>/g, "").trim() || /<(img|hr)\b/i.test(joined)) blocks.push(joined);
  };

  for (const token of tokenize(safe)) {
    if (token.type === "text") {
      if (depth === 0) {
        const value = token.value.trim();
        if (value) blocks.push(`<p>${value}</p>`);
      } else {
        current.push(token.raw);
      }
      continue;
    }
    if (token.type === "open") {
      current.push(token.raw);
      if (VOID_TAGS.has(token.tag) || token.selfClosing) {
        if ((token.tag === "hr" || token.tag === "img") && depth === 0) flush();
      } else {
        depth += 1;
      }
      continue;
    }
    current.push(token.raw);
    depth = Math.max(0, depth - 1);
    if (depth === 0) flush();
  }
  flush(); // unbalanced trailing markup
  return blocks;
}

export function textToBlocks(text: string): string[] {
  const normalized = (text || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const chunks = normalized.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
  const blocks: string[] = [];
  for (const chunk of chunks) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(chunk);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${escapeText(heading[2])}</h${level}>`);
      continue;
    }
    const paragraphs: string[] = [];
    let buffer: string[] = [];
    const flush = () => {
      if (buffer.length) {
        paragraphs.push(`<p>${buffer.map((line) => escapeText(line)).join("<br>")}</p>`);
        buffer = [];
      }
    };
    for (const line of chunk.split("\n")) {
      if (line.trim() === "") flush();
      else buffer.push(line);
    }
    flush();
    blocks.push(paragraphs.join(""));
  }
  return blocks;
}

export function escapeHtml(value: string): string {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
