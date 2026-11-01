/**
 * Link rewriting for /api/browser/view so in-iframe navigations stay inside
 * the proxy (and therefore observable via panel-url tracking).
 *
 * Rewrites navigational attributes to absolute proxy URLs, resolved against
 * the page's final URL:
 * - a[href], area[href] (stylesheet/icon links are left alone so assets load
 *   directly)
 * - form[action], button[formaction], input[formaction]
 * - iframe[src], frame[src], embed[src], object[data] — nested browsing
 *   contexts MUST route through the proxy too: loaded directly they carry
 *   the target's X-Frame-Options/frame-ancestors and the browser shows its
 *   built-in "refused to display in an embed" page (e.g. PhET sim iframes).
 *   Served from our origin they inherit our permissive frame-ancestors.
 * - meta[http-equiv=refresh] url=… part
 * Everything else (img/srcset/media/script src) is left untouched so assets
 * load straight from the real site (via the injected <base> tag) — media in
 * particular must stay direct (range requests, no 5MB buffering).
 * Non-navigational schemes (javascript:, mailto:, tel:, data:, #, …) are
 * never rewritten. JS-driven navigations (location.href, SPA routers) cannot
 * be rewritten — documented limitation.
 */

export type RewriteOpts = {
  /** Final page URL (after redirects) — relative links resolve against it. */
  pageUrl: string;
  /**
   * Absolute proxy prefix, e.g. "https://host/api/browser/view?url="
   * (target gets appended encoded). MUST be absolute: rewritten links share
   * the document with an injected `<base href>` pointing at the real site,
   * and root-relative proxy paths would resolve against the TARGET's origin
   * and escape the proxy (clicked links 404 on the real site).
   */
  proxyPrefix: string;
  /** Opaque panel token, appended as &panel= so hits are tracked. */
  panel?: string;
  /**
   * True when the document being served IS itself a subframe. Its links then
   * carry sub=1 as well, so their hits never pollute the panel's main-frame
   * tracking (the sidebar follows the top page, not subframes).
   */
  isSubframe?: boolean;
};

/** Query flag marking subframe loads: served, never panel-tracked. */
export const SUBFRAME_PARAM = "sub";

/** Matches proxy URLs from any prefix shape (absolute or legacy relative). */
function isAlreadyProxied(raw: string, opts: RewriteOpts): boolean {
  return raw.startsWith(opts.proxyPrefix) || raw.startsWith("/api/browser/view?url=");
}

const NAV_ATTRS: Array<{ selector: string; attr: string; kind: "link" | "form" | "embed" }> = [
  { selector: "a[href]", attr: "href", kind: "link" },
  { selector: "area[href]", attr: "href", kind: "link" },
  { selector: "form[action]", attr: "action", kind: "form" },
  { selector: "button[formaction]", attr: "formaction", kind: "form" },
  { selector: "input[formaction]", attr: "formaction", kind: "form" },
  { selector: "iframe[src]", attr: "src", kind: "embed" },
  { selector: "frame[src]", attr: "src", kind: "embed" },
  { selector: "embed[src]", attr: "src", kind: "embed" },
  { selector: "object[data]", attr: "data", kind: "embed" },
];

function isRewritable(raw: string): boolean {
  const v = raw.trim();
  if (!v || v.startsWith("#")) return false;
  const lower = v.toLowerCase();
  // Non-navigational schemes stay untouched.
  if (/^(javascript|mailto|tel|sms|data|blob|file|ftp|view-source):/.test(lower)) return false;
  return true;
}

export function toProxyUrl(target: string, opts: RewriteOpts, sub = false): string | null {
  if (!isRewritable(target)) return null;
  let absolute: URL;
  try {
    absolute = new URL(target, opts.pageUrl);
  } catch {
    return null;
  }
  if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return null;
  const proxied = `${opts.proxyPrefix}${encodeURIComponent(absolute.toString())}`;
  if (!opts.panel) return proxied;
  // sub=1 marks subframe loads: the whole document is a subframe, or this
  // URL is destined for an embed element. Either way the hit must never
  // overwrite the panel's main-frame URL (that feedback loop yanks the
  // entire view onto a subframe page).
  const flag = opts.isSubframe || sub ? `&${SUBFRAME_PARAM}=1` : "";
  return `${proxied}&panel=${encodeURIComponent(opts.panel)}${flag}`;
}

