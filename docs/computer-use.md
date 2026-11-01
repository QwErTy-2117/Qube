# Computer use (controlling other desktop apps)

Qube's built-in browser handles websites. **Computer use** goes one step
further: it lets Qube operate the other applications on your computer —
clicking buttons, typing into forms, switching windows — the same way a
person would.

This capability is optional and switched off until you install a small
helper. Most people never need it: files, research, browser tasks and
connected apps already cover the common jobs.

## How it works

Qube uses the open-source [open-computer-use](https://github.com/iFurySt/open-codex-computer-use)
driver (the `ocu` command-line tool) to read application windows through the
operating system's accessibility interfaces and perform keyboard and mouse
actions.

## Install the driver

You need Node.js and npm on your machine (the Node runtime bundled inside the
Qube desktop app is private to Qube and is not on your system PATH).

1. Install the driver globally:

   ```bash
   npm i -g open-computer-use
   ```

2. Run its doctor command and fix anything it reports:

   ```bash
   ocu doctor
   ```

3. **On macOS**, grant both **Accessibility** and **Screen Recording**
   permissions to the terminal/app running the driver when macOS prompts you.
   Without them, Qube can list apps but cannot see or interact with windows.
   On Windows and Linux the doctor command covers the equivalent setup.

Then ask Qube for something that needs a desktop app, for example: *“open the
PDF in my Downloads folder in Preview and zoom to page two.”* If the driver
is missing, Qube replies with the same install instructions instead of
failing silently.

## What Qube can do

- **Look without touching:** list running and recent apps, and read an app's
  visible state (its accessibility tree and a screenshot). These read-only
  actions never prompt.
- **Act with approval:** click, right-click, type text, press keys, set field
  values, scroll, drag, launch or activate an application, and use the
  clipboard. Every one of these pauses on an approval card describing the app
  and the action before anything happens.
- **Verify itself:** after a click it can re-read the window to confirm the
  screen actually changed, and retries with a fresh approach if it didn't.
- **Work in sequences:** observe-and-act steps run together so element
  references stay valid.

Background runs — scheduled tasks and the periodic check-in — can only read.
Clicks and typing are refused when no interactive user is present to approve
them.

## Browser vs. computer use

| | [Browser automation](./browser.md) | Computer use |
| --- | --- | --- |
| Targets | Websites in Qube's managed browser | Other desktop applications |
| Setup | Works out of the box (needs Chrome/Edge) | Requires the `ocu` driver install |
| Watching it | Live Browser panel | Screenshots and app state in activity cards |
| Approvals | Takeover for logins/captchas/payment | Approval card for every mutating action |

For files, Qube still prefers its own workspace and viewers rather than
driving a desktop file manager.

## Turning it off and troubleshooting

- Disable the feature entirely with the environment variable
  `COMPUTER_USE_DISABLED=1` (for source/self-hosted runs).
- `COMPUTER_USE_COMMAND` overrides the driver command, and
  `COMPUTER_USE_TIMEOUT_MS` adjusts its timeout (default 60 seconds).
- If actions fail, run `ocu doctor` again, confirm the macOS permissions, and
  make sure the target app is actually in the foreground. More in
  [Troubleshooting](./troubleshooting.md).
