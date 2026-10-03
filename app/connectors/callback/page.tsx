"use client";

import { useEffect, useState } from "react";
import { CircleCheck } from "lucide-react";

export default function ConnectorCallback() {
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    // Tell any opener (same-browser popup flows) that auth finished. The
    // desktop app detects completion by polling, so this is best-effort.
    try {
      window.opener?.postMessage({ type: "connector-auth-complete" }, "*");
    } catch {}
    try {
      const ch = new BroadcastChannel("qube-connectors");
      ch.postMessage({ type: "connector-auth-complete" });
      ch.close();
    } catch {}
    // Auto-close tabs that were opened by script; otherwise leave the
    // friendly message below ("you can now close this page").
    try {
      window.close();
    } catch {}
    const t = setTimeout(() => setClosed(true), 800);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-background p-8 text-center shadow-xl">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-500/10">
          <CircleCheck className="size-6 text-emerald-500" />
        </span>
        <h1 className="text-lg font-semibold tracking-tight">Connected</h1>
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
          Your app is now connected to Qube.
          {closed
            ? " You can now close this tab and return to Qube."
            : " Finishing up…"}
        </p>
        {closed && (
          <button
            type="button"
            onClick={() => window.close()}
            className="bg-muted hover:bg-muted/70 mt-5 h-9 w-full rounded-full text-sm font-medium transition-colors"
          >
            Close this tab
          </button>
        )}
      </div>
    </div>
  );
}
