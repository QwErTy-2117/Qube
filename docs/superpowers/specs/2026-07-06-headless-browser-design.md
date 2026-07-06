# Headless Browser Integration for Qube AI Agent

**Date:** 2026-07-06
**Status:** Approved — ready for implementation

## Overview

Add full Playwright-based headless browser capabilities to the Qube AI agent. The agent gets ~20 tools for navigation, interaction, screenshots, and session management — enabling JS-heavy browsing, login flows, form interaction, and visual page capture.

## Architecture

### File Structure

```
lib/agent/browser/
  browser-manager.ts   — Singleton browser lifecycle, thread-isolated contexts, profile management
  browser-tools.ts     — All tool definitions, uses BrowserManager
  snapshot.ts          — Accessibility tree formatter (token-efficient page representation for LLM)
```

### Browser Manager (`browser-manager.ts`)

- **Singleton** — one Chromium process per server instance, lazy-launched on first tool call
- **Thread-isolated contexts** — each chat thread gets its own `BrowserContext` (isolated cookies, localStorage)
- **Profile persistence** — save/load named profiles to `.memory/browser-profiles/<name>/` as JSON
- **Idle timeout** — browser auto-closes after 5 minutes of inactivity
- **Crash recovery** — auto-restarts on next tool call if browser crashes

### Snapshot Strategy (`snapshot.ts`)

Convert the Playwright accessibility tree into a compact structured text representation (~200-400 tokens):

```
root "Page Title"
  ├── heading "Welcome" [ref=1]
  ├── link  "Learn more" → /about [ref=2]
  ├── textbox "Email" [ref=3]
  ├── button "Submit" [ref=4]
  └── img "Logo" [ref=5]
```

Elements are addressed by `ref` (numeric index) across all interaction tools — no CSS selectors or XPath required from the LLM.

## Tool Set (21 tools)

### Navigation
| Tool | Description |
|------|-------------|
| `browser_navigate(url)` | Navigate to URL. Returns page title and snapshot. |
| `browser_navigate_back()` | Go back in history. Returns snapshot. |
| `browser_reload()` | Reload current page. Returns snapshot. |
| `browser_wait_for(text/time)` | Wait for text to appear or a timeout. |

### Page Reading
| Tool | Description |
|------|-------------|
| `browser_snapshot()` | Get accessibility tree snapshot of current page. |
| `browser_take_screenshot(type, fullPage)` | Capture screenshot (PNG/JPEG). Returns base64 data URI. |

### Interaction
| Tool | Description |
|------|-------------|
| `browser_click(ref, button, modifiers)` | Click element by snapshot ref. |
| `browser_type(ref, text, submit)` | Type text into input. |
| `browser_fill_form(fields[])` | Fill multiple form fields at once. |
| `browser_hover(ref)` | Hover over element. |
| `browser_press_key(key)` | Press keyboard key. |
| `browser_select_option(ref, values[])` | Select dropdown option(s). |
| `browser_file_upload(ref, paths[])` | Upload files to a file input. |

### Tab Management
| Tool | Description |
|------|-------------|
| `browser_tabs(action, index, url)` | List, create, close, or select browser tabs. |

### Advanced
| Tool | Description |
|------|-------------|
| `browser_evaluate(js)` | Run JavaScript in page context. |
| `browser_console_messages(level)` | Get browser console logs. |
| `browser_network_requests(static, filter)` | Get network request log. |
| `browser_scroll(direction, amount)` | Scroll page by pixels or viewport. |

### Profile Management
| Tool | Description |
|------|-------------|
| `browser_save_profile(name)` | Save current session cookies+localStorage as named profile. |
| `browser_load_profile(name)` | Restore a saved profile. |
| `browser_list_profiles()` | List all saved profiles. |

## Data Flow

1. Agent calls `browser_navigate("https://...")`
2. Tool handler calls `BrowserManager.getPage(threadId)` — creates context+page if needed
3. Page navigates to URL
4. `snapshot.ts` generates accessibility tree
5. Tool returns structured result: `{ url, title, snapshot, status }`
6. Agent reads snapshot, decides next action (e.g., `browser_click(ref=4)`)
7. Tool handler finds element by ref and clicks it

## Profile System

- Profiles stored at `.memory/browser-profiles/<name>/cookies.json` and `.memory/browser-profiles/<name>/localStorage.json`
- Cookies via Playwright's `context.cookies()` / `context.addCookies()`
- localStorage via `page.evaluate("JSON.stringify(localStorage)")` / `page.evaluate("...")`
- Profiles persist across server restarts

## Stealth Configuration

```typescript
const LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=1280,720',
];

// Override navigator.webdriver
page.addInitScript("delete navigator.__proto__.webdriver;");
```

Upgradable to `playwright-extra` + stealth plugin if needed later.

## Error Handling

- **No page navigated yet** — interaction tools return `{ error: true, message: "No page loaded. Call browser_navigate first." }`
- **Stale ref** — if element not found, return updated snapshot so agent can re-evaluate
- **Timeout** — 30s default per action, configurable per tool
- **Browser crash** — manager detects, restarts silently, returns retryable error
- **Permissions** — all browser tools go through the existing `withPermissionCheck` middleware

## Integration

In `lib/agent/agent.ts`:

```typescript
import { createBrowserTools } from "./browser/browser-tools";

const browserTools = createBrowserTools(threadId);

tools: ({
  // ... existing tools ...
  ...browserTools,
}) as any,
```

## Relationship to Existing Tools

| Existing | Browser replacement? | Notes |
|----------|---------------------|-------|
| `web_search` | No | Still faster for text search |
| `web_fetch` | No | Still lighter for simple text extraction |
| `browser_*` | New | For JS-heavy sites, logins, forms, screenshots |

System prompt updated to guide when to use each.