/**
 * GET forms submit by REPLACING the action URL's query with the field set —
 * which would drop our url=/panel= params. Preserve them as hidden inputs
 * (skipped when the form already defines same-named fields), and the route
 * merges extra fields back into the fetch target's query.
 */
function preserveFormTarget(form: HTMLFormElement, originalAction: string, opts: RewriteOpts): void {
  const method = (form.getAttribute("method") || "get").toLowerCase();
  if (method !== "get") return;
  const doc = form.ownerDocument;
  let absolute: URL;
  try {
    absolute = new URL(originalAction, opts.pageUrl);
  } catch {
    return;
  }
  if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return;
  if (!form.querySelector('[name="url"]')) {
    const input = doc.createElement("input");
    input.setAttribute("type", "hidden");
    input.setAttribute("name", "url");
    input.setAttribute("value", absolute.toString());
    form.appendChild(input);
  }
  if (opts.panel && !form.querySelector('[name="panel"]')) {
    const input = doc.createElement("input");
    input.setAttribute("type", "hidden");
    input.setAttribute("name", "panel");
    input.setAttribute("value", opts.panel);
    form.appendChild(input);
  }
  // Propagate the subframe flag so nested-doc form submits stay untracked.
  if (opts.isSubframe && !form.querySelector(`[name="${SUBFRAME_PARAM}"]`)) {
    const input = doc.createElement("input");
    input.setAttribute("type", "hidden");
    input.setAttribute("name", SUBFRAME_PARAM);
    input.setAttribute("value", "1");
    form.appendChild(input);
  }
}

/**
 * Runtime shim injected as the FIRST script of proxied pages. Static
 * rewriting cannot see elements created later by page JavaScript (rendered
 * link lists, "load more", menus, sim players injecting their <iframe> on
 * play, JS-built search forms). The shim patches href/src/data/action
 * property setters and setAttribute for a/area/iframe/frame/embed/object
 * plus form[action] and button/input[formaction] so runtime-created
 * navigations route through the proxy too. Embeds always carry sub=1 (by
 * definition nested — their hits must not overwrite main-frame tracking);
 * links and forms do not, so in-page clicks keep updating the sidebar URL
 * bar and history. Page JS navigating the MAIN frame directly
 * (location.href, SPA routers) is intentionally left alone.
 */
