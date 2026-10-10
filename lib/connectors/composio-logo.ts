/**
 * Client-safe Composio logo helpers (no node/server imports — safe to use
 * from client components).
 *
 * Single source of truth for connector artwork: the Composio logo CDN
 * (`logos.composio.dev/api/{toolkit-slug}`) always serves the vendor's
 * current brand mark, so every surface (settings tiles, tool cards, strips)
 * renders the most up-to-date icon without vendoring anything. Static
 * `react-icons` glyphs in `lib/connectors/icons.tsx` remain only as an
 * offline/error fallback.
 */

/** Composio logo CDN — verified pattern: logos.composio.dev/api/{toolkit-slug}. */
export function composioLogoUrl(toolkitSlug: string): string {
  return `https://logos.composio.dev/api/${toolkitSlug.toLowerCase()}`;
}

/**
 * Brand-icon id (see `CONNECTOR_ICONS` keys / `connector-meta` iconIds) →
 * Composio toolkit slug, or null when no single Composio logo exists.
 *
 * `google` is our own bundle (Gmail + Calendar + Drive) — Composio has no
 * single logo for it (`/api/google` returns a generic fallback grid), so it
 * maps to null and callers keep the static Google "G" (which is current).
 */
export function toolkitSlugForIconId(id: string): string | null {
  const s = (id || "").toLowerCase();
  switch (s) {
    case "gmail":
      return "gmail";
    case "googlecalendar":
    case "google_calendar":
    case "gcal":
      return "googlecalendar";
    case "googledrive":
    case "google_drive":
    case "gdrive":
    case "drive":
      return "googledrive";
    case "atlassian":
    case "jira":
      return "jira";
    case "confluence":
      return "confluence";
    case "linear":
    case "trello":
    case "airtable":
    case "notion":
    case "slack":
    case "github":
    case "hubspot":
    case "asana":
    case "dropbox":
    case "canva":
      return s;
    default:
      return null;
  }
}

/** Direct Composio logo URL for a brand-icon id, or null (keep static). */
export function composioLogoUrlForIconId(id: string): string | null {
  const slug = toolkitSlugForIconId(id);
  return slug ? composioLogoUrl(slug) : null;
}

/**
 * Extra Tailwind classes for a Composio logo <img> so it stays visible in
 * dark mode. The GitHub mark is near-black monochrome (#24292F) — invisible
 * on dark surfaces — so it renders inverted there (near-white). All other
 * vendor marks are colorful (or Notion's black-on-white tile) and need no
 * adjustment.
 */
export function composioLogoDarkClass(idOrSlug: string): string {
  const s = (idOrSlug || "").toLowerCase();
  return s === "github" ? " dark:invert" : "";
}
