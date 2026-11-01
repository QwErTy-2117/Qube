/**
 * Per-panel current-URL tracking for the sidebar's fast iframe view.
 *
 * In-iframe link clicks navigate the iframe internally and are invisible to
 * the parent page (cross-origin). Because /api/browser/view rewrites page
 * links to route through the proxy, every such navigation hits the server —
 * which records the final URL here under the panel's opaque token. The panel
 * polls /api/browser/panel-url to learn the URL and keep its URL bar and
 * back/forward history in sync.
 */

const MAX_PANELS = 200;

const lastUrlByPanel = new Map<string, string>();

export function isValidPanelToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(token);
}

export function recordPanelUrl(panel: string, url: string): void {
  try {
    lastUrlByPanel.set(panel, url);
    // Bounded: evict oldest first.
    while (lastUrlByPanel.size > MAX_PANELS) {
      const oldest = lastUrlByPanel.keys().next().value as string | undefined;
      if (!oldest) break;
      lastUrlByPanel.delete(oldest);
    }
  } catch {}
}

export function recallPanelUrl(panel: string): string | null {
  try {
    return lastUrlByPanel.get(panel) ?? null;
  } catch {
    return null;
  }
}
