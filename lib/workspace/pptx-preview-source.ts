import JSZip from "jszip";

/**
 * The bundled `pptx-preview` renderer has two fidelity gaps that make decks
 * look like a different presentation:
 *
 * 1. It only reads `<a:ea>` (East Asian) typefaces. PowerPoint normally
 *    stores the Latin font in `<a:latin>` (Calibri, Cambria, Arial, …), so
 *    every run falls back to the surrounding app font (Geist Sans here).
 *    That changes text metrics, which in turn changes wrapping and layout.
 * 2. It resolves `<a:schemeClr>` to the theme's base colour but ignores
 *    DrawingML colour transforms (`lumMod`, `lumOff`, `shade`, `tint`,
 *    `satMod`, `hueOff`, …). Office themes use those constantly, so the
 *    preview shows a lighter/darker/wrong colour.
 *
 * We cannot patch the third-party bundle cleanly, so we normalise a copy of
 * the PPTX before handing it to the renderer:
 *
 * - `<a:schemeClr>` is rewritten to an explicit `<a:srgbClr>` with the
 *   transforms applied (alpha is preserved).
 * - `<a:latin>` gets a matching `<a:ea>` (unless one already exists), so the
 *   renderer's existing text code uses the real font.
 * - Theme font tokens (`+mn-lt`, `+mj-ea`, …) are resolved to concrete names.
 *
 * The original buffer is returned untouched when there is nothing to rewrite.
 */

export type PreparedPptx = {
  buffer: ArrayBuffer;
  majorFont: string | null;
  minorFont: string | null;
};

type ThemeInfo = {
  colors: Record<string, string>;
  majorFont: string | null;
  minorFont: string | null;
};

type ColorMap = Record<string, string>;

const THEME_COLOR_TAGS = [
  "dk1",
  "lt1",
  "dk2",
  "lt2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
] as const;

const DEFAULT_COLOR_MAP: ColorMap = {
  bg1: "lt1",
  tx1: "dk1",
  bg2: "lt2",
  tx2: "dk2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hlink: "hlink",
  folHlink: "folHlink",
};

const SCHEME_CLR_RE =
  /<a:schemeClr\b([^>]*?)(?:\/>|>([\s\S]*?)<\/a:schemeClr>)/g;
const LATIN_RE = /<a:latin\b([^>]*?)\/>/g;
const EA_EMPTY_RE = /<a:ea\b[^>]*?\btypeface=""[^>]*?\/>/g;
const LATIN_THEN_EMPTY_EA_RE =
  /<a:latin\b([^>]*?)\btypeface="([^"]*)"([^>]*?)\/>\s*<a:ea\b[^>]*?\btypeface=""[^>]*?\/>/g;
