/**
 * Shared text utilities for the single memory system.
 * One tokenizer/stemmer used by retrieval, dedupe, contradiction checks,
 * and the deterministic observer — so "prefers" matches "preference",
 * "moved" matches "move", etc.
 */

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "when", "where",
  "what", "which", "who", "whom", "this", "that", "these", "those", "am", "is",
  "are", "was", "were", "be", "been", "being", "have", "has", "had", "having",
  "do", "does", "did", "doing", "will", "would", "should", "could", "ought",
  "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your",
  "yours", "yourself", "yourselves", "he", "him", "his", "himself", "she",
  "her", "hers", "herself", "it", "its", "itself", "they", "them", "their",
  "theirs", "themselves", "of", "at", "by", "for", "with", "about", "into",
  "through", "during", "before", "after", "above", "below", "to", "from",
  "up", "down", "in", "out", "on", "off", "over", "under", "again",
  "further", "once", "here", "there", "all", "any", "both", "each", "few",
  "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own",
  "same", "so", "than", "too", "very", "can", "just", "don", "now", "ll",
  "re", "ve", "t", "s", "d", "m", "user", "users", "use", "used", "using",
  "also", "get", "got", "like", // "like" is a signal word; keep as stop for scoring stability? No — keep it meaningful.
]);

// "like" removed from stop set below (preference signal).
STOP.delete("like");

/** Tiny canonical synonym map: collapse related stems to one root. */
const SYNONYMS: Record<string, string> = {
  preferenc: "prefer",
  preferr: "prefer",
  favourit: "favorit",
  favour: "favor",
  Dob: "dob",
};

export function stem(raw: string): string {
  let w = raw.toLowerCase();
  if (w.length <= 3) return w;
  // possessives + plurals
  if (w.endsWith("'s")) w = w.slice(0, -2);
  if (w.endsWith("ies") && w.length > 5) w = w.slice(0, -3) + "y";
  else if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 5) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 4) w = w.slice(0, -1);
  // verb suffixes
  if (w.endsWith("ing") && w.length > 6) {
    const b = w.slice(0, -3);
    w = b.length >= 4 ? b : w;
  } else if (w.endsWith("ed") && w.length > 5) {
    w = w.slice(0, -2);
  }
  // preference -> prefer (so "prefers" ~ "preferences")
  if (w.startsWith("prefer")) w = "prefer";
  if (w.startsWith("favor")) w = "favor";
  if (w.startsWith("decid")) w = "decid";
  if (w.startsWith("deci")) w = "decid";
  const syn = SYNONYMS[w];
  if (syn) return syn;
  return w;
}

export function tokenizeStems(text: string): string[] {
  const out: string[] = [];
  for (const part of text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (!part || part.length < 2) continue;
    if (STOP.has(part)) continue;
    const s = stem(part);
    if (!s || s.length < 2 || STOP.has(s)) continue;
    out.push(s);
  }
  return out;
}

export function tokenSet(text: string): Set<string> {
  return new Set(tokenizeStems(text));
}

export function jaccardStems(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Normalized key for exact-dup detection. */
export function normalizeContent(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).join(" ").slice(0, 500);
}

/** True when the text contains a negation / override cue. */
const NEG_RE = /\b(don'?t|doesn'?t|no longer|not |never|n'?t\b|instead|switched|switched to|changed to|moved to|now |stopped|quit|rather)\b/i;
export function hasNegationOrOverride(text: string): boolean {
  return NEG_RE.test(text);
}

/** True when text is a negation mismatch vs the other (one negates, other doesn't). */
export function negationMismatch(a: string, b: string): boolean {
  const na = /\b(don'?t|doesn'?t|not |never|no longer|n'?t\b)\b/i.test(a);
  const nb = /\b(don'?t|doesn'?t|not |never|no longer|n'?t\b)\b/i.test(b);
  return na !== nb;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
