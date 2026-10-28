/**
 * A standalone browser hand-off, deliberately outside the React app shell.
 * The provider's result is verified by polling Composio in Qube, not by
 * trusting the browser callback or any query parameters it supplies.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  // Default to desktop for links initiated by older versions of Qube.
  const desktop = new URL(request.url).searchParams.get("mode") !== "web";
  const script = desktop
    ? `window.location.replace("qube://connectors/callback");`
    : `try { window.opener?.postMessage({ type: "connector-auth-complete" }, window.location.origin); } catch (_) {}
       try { const channel = new BroadcastChannel("qube-connectors"); channel.postMessage({ type: "connector-auth-complete" }); channel.close(); } catch (_) {}
       try { window.close(); } catch (_) {}`;
  const content = desktop
    ? `<p>Return to Qube to check your connection.</p><a href="qube://connectors/callback">Return to Qube</a><p class="hint">If Qube did not open, use the button above or switch back to the app.</p>`
    : `<p>Return to your Qube tab to check your connection.</p><p class="hint">You can close this tab.</p>`;

  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Return to Qube</title>
<style>body{font:14px system-ui,sans-serif;color:#404040;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}main{padding:24px}a{display:inline-block;background:#171717;color:white;border-radius:999px;padding:10px 18px;text-decoration:none}.hint{font-size:12px;color:#737373}</style></head>
<body><main>${content}</main><script>${script}</script></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