const EA_TYPEFACE_RE = /<a:ea\b([^>]*?)\btypeface="([^"]*)"([^>]*?)\/>/g;
const CLR_MAP_RE = /<p:clrMap\b([^>]*?)\/>/;
const CLR_MAP_OVERRIDE_RE = /<a:overrideClrMapping\b([^>]*?)\/>/;
const ATTR_RE = (name: string) => new RegExp(`\\b${name}="([^"]*)"`);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const part = (v: number) =>
    Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`.toUpperCase();
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function applyColorTransforms(hex: string, inner: string): string {
  let rgb = hexToRgb(hex);
  const transformRe = /<a:(\w+)\b[^>]*?\bval="([^"]+)"[^>]*?\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = transformRe.exec(inner))) {
    const tag = match[1];
    const raw = Number(match[2]);
    if (!Number.isFinite(raw)) continue;
    const val = raw / 100_000;
    switch (tag) {
      case "shade":
        rgb = { r: rgb.r * val, g: rgb.g * val, b: rgb.b * val };
        break;
      case "tint":
        rgb = {
          r: rgb.r * val + 255 * (1 - val),
          g: rgb.g * val + 255 * (1 - val),
          b: rgb.b * val + 255 * (1 - val),
        };
        break;
      case "satMod": {
        const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
        rgb = hslToRgb(h, s * val, l);
        break;
      }
      case "hueOff": {
        const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
        rgb = hslToRgb(h + raw / 60_000, s, l);
        break;
      }
      case "lumMod": {
        const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
        rgb = hslToRgb(h, s, l * val);
        break;
      }
      case "lumOff": {
        const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
        rgb = hslToRgb(h, s, l + val);
        break;
      }
      default:
        // alpha / alphaMod / alphaOff and colour-space transforms do not
        // affect the RGB value the renderer can display.
        break;
    }
  }
  return rgbToHex(rgb);
}

function parseColorMap(attrs: string | undefined, withDefaults = true): ColorMap {
  const map: ColorMap = withDefaults ? { ...DEFAULT_COLOR_MAP } : {};
  if (!attrs) return map;
  for (const key of Object.keys(DEFAULT_COLOR_MAP)) {
    const value = ATTR_RE(key).exec(attrs)?.[1];
    if (value) map[key] = value;
  }
  return map;
}

function parseTheme(themeXml: string): ThemeInfo | null {
  const scheme =
    /<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(themeXml)?.[1];
  if (!scheme) return null;

  const colors: Record<string, string> = {};
  for (const tag of THEME_COLOR_TAGS) {
    const block =
      new RegExp(`<a:${tag}\\b[^>]*>([\\s\\S]*?)<\\/a:${tag}>`).exec(scheme)?.[1] ||
      "";
    const srgb = /<a:srgbClr\b[^>]*\bval="([0-9a-fA-F]{6})"/.exec(block)?.[1];
    const sys = /<a:sysClr\b[^>]*\blastClr="([0-9a-fA-F]{6})"/.exec(block)?.[1];
    colors[tag] = srgb ? `#${srgb.toUpperCase()}` : sys ? `#${sys.toUpperCase()}` : "#000000";
  }

  const majorBlock =
    /<a:majorFont\b[^>]*>([\s\S]*?)<\/a:majorFont>/.exec(themeXml)?.[1] || "";
  const minorBlock =
    /<a:minorFont\b[^>]*>([\s\S]*?)<\/a:minorFont>/.exec(themeXml)?.[1] || "";

  return {
    colors,
    majorFont:
      /<a:latin\b[^>]*\btypeface="([^"]*)"/.exec(majorBlock)?.[1]?.trim() || null,
    minorFont:
      /<a:latin\b[^>]*\btypeface="([^"]*)"/.exec(minorBlock)?.[1]?.trim() || null,
  };
}

function resolveSchemeColor(
  val: string,
  theme: ThemeInfo | null,
  colorMap: ColorMap,
): string | null {
  if (!theme) return null;
  const mapped = colorMap[val] || val;
  return theme.colors[mapped] || theme.colors[val] || null;
}

