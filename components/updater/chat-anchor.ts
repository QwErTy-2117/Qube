/**
 * Anchor update/error popups to the chat column, not the whole window.
 *
 * The thread viewport (`data-slot="aui_thread-viewport"`) is the chat
 * window: when the browser side panel opens, the viewport shrinks but a
 * `fixed left-1/2` popup would stay glued to the full window center (often
 * over the panel). These helpers center popups on the chat column instead,
 * following resizes/panel animation via ResizeObserver.
 *
 * Exception: when a modal dialog (e.g. the settings popup) is open, the
 * dialog itself is centered on the whole screen, so popups center on the
 * whole screen too — i.e. centered to the popup.
 */

export const CHAT_VIEWPORT_SELECTOR = '[data-slot="aui_thread-viewport"]';
export const DIALOG_CONTENT_SELECTOR = '[data-slot="dialog-content"]';

/** True when any modal dialog (e.g. the settings popup) is open. */
export function isDialogOpen(doc: Document | undefined): boolean {
  try {
    return !!doc?.querySelector(DIALOG_CONTENT_SELECTOR);
  } catch {
    return false;
  }
}

/** Chat column center in viewport CSS px, or null when it can't be measured. */
export function chatColumnCenter(
  doc: Document | undefined,
  fallbackWidth?: number
): number | null {
  try {
    // If a dialog (e.g. the settings popup) is open it is centered on the
    // whole screen, so center popups on the whole screen too — i.e. centered
    // to the popup rather than the chat column behind it.
    if (doc?.querySelector(DIALOG_CONTENT_SELECTOR)) {
      if (typeof fallbackWidth === "number" && fallbackWidth > 0) {
        return Math.round(fallbackWidth / 2);
      }
      return null;
    }
  } catch {}
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
