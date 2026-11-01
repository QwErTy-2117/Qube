# Browser automation

For tasks that need a real website — checking opening hours, comparing
products, filling a form, tracking a parcel — Qube drives its own browser and
shows it to you in the **Browser panel** beside the chat. You watch every
page it visits and can take control whenever a human is needed.

## Requirements

Qube does not download a browser. It launches a Chromium-based browser already
on your system, in this order of preference:

1. A path set with the `CHROME_PATH` environment variable (advanced).
2. Google Chrome or Chromium from its standard install location.
3. Microsoft Edge on Windows (always present on a standard Windows install).
4. A Playwright-bundled Chromium, if one exists in its cache.

If none is available, browser tasks fail with a clear message. Install Google
Chrome or Chromium and try again. On Linux, `google-chrome`,
`google-chrome-stable`, `chromium` and Snap Chromium are all detected.

## What the browser looks like

The browser runs **headless by default** — there is no separate browser
window; the side panel *is* the browser window, streamed live over the Chrome
DevTools Protocol. Tabs and their cookies persist between tasks, so Qube can
pick up where it left off and stays signed in to sites you have logged into.

You can also click, scroll and type directly in the panel; input is forwarded
to the same browser Qube is driving.

## How Qube works a page

Qube prefers structured page tools over blind clicking:

1. **Navigate** to a URL.
2. **Snapshot** the page to get its text and numbered interactive elements
   (`e1`, `e2`, …), with passwords masked.
3. **Act** on those refs — click, fill, type.
4. If a page is canvas-based, refs are stale, or an element is missing, it
   falls back to **screenshot plus coordinate actions** in the same window.
5. It re-checks the page after navigation or a failed action instead of
   replaying uncertain clicks.

For known destinations it navigates directly (for example a site's search URL)
rather than typing into search boxes.

## When you need to take over

Qube handles public pages on its own, then hands control to you for anything
protected. When it hits a login, captcha, two-factor prompt, or payment step,
it pauses with a **takeover request** explaining why. You then:

1. Click into the Browser panel.
2. Complete the login, captcha, 2FA, or other human step yourself.
3. Confirm in Qube, and the task continues.

The takeover lease lasts fifteen minutes, which is enough for awkward logins.
Qube never asks you for passwords in the chat, and it does not store them —
the browser's own profile holds the session, just like a normal browser.

It also stops before anything final such as submitting an order or paying,
even when it has filled everything in.

## What the browser cannot do

- It cannot see or control other desktop applications. That is a separate,
  optional capability — see [Computer use](./computer-use.md).
- It does not open untrusted links from emails inside this signed-in browser;
  those are read as plain text instead. See
  [Web research](./web-research.md#links-in-emails-and-messages-are-treated-cautiously).
- It cannot defeat bot walls on its own; takeover or a headed window are the
  intended escape hatches.

## Advanced options

These environment variables matter mainly when
[running from source](./development.md); installed desktop users rarely need
them:

| Variable | Effect |
| --- | --- |
| `BROWSER_HEADED=1` (or `BROWSER_HEADLESS=0`) | Show a real operating-system browser window alongside the panel |
| `CHROME_PATH` | Absolute path to the Chrome/Chromium/Edge binary to launch |
| `BROWSER_CDP_PORT` | CDP port (default `9222`) |
| `BROWSER_MCP_DISABLED=1` | Turn off the built-in browser automation service |
| `BROWSER_MCP_COMMAND` / `BROWSER_MCP_ARGS_JSON` | Replace the built-in browser service with a custom command |

If browser tools report “connection closed” or fail to start, see
[Troubleshooting](./troubleshooting.md).