function rewriteSchemeColors(
  xml: string,
  theme: ThemeInfo | null,
  colorMap: ColorMap,
): string {
  if (!theme) return xml;
  return xml.replace(SCHEME_CLR_RE, (match, attrs: string, inner = "") => {
    const val = ATTR_RE("val").exec(attrs)?.[1];
    if (!val) return match;
    const base = resolveSchemeColor(val, theme, colorMap);
    if (!base) return match;
    const color = applyColorTransforms(base, inner).replace(/^#/, "");
    const alpha = /<a:alpha\b[^>]*\/?>/.exec(inner)?.[0] || "";
    return `<a:srgbClr val="${color}">${alpha}</a:srgbClr>`;
  });
}

function resolveFontToken(typeface: string, theme: ThemeInfo | null): string {
  const token = typeface.trim();
  if (!theme) return token;
  if (token === "+mn-lt" || token === "+mn-ea") return theme.minorFont || token;
  if (token === "+mj-lt" || token === "+mj-ea") return theme.majorFont || token;
  return token;
}

function rewriteFonts(xml: string, theme: ThemeInfo | null): string {
  // `<a:latin typeface="Calibri"/><a:ea typeface=""/>` is common. Fill the
  // empty East Asian font with the Latin font so the renderer picks it up.
  xml = xml.replace(
    LATIN_THEN_EMPTY_EA_RE,
    (_match, before: string, typeface: string, after: string) => {
      const resolved = resolveFontToken(typeface, theme);
      if (!resolved || resolved.startsWith("+")) return _match;
      return `<a:latin${before}typeface="${typeface}"${after}/><a:ea${before}typeface="${resolved}"${after}/>`;
    },
  );

  // Drop empty `<a:ea>` elements; otherwise the renderer sees an explicit
  // empty font and leaves the text in the app font.
  xml = xml.replace(EA_EMPTY_RE, "");

  // Resolve theme-font tokens in any remaining `<a:ea>`.
  xml = xml.replace(
    EA_TYPEFACE_RE,
    (match, before: string, typeface: string, after: string) => {
      const resolved = resolveFontToken(typeface, theme);
      if (!resolved || resolved === typeface) return match;
      return `<a:ea${before}typeface="${resolved}"${after}/>`;
    },
  );

  // Finally, give every `<a:latin>` a matching `<a:ea>` so the renderer's
  // East-Asian lookup finds the real font for Latin text.
  return xml.replace(LATIN_RE, (match, attrs: string, offset: number) => {
    const typeface = ATTR_RE("typeface").exec(attrs)?.[1]?.trim() || "";
    if (!typeface) return match;
    const rest = xml.slice(offset + match.length);
    if (/^\s*<a:ea\b/.test(rest)) return match;
    const resolved = resolveFontToken(typeface, theme);
    if (!resolved || resolved.startsWith("+")) return match;
    return `<a:latin${attrs}/><a:ea${attrs.replace(
      /\btypeface="[^"]*"/,
      `typeface="${resolved}"`,
    )}/>`;
  });
}

async function firstEntry(
  zip: JSZip,
  pattern: RegExp,
): Promise<string | null> {
  const file = Object.values(zip.files)
    .filter((entry) => !entry.dir && pattern.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!file) return null;
  return file.async("string");
}

/**
 * Return a renderer-friendly copy of a `.pptx` plus the theme fonts so the
 * caller can set a sensible inherited font for runs without an explicit one.
 */
export async function preparePptxForPreview(
  buffer: ArrayBuffer,
): Promise<PreparedPptx> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const themeXml = await firstEntry(zip, /^ppt\/theme\/theme\d+\.xml$/);
    const theme = themeXml ? parseTheme(themeXml) : null;
    const masterXml = await firstEntry(
      zip,
      /^ppt\/slideMasters\/slideMaster\d+\.xml$/,
    );
    const masterMap = parseColorMap(CLR_MAP_RE.exec(masterXml || "")?.[1]);

    let changed = false;
    const entries = Object.values(zip.files).filter(
      (entry) => !entry.dir && /^ppt\/.+\.xml$/.test(entry.name),
    );

    for (const entry of entries) {
      const isFontPart =
        /^ppt\/(slides|slideLayouts|slideMasters|charts|diagrams)\//.test(
          entry.name,
        );
      let xml = await entry.async("string");
      const original = xml;

      const override = parseColorMap(
        CLR_MAP_OVERRIDE_RE.exec(xml)?.[1] || "",
        false,
      );
      const effectiveMap = { ...masterMap, ...override };

      xml = rewriteSchemeColors(xml, theme, effectiveMap);
      if (isFontPart) xml = rewriteFonts(xml, theme);

      if (xml !== original) {
        zip.file(entry.name, xml);
        changed = true;
      }
    }

    if (!changed) {
      return {
        buffer,
        majorFont: theme?.majorFont ?? null,
        minorFont: theme?.minorFont ?? null,
      };
    }

    return {
      buffer: await zip.generateAsync({
        type: "arraybuffer",
        compression: "DEFLATE",
      }),
      majorFont: theme?.majorFont ?? null,
      minorFont: theme?.minorFont ?? null,
    };
  } catch {
    // A malformed or unusual deck should still preview through the normal
    // renderer rather than failing the whole viewer.
    return { buffer, majorFont: null, minorFont: null };
  }
}

/**
 * Font stack for text that does not carry an explicit run font. The original
 * Office font name is first so fontconfig on Linux can substitute its
 * metric-compatible twin (Calibri→Carlito, Cambria→Caladea, Arial→Liberation
 * Sans, …), while Windows/macOS use the real font.
 */
export function pptxFontStack(font: string | null | undefined): string {
  const name = font?.trim() || "Calibri";
  const format = (candidate: string) =>
    /\s/.test(candidate) ? `"${candidate}"` : candidate;
  const fallbacks = ["Calibri", "Carlito", "Liberation Sans", "sans-serif"]
    .filter((candidate) => candidate.toLowerCase() !== name.toLowerCase())
    .map(format);
  return `"${name}", ${fallbacks.join(", ")}`;
}