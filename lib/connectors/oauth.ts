/** The provider signs in in a browser, but only desktop callbacks should
 * invoke the native app. Older links without a mode are desktop callbacks. */
export function connectorCallbackUrl(requestUrl: string, origin: string | null, referer: string | null, desktop: boolean): string {
  let base = new URL(requestUrl).origin;
  for (const candidate of [origin, referer]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") {
        base = url.origin;
        break;
      }
    } catch {
      // Fall back to the next available HTTP origin.
    }
  }
  const callback = new URL("/connectors/callback", base);
  callback.searchParams.set("mode", desktop ? "desktop" : "web");
  return callback.toString();
}

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Desktop OAuth must open in the system browser, never in the app webview. */
export async function openConnectorAuth(url: string): Promise<void> {
  if (isDesktopApp()) {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
