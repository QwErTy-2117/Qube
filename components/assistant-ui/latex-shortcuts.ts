/**
 * Convert inline LaTeX shortcuts ($...$) that only contain well-known
 * symbols into their unicode equivalents so they render as text
 * (e.g. `$\rightarrow$` → `→`). Anything unrecognized is left untouched.
 * Code spans/blocks must be excluded by the caller (apply per text chunk
 * or before markdown parsing on non-code segments is overkill — instead we
 * skip matches inside backticks here).
 */

const SYMBOLS: Record<string, string> = {
  // Arrows
  rightarrow: "→", leftarrow: "←", uparrow: "↑", downarrow: "↓",
  leftrightarrow: "↔", Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔",
  mapsto: "↦", hookrightarrow: "↪", hookleftarrow: "↩", to: "→",
  updownarrow: "↕", Updownarrow: "⇕", nearrow: "↗", searrow: "↘",
  swarrow: "↙", nwarrow: "↖", longrightarrow: "⟶", longleftarrow: "⟵",
  // Operators & relations
  times: "×", div: "÷", pm: "±", mp: "∓", cdot: "⋅", ast: "∗", star: "★",
  neq: "≠", ne: "≠", approx: "≈", equiv: "≡", sim: "∼", cong: "≅",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", ll: "≪", gg: "≫",
  infty: "∞", partial: "∂", sum: "∑", prod: "∏", coprod: "∐", int: "∫",
  oint: "∮", propto: "∝", in: "∈", ni: "∋", notin: "∉", emptyset: "∅",
  varnothing: "∅", forall: "∀", exists: "∃", nexists: "∄", land: "∧",
  lor: "∨", lnot: "¬", neg: "¬", cap: "∩", cup: "∪", subset: "⊂",
  supset: "⊃", subseteq: "⊆", supseteq: "⊇", subsetneq: "⊊", supsetneq: "⊋",
  oplus: "⊕", ominus: "⊖", otimes: "⊗", oslash: "⊘", odot: "⊙",
  // Delimiters / misc
  langle: "⟨", rangle: "⟩", lceil: "⌈", rceil: "⌉", lfloor: "⌊", rfloor: "⌋",
  mid: "|", parallel: "∥", perp: "⊥", angle: "∠", degree: "°",
  prime: "′", ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱",
  dots: "…", hellip: "…", aleph: "ℵ", hbar: "ħ", ell: "ℓ",
  // Common sets
  N: "ℕ", Z: "ℤ", Q: "ℚ", R: "ℝ", C: "ℂ",
  // Greek lowercase
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ",
  rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ",
  upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  // Greek uppercase
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  // Text-ish
  copy: "©", reg: "®", trade: "™", sect: "§", para: "¶",
  dag: "†", ddag: "‡", bullet: "•", checkmark: "✓", cross: "✗",
  // Spacing (collapse to a single space / nothing)
  ",": " ", ";": " ", ":": " ", "!": "", quad: " ", qquad: "  ",
  // Escaped literals
  "%": "%", "&": "&", $: "$", _: "_",
};

// \text{...}, \mathrm{...} etc. → keep inner text.
const TEXT_WRAPPERS = new Set([
  "text", "mathrm", "mathit", "mathbf", "boldsymbol", "textbf", "textit",
  "textrm", "textsf", "texttt", "operatorname", "emph",
]);

function readBraced(s: string, i: number): [string, number] | null {
  // s[i] must be '{'; returns [inner, index-after-closing].
  if (s[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}") {
      depth--;
      if (depth === 0) return [s.slice(i + 1, j), j + 1];
    }
  }
  return null;
}

function convertInner(inner: string): string | null {
  let out = "";
  let i = 0;
  const n = inner.length;
  while (i < n) {
    const ch = inner[i];
    if (ch === "\\") {
      const m = /^\\([a-zA-Z]+|[^a-zA-Z\s])/.exec(inner.slice(i));
      if (!m) return null;
      const name = m[1];
      i += m[0].length;
      if (TEXT_WRAPPERS.has(name)) {
        while (inner[i] === " ") i++;
        const braced = readBraced(inner, i);
        if (!braced) return null;
        out += braced[0];
        i = braced[1];
        continue;
      }
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        while (inner[i] === " ") i++;
        const a = readBraced(inner, i);
        if (!a) return null;
        let j = a[1];
        while (inner[j] === " ") j++;
        const b = readBraced(inner, j);
        if (!b) return null;
        out += `${a[0]}/${b[0]}`;
        i = b[1];
        continue;
      }
      if (name === "sqrt") {
        while (inner[i] === " ") i++;
        if (inner[i] === "{") {
          const b = readBraced(inner, i);
          if (!b) return null;
          out += `√(${b[0]})`;
          i = b[1];
        } else {
          out += "√";
        }
        continue;
      }
      if (!(name in SYMBOLS)) return null;
      out += SYMBOLS[name];
      continue;
    }
    if (/\s/.test(ch)) {
      out += " ";
      while (i < n && /\s/.test(inner[i])) i++;
      continue;
    }
    // Bare characters pass through (letters/numbers/punctuation inside math).
    out += ch;
    i++;
  }
  return out.replace(/ {2,}/g, " ").trim();
}

/** Split out inline-code spans so `$` inside code is never touched. */
function splitCodeSpans(text: string): Array<{ code: boolean; text: string }> {
  const parts: Array<{ code: boolean; text: string }> = [];
  const re = /(`+)([\s\S]*?)\1/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ code: false, text: text.slice(last, m.index) });
    parts.push({ code: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) });
  return parts;
}

function convertSegment(segment: string): string {
  // \(...\) form
  segment = segment.replace(/\\\(([\s\S]*?)\\\)/g, (full, inner) => {
    if (/`/.test(inner)) return full;
    const converted = convertInner(String(inner));
    return converted === null || converted === "" ? full : converted;
  });
  // $...$ form (single-line only, to protect currency usage)
  segment = segment.replace(/\$([^$\n]+?)\$/g, (full, inner) => {
    const raw = String(inner);
    // Require at least one backslash command; plain $..$ stays untouched.
    if (!raw.includes("\\")) return full;
    if (/`/.test(raw)) return full;
    const converted = convertInner(raw);
    return converted === null || converted === "" ? full : converted;
  });
  return segment;
}

/** Render LaTeX shortcuts as unicode text. Safe to run on full markdown. */
export function renderLatexShortcuts(text: string): string {
  if (typeof text !== "string" || !text.includes("\\")) return text;
  return splitCodeSpans(text)
    .map((p) => (p.code ? p.text : convertSegment(p.text)))
    .join("");
}
