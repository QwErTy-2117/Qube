"use client";

import { useEffect, useState } from "react";

const DEEP_LINK = "qube://connectors/callback";

export default function ConnectorCallback() {
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    const openedByScript = Boolean(window.opener);
    // Best-effort signals for popup/broadcast flows (web-only usage).
    try {
      window.opener?.postMessage({ type: "connector-auth-complete" }, "*");
    } catch {}
    try {
      const ch = new BroadcastChannel("qube-connectors");
      ch.postMessage({ type: "connector-auth-complete" });
      ch.close();
    } catch {}

    // Hand the auth result back to the desktop app instead of leaving the
    // user on a browser copy of the Qube interface. Qube registers the
    // `qube://` scheme and focuses its window when this fires (it also
    // polls connector status, so the connection appears immediately).
    const redirect = window.setTimeout(() => {
      try {
        window.location.replace(DEEP_LINK);
      } catch {}
    }, 300);

    // If the app is not installed (or the browser blocks the hand-off),
    // offer an explicit button rather than showing the full app UI.
    const fallback = window.setTimeout(() => setShowFallback(true), 1800);

    // A script-opened OAuth popup (web app) can close itself and return to
    // the chat tab. Desktop OAuth opens in the system browser (no opener),
    // where the `qube://` hand-off above focuses the app instead.
    const close = openedByScript
      ? window.setTimeout(() => {
          try {
            window.close();
          } catch {}
        }, 1200)
      : null;

    return () => {
      window.clearTimeout(redirect);
      window.clearTimeout(fallback);
      if (close !== null) window.clearTimeout(close);
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center p-6 font-sans text-sm text-neutral-600">
      <div className="text-center">
        <p>Connection complete.</p>
        <a
          href={DEEP_LINK}
          className="mt-3 inline-block rounded-full bg-neutral-900 px-4 py-2 text-xs font-medium text-white"
        >
          Return to Qube
        </a>
        {showFallback ? (
          <p className="mt-3 text-xs text-neutral-400">
            If Qube did not open, you can close this tab.
          </p>
        ) : null}
      </div>
    </main>
  );
}
