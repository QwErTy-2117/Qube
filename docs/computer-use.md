# Computer use (controlling other desktop apps)

Qube's built-in browser handles websites. **Computer use** goes one step
further: it lets Qube operate the other applications on your computer —
clicking buttons, typing into forms, switching windows — the same way a
person would.

This capability is optional. Most people never need it: files, research,
browser tasks and connected apps already cover the common jobs.

## How it works

Qube uses the open-source [CUA Driver](https://github.com/trycua/cua) from
trycua/cua to read application windows through the operating system's
accessibility interfaces and perform keyboard and mouse actions. Qube talks
to the local CUA Driver daemon through its CLI (`cua-driver call …`), which
gives every chat a stable named session, typed actions, batching,
screenshots, and CUA's native cinematic agent cursor.

The Computer panel mirrors each real action from the delivered CUA
screenshot: an eased cursor travels to the exact interaction coordinates,
with click ripples, press squish, scroll feedback, typed-text keycaps and
drag paths. It is a live view of what the agent actually did — not a
simulation. Failed actions are shown in the status line and never animated.

## Install the driver

1. Install CUA Driver:

   ```bash
   curl -fsSL https://cua.ai/driver/install.sh | bash
   ```

   On Windows, download the release from the
   [CUA releases page](https://github.com/trycua/cua/releases) and put
   `cua-driver.exe` on `PATH` (or set `CUA_DRIVER_COMMAND`).

2. Run its doctor command and fix anything it reports:

   ```bash
   cua-driver doctor
   ```

3. **On macOS**, grant both **Accessibility** and **Screen Recording**
   permissions to CUA Driver when macOS prompts you. Without them, Qube can
   list apps but cannot see or interact with windows. On Linux, run Qube
   inside your graphical desktop session (Wayland uses the desktop portal);
   on Windows the doctor command covers the equivalent setup.

Qube starts the local daemon automatically (`cua-driver serve`) on first
use. Then ask Qube for something that needs a desktop app, for example:
*“open the PDF in my Downloads folder in Preview and zoom to page two.”*
If the driver is missing, Qube replies with the same install instructions
instead of failing silently.

## What Qube can do

- **Look without touching:** list apps and windows, read an app's visible
  state (its accessibility tree and a screenshot), capture the desktop,
  inspect the driver, and read the clipboard. These read-only actions never
  prompt and are allowed in background runs.
- **Act with approval:** click, right-click, type text, press keys or
  chords, set field values, scroll, drag, launch or activate an application,
  and write to the clipboard. Every mutating action pauses on an approval
  card describing the app and the action before anything happens.
- **Verify itself:** after a click it can re-read the window to confirm the
  screen actually changed, and retries with a fresh approach if it didn't.
- **Work in sequences:** observe-and-act steps are batched into one CUA
  `run_steps` call so element references stay valid and multiple actions
  stay fast.
- **Use background input by default:** CUA injects input without stealing
  focus where the platform supports it, and falls back to foreground input
  only when an app refuses background events. A `background_unavailable`
  error tells the model to retry once with `delivery_mode: "foreground"`.

Background runs — scheduled tasks and the periodic check-in — can only read.
Clicks and typing are refused when no interactive user is present to approve
them. A read-only sequence (for example `get_app_state`) is allowed.

## Browser vs. computer use

| | [Browser automation](./browser.md) | Computer use |
| --- | --- | --- |
| Targets | Websites in Qube's managed browser | Other desktop applications |
| Setup | Works out of the box (needs Chrome/Edge) | Requires the CUA Driver install |
| Watching it | Live Browser panel | Live Computer panel: real screen + animated cursor/actions |
| Approvals | Takeover for logins/captchas/payment | Approval card for every mutating action |

For files, Qube still prefers its own workspace and viewers rather than
driving a desktop file manager.

## Configuration

- `COMPUTER_USE_DISABLED=1` turns computer control off entirely.
- `CUA_DRIVER_COMMAND` overrides the driver command (a full command line is
  allowed, e.g. `cua-driver --profile work`).
- `COMPUTER_USE_COMMAND` is accepted as a backwards-compatible alias.
- `COMPUTER_USE_TIMEOUT_MS` adjusts the per-call timeout (default 60
  seconds).
- `CUA_DRIVER_AUTOSTART=0` prevents Qube from starting the daemon itself.
- `CUA_CURSOR_STYLE` (default `adaptive`), `CUA_CURSOR_TIMING` (default
  `fitts`), and `CUA_CURSOR_EFFECTS` (default
  `trail,glow,magnet,ripple,squish`; set `off` to disable) tune CUA's native
  agent cursor. `CUA_CURSOR_IDLE_HIDE_MS` defaults to `0` so the cursor
  stays visible while the agent works.

## Troubleshooting

- Run `cua-driver doctor` again and fix every reported item.
- On macOS, confirm Accessibility and Screen Recording permissions.
- On Linux, make sure `DISPLAY` or `WAYLAND_DISPLAY` is set for the process
  running Qube. A headless server cannot capture or control a desktop.
- If the daemon is not running, run `cua-driver serve` in a terminal; Qube
  also starts it automatically unless `CUA_DRIVER_AUTOSTART=0`.
- If an element action fails after the UI changed, read the app state again
  and use the new element index; stale tokens are rejected by CUA.
- More in [Troubleshooting](./troubleshooting.md).
