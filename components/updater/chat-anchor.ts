/**
 * Anchor update popups to the chat column, not the whole window.
 *
 * The thread viewport (`data-slot="aui_thread-viewport"`) is the chat
 * window: when the browser side panel opens, the viewport shrinks but a
 * `fixed left-1/2` popup would stay glued to the full window center (often
 * over the panel). These helpers center popups on the chat column instead,
 * following resizes/panel animation via ResizeObserver.
 */

export const CHAT_VIEWPORT_SELECTOR = '[data-slot="aui_thread-viewport"]';

/** Chat column center in viewport CSS px, or null when it can't be measured. */
export function chatColumnCenter(
  doc: Document | undefined,
  fallbackWidth?: number
): number | null {
  try {
    const el = doc?.querySelector(CHAT_VIEWPORT_SELECTOR);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) return Math.round(r.left + r.width / 2);
    }
  } catch {}
  if (typeof fallbackWidth === "number" && fallbackWidth > 0) {
    return Math.round(fallbackWidth / 2);
  }
  return null;
}
