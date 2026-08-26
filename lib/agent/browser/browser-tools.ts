import { getBrowserUseTools } from "./browser-use-mcp";

/**
 * Browser tools — now powered by https://github.com/browser-use/browser-use
 * The old Playwright-based browser_* tools have been removed; only the
 * browser-use MCP tools are exposed. This keeps the agent's tool surface
 * identical to `uvx --from 'browser-use[cli]' browser-use --mcp`.
 *
 * Tool list from browser-use MCP (v0.21+):
 *  - retry_with_browser_use_agent
 *  - browser_navigate, browser_click, browser_type, browser_get_state
 *  - browser_scroll, browser_go_back
 *  - browser_list_tabs, browser_switch_tab, browser_close_tab
 *  - browser_extract_content
 *  - browser_list_sessions, browser_close_session, browser_close_all
 *
 * The threadId arg is kept for API compatibility but browser-use manages
 * its own session; we ignore it.
 */
export async function createBrowserTools(_threadId: string): Promise<Record<string, any>> {
  try {
    const tools = await getBrowserUseTools();
    if (Object.keys(tools).length === 0) {
      console.warn("[browser] browser-use MCP returned 0 tools — is browser-use installed? Run: uvx --from 'browser-use[cli]' browser-use --mcp");
    } else {
      console.log(`[browser] Loaded ${Object.keys(tools).length} browser-use tools:`, Object.keys(tools).join(", "));
    }
    return tools;
  } catch (e) {
    console.error("[browser] Failed to init browser-use MCP — is `uvx` and `browser-use[cli]` installed? Run: uv sync or `uvx --from 'browser-use[cli]' browser-use --mcp`", e);
    return {};
  }
}

// Keep a sync alias for any legacy callers that don't await
export function createBrowserToolsSync(_threadId: string): Record<string, any> {
  console.warn("[browser] createBrowserToolsSync is deprecated — use createBrowserTools (async) with browser-use");
  return {};
}
