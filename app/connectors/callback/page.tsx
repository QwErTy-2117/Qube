"use client";

import { useEffect } from "react";

export default function ConnectorCallback() {
  useEffect(() => {
    if (window.opener) {
      window.opener.postMessage({ type: "connector-auth-complete" }, "*");
    }
    window.close();
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen text-sm text-muted-foreground">
      Connection complete — you can close this tab.
    </div>
  );
}