export function frameShimScript(proxyPrefix: string, panel?: string): string {
  const prefixJson = JSON.stringify(proxyPrefix);
  const panelJson = JSON.stringify(panel || "");
  return `(function(){var PREFIX=${prefixJson};var PANEL=${panelJson};function proxify(u,embed){try{if(!u||typeof u!=="string")return u;var t=u.trim();if(!t||t.charAt(0)==="#")return u;if(/^(javascript|mailto|tel|sms|data|blob|about|file|ftp|view-source):/i.test(t))return u;if(t.indexOf("/api/browser/view?url=")===0||t.indexOf(PREFIX)===0)return u;var abs=new URL(t,document.baseURI);if(abs.protocol!=="http:"&&abs.protocol!=="https:")return u;return PREFIX+encodeURIComponent(abs.toString())+(PANEL?"&panel="+encodeURIComponent(PANEL)+(embed?"&sub=1":""):"");}catch(e){return u;}}function patchSrc(proto,prop,embed){try{var d=Object.getOwnPropertyDescriptor(proto,prop);if(!d||!d.set||d.set.__qube__)return;var o=d.set;var w=function(v){return o.call(this,proxify(v,embed));};w.__qube__=true;Object.defineProperty(proto,prop,{configurable:true,enumerable:d.enumerable,get:d.get,set:w});}catch(e){}}function patchAttr(){try{if(Element.prototype.setAttribute.__qube__)return;var o=Element.prototype.setAttribute;var w=function(n,v){try{var tag=(this.tagName||"").toLowerCase();if(typeof n==="string"&&typeof v==="string"){var ln=n.toLowerCase();var isEmbed=(tag==="iframe"||tag==="frame"||tag==="embed")&&ln==="src";isEmbed=isEmbed||(tag==="object"&&ln==="data");var isLink=(tag==="a"||tag==="area")&&ln==="href";var isForm=(tag==="form"&&ln==="action")||((tag==="button"||tag==="input")&&ln==="formaction");if(isEmbed)v=proxify(v,true);else if(isLink||isForm)v=proxify(v,false);}}catch(e){}return o.call(this,n,v);};w.__qube__=true;Element.prototype.setAttribute=w;}catch(e){}}try{if(typeof HTMLAnchorElement!=="undefined")patchSrc(HTMLAnchorElement.prototype,"href",false);if(typeof HTMLAreaElement!=="undefined")patchSrc(HTMLAreaElement.prototype,"href",false);if(typeof HTMLIFrameElement!=="undefined")patchSrc(HTMLIFrameElement.prototype,"src",true);if(typeof HTMLFrameElement!=="undefined")patchSrc(HTMLFrameElement.prototype,"src",true);if(typeof HTMLEmbedElement!=="undefined")patchSrc(HTMLEmbedElement.prototype,"src",true);if(typeof HTMLObjectElement!=="undefined")patchSrc(HTMLObjectElement.prototype,"data",true);if(typeof HTMLFormElement!=="undefined")patchSrc(HTMLFormElement.prototype,"action",false);if(typeof HTMLButtonElement!=="undefined"&&"formAction" in HTMLButtonElement.prototype)patchSrc(HTMLButtonElement.prototype,"formAction",false);if(typeof HTMLInputElement!=="undefined"&&"formAction" in HTMLInputElement.prototype)patchSrc(HTMLInputElement.prototype,"formAction",false);patchAttr();}catch(e){}})();`;
}
export function rewriteMetaRefresh(content: string, opts: RewriteOpts): string {
  return content.replace(/url\s*=\s*(['"]?)([^'";]+)\1/i, (_m, q: string, u: string) => {
    const proxied = toProxyUrl(u.trim(), opts);
    return proxied ? `url=${q}${proxied}${q}` : _m;
  });
}

export function rewriteNavigations(doc: Document, opts: RewriteOpts): { rewroteLinks: number; rewroteForms: number; rewroteEmbeds: number } {
  let rewroteLinks = 0;
  let rewroteForms = 0;
  let rewroteEmbeds = 0;
  for (const { selector, attr, kind } of NAV_ATTRS) {
    // Selector-specific queries so each element is visited exactly once
    // (already-proxied http(s) URLs must never be re-wrapped).
    const els = doc.querySelectorAll(selector);
    for (const el of Array.from(els)) {
      // link[rel=stylesheet|icon|…] are assets, not navigations.
      if (el.tagName.toLowerCase() === "link") continue;
      const raw = el.getAttribute(attr);
      if (!raw) continue;
      // Never re-wrap an already-proxied URL.
      if (isAlreadyProxied(raw, opts)) continue;
      const proxied = toProxyUrl(raw, opts, kind === "embed");
      if (!proxied) continue;
      el.setAttribute(attr, proxied);
      if (kind === "form" && el.tagName.toLowerCase() === "form") {
        rewroteForms++;
        preserveFormTarget(el as HTMLFormElement, raw, opts);
      } else if (kind === "embed") {
        rewroteEmbeds++;
      } else rewroteLinks++;
    }
  }
  // Meta refresh navigation.
  for (const meta of Array.from(doc.querySelectorAll('meta[http-equiv]'))) {
    if ((meta.getAttribute("http-equiv") || "").toLowerCase() !== "refresh") continue;
    const content = meta.getAttribute("content");
    if (!content) continue;
    const next = rewriteMetaRefresh(content, opts);
    if (next !== content) {
      meta.setAttribute("content", next);
      rewroteLinks++;
    }
  }
  return { rewroteLinks, rewroteForms, rewroteEmbeds };
}
