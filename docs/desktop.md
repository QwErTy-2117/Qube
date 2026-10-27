# Desktop app details

Qube ships as a native desktop application built with [Tauri](https://tauri.app/).
A small Rust shell manages the window, tray and updates, while the actual
product — the chat interface and agent — runs in a local Next.js server
(called the **sidecar**) on `127.0.0.1:3010`, reachable only from your
machine. The app bundles its own Node.js runtime, so installing Qube does not
require Node.

## Supported platforms

| Platform | Architecture | Installer formats |
| --- | --- | --- |
| Windows | x64 (Intel/AMD) | NSIS `.exe` and `.msi` |
| Windows | ARM64 | NSIS `.exe` |
| macOS | Apple Silicon (M-series) | `.dmg` |
| macOS | Intel | `.app` (packaged as `.zip`) |
| Linux | x64 and ARM64 | `.deb` (Debian/Ubuntu) and `.rpm` (Fedora/RHEL/openSUSE) |

The current release matrix is built and published automatically from the
[Releases page](https://github.com/QwErTy-2117/Qube/releases).

## Updates

Qube checks for new releases itself and offers to install them in place
through the updater (the updater metadata is hosted on GitHub Releases):

- On Windows and macOS the download and install happen inside the app; Windows
  uses a passive install that prompts for permission as usual.
- On Linux, Qube hands the new package to your system package manager, so
  expect the normal administrator password prompt.
- You can also download the latest package manually and install it over the
  existing one — uninstalling first is not necessary.

The version in **Settings** comes from the installed desktop binary, so it
always reflects the app you are actually running even while the local server
is starting.

## Tray, window and background behavior

- A system-tray icon provides **Show window** and **Quit Qube**.
- Closing the window hides it by default; quitting from the tray fully exits.
- **Settings → Advanced → Startup & Background** offers two switches:
  - **Run on start** — launch Qube automatically when you log in (on Linux
    this creates a `~/.config/autostart/Qube.desktop` entry).
  - **Keep server running** — keep the local server alive with the window
    closed, so scheduled tasks and the periodic check-in continue to run.
- Connector sign-ins return to the app through a registered `qube://` deep
  link, which refocuses Qube after the browser OAuth step.

Remember that [automations](./automations.md) only run while Qube and its
server are active.

## Uninstalling

### Fedora / RHEL / openSUSE (RPM)

```bash
sudo dnf remove qube
```

Check what is installed with `rpm -q qube`.

### Debian / Ubuntu (DEB)

```bash
sudo apt remove qube
```

The package only removes files it installed. Two optional leftovers are worth
cleaning up by hand:

```bash
rm -f ~/.config/autostart/Qube.desktop    # only if you enabled Run on start
rm -rf /tmp/qube-sidecar                  # temporary copy of the local server
```

### Windows and macOS

Use the standard uninstall flow (Apps & features on Windows; drag Qube from
Applications to the Trash on macOS), then remove the data directory below if
you want a complete clean-up.

### Your data is kept on purpose

Chats, settings, memory, connected accounts and generated state live in the
[application data directory](./permissions-privacy.md#where-your-data-is-stored)
(`~/.local/share/com.qube.desktop` on Linux, `~/Library/Application Support/com.qube.desktop`
on macOS, `%APPDATA%\com.qube.desktop` on Windows) and survive both updates
and uninstalls. Delete that folder for a fully clean removal, or use
**Settings → Advanced → Hard reset** to wipe its contents without
uninstalling.

## Diagnostics

If the app shows a startup error, the local server writes a log to
`sidecar.log` inside the application data directory. It captures the sidecar's
stdout and stderr, including boot failures and browser/tool errors, and is
the first file to attach when reporting a problem. See
[Troubleshooting](./troubleshooting.md).
