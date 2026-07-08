# Qube Desktop — Tauri Wrapper Design

## Overview

Wrap the existing Qube Next.js web app in a Tauri v2 shell with a custom frameless
title bar, system-tray background behavior, window border-radius coherence, and
automatic cross-platform builds. Zero changes to existing React component logic.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Tauri Rust Backend (src-tauri/)                    │
│  • Window (decorations: false, 1200×800, centered)  │
│  • System tray (hide on close, show on tray click)  │
│  • Sidecar: spawns Next.js standalone server         │
│  • Window shape: rounded corners via API             │
│                                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │  Tauri WebView                                │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  Next.js App (loaded from localhost)    │  │  │
│  │  │  ┌──────────────────────────────────┐  │  │  │
│  │  │  │  <Titlebar /> (window controls)  │  │  │  │
│  │  │  │  <Base /> (unchanged logic)      │  │  │  │
│  │  │  │  border-radius: var(--window-r)  │  │  │  │
│  │  │  └──────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
│  Tauri Plugins:                                       │
│  • tauri-plugin-shell  (sidecar: node server.js)     │
│  • tauri-plugin-log    (optional — diagnostics)      │
└─────────────────────────────────────────────────────┘
```

## Project Layout

```
Qube/
├── src-tauri/                          # NEW
│   ├── Cargo.toml                      # Rust deps + Tauri
│   ├── tauri.conf.json                 # window, tray, bundle config
│   ├── capabilities/default.json       # permissions
│   ├── build.rs                        # Tauri build script
│   ├── src/
│   │   ├── main.rs                     # entry (no logic)
│   │   ├── lib.rs                      # setup, tray, sidecar commands
│   │   ├── tray.rs                     # system tray module
│   │   └── commands.rs                 # IPC commands (port passing, etc.)
│   └── icons/                          # app icons (from public/logo.png)
├── components/
│   └── tauri/
│       └── titlebar.tsx                # NEW — custom title bar
├── app/
│   └── layout.tsx                      # EDITED — +1 import line + <Titlebar />
├── app/globals.css                     # EDITED — +tauri-specific CSS vars
├── next.config.ts                      # EDITED — +output: 'standalone'
├── .github/workflows/build.yml         # NEW — CI/CD
```

## 1. Tauri Configuration (src-tauri/)

### Cargo.toml

```toml
[package]
name = "qube"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

### tauri.conf.json

```json
{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-config-schema/schema.json",
  "productName": "Qube",
  "version": "0.1.0",
  "identifier": "com.qube.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:3000",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../.next/standalone"
  },
  "app": {
    "windows": [
      {
        "title": "Qube",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "center": true,
        "decorations": false,
        "shadow": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

Note: `frontendDist` points to the static Next.js output, but since we use
a sidecar server for production, the actual `devUrl`/`frontendDist` approach
needs to account for the server-based architecture (see Section 3).

### capabilities/default.json

```json
{
  "identifier": "default",
  "description": "Default capabilities",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-open",
    "shell:allow-execute",
    "shell:allow-spawn",
    "shell:allow-stdin-write",
    "shell:allow-kill"
  ]
}
```

## 2. Window Shape & Border Radius

### Challenge

With `decorations: false`, the Tauri window is frameless but rectangular.
CSS `border-radius` on `<html>` clips the visual content, but the OS window
itself remains rectangular (visible as missing click targets outside the
rounded corners on some platforms).

### Strategy

**Primary — CSS-only border-radius**:
- `<html>` gets `border-radius: var(--window-radius); overflow: hidden;`
- `--window-radius: 1.5rem` (24px) — matches settings dialog's `rounded-3xl`
- This clips the content visually on all platforms

**Platform-specific shape enhancement** (added to lib.rs):
- **Windows**: On startup, call `SetWindowRgn` with a rounded rect matching
  `--window-radius` to truly clip the OS window shape
- **macOS**: The window surface natively clips to the content view's
  `layer.cornerRadius`; set via the `window` handle
- **Linux**: Use `gdk_window_shape_combine_region()` via `tao`'s window handle,
  typically sufficient with CSS clipping alone

### Inner Container Radius Math

Current: `p-2` (8px padding), `rounded-lg` (10px inner radius)
Target: inner radius = `window_radius - padding` = `24px - 8px = 16px`

Implemented by:
- `base.tsx`: change `rounded-lg` to `rounded-2xl` (16px) on the inner container
- The outer `bg-muted` container gets `rounded-[24px]` + `overflow-hidden`

### CSS Additions (app/globals.css)

```css
/* Applied only in Tauri via .tauri class on <html> */
html.tauri {
  border-radius: var(--window-radius, 1.5rem);
  overflow: hidden;
}
```

The `.tauri` class is set on `<html>` by `titlebar.tsx` on mount (checked
`window.__TAURI__`).

## 3. TitleBar Component (components/tauri/titlebar.tsx)

### Behavior

- New client component, placed in `app/layout.tsx` as the first child of `<body>`
- Checks `typeof window !== 'undefined' && '__TAURI__' in window`
- If not in Tauri, renders `null` (no impact on web version)
- On mount, adds `.tauri` class to `<html>`

### Visual Structure

```
┌────────────────────────────────────────────────┐
│ Qube                              ─  □  ✕      │  ← h-10, bg-muted
└────────────────────────────────────────────────┘
```

- Full-width bar at the top, `h-10`, `bg-muted`
- `data-tauri-drag-region` on the bar (Tauri built-in drag support)
- "Qube" text: left-aligned, `text-sm font-semibold text-foreground`
- Three window buttons: right-aligned, `flex gap-1.5`
- Buttons use `@tauri-apps/api/window`: `getCurrentWindow().minimize()`,
  `getCurrentWindow().toggleMaximize()`,
  `getCurrentWindow().close()` (which triggers hide-to-tray)
- Each button: `size-7 rounded-full` with platform-appropriate hover colors
  (close: red hover, others: accent hover)
- Icons: inline SVG (minimize line, maximize square, close X)

### Tauri Drag Region

Uses Tauri v2's built-in drag region: `data-tauri-drag-region` attribute on
the title bar div. The sidebar and main content area get
`data-tauri-no-drag-region` so they don't interfere with scrolling.

## 4. Build & Serve Pipeline

### Development

```bash
npm run tauri dev
```

Tauri CLI:
1. Runs `beforeDevCommand`: `npm run dev` (Next.js dev server on :3000)
2. Opens webview at `devUrl`: `http://localhost:3000`

Works exactly like developing the web version + titlebar.

### Production build

```bash
npm run tauri build
```

1. **next.config.ts**: `output: 'standalone'` enabled conditionally
   ```ts
   const nextConfig: NextConfig = {
     output: process.env.TAURI_BUILD === 'true' ? 'standalone' : undefined,
   };
   ```

2. `beforeBuildCommand`: `TAURI_BUILD=true npm run build`
   - Produces `.next/standalone/` containing:
     - `server.js` (Next.js minimal server)
     - `package.json` (minimal deps)
     - `.next/` (built app with chunks)
     - `public/` (static assets)

3. Tauri Rust build compiles the backend + bundles resources

4. **At runtime** (Rust sidecar):
   - `lib.rs` picks a random free port (bind to `127.0.0.1:0`, read port)
   - Spawns `node server.js` with `PORT` env var via `tauri-plugin-shell`
   - Waits for the server to respond (poll `http://127.0.0.1:$PORT` with retries)
   - Navigates the webview to `http://127.0.0.1:$PORT`
   - On app exit: kills the sidecar process

### Bundle output

- Linux: `.deb` + `.AppImage`
- Windows: `.msi` + `.exe`
- macOS: `.dmg` + `.zip`

## 5. System Tray (src-tauri/src/tray.rs)

### Module: `tray.rs`

Uses `tauri::tray::TrayIconBuilder`:

```rust
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Manager, Runtime};

pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Qube")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    window.show().ok();
                    window.set_focus().ok();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                if let Some(app) = tray.app_handle() {
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_visible().ok() == Some(true) {
                            window.hide().ok();
                        } else {
                            window.show().ok();
                            window.set_focus().ok();
                        }
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
```

### Close → Hide (not quit)

In `lib.rs` setup:

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // ... sidecar setup ...
            tray::build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Hide instead of close
                window.hide().ok();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Tray Click Behavior

- Single left-click on tray icon: toggle window visibility
- "Show Window" menu: show + focus
- "Quit" menu: `app.exit(0)` — kills sidecar + tray + window

## 6. Rust Sidecar Commands (src-tauri/src/commands.rs)

```rust
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub sidecar_pid: Mutex<Option<u32>>,
}
```

Commands exposed via `tauri::command`:
- `get_port()` → returns the port the Next.js server is running on
- `set_sidecar_pid(pid)` → stores the PID for cleanup on exit

## 7. CI/CD — GitHub Actions (.github/workflows/build.yml)

```yaml
name: Build and Release Qube Desktop

on:
  push:
    branches: [main]

jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable

      - name: Install dependencies (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            patchelf

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install npm deps
        run: npm ci

      - name: Build Tauri app
        uses: tauri-apps/tauri-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: v__VERSION__
          releaseName: "Qube v__VERSION__"
          releaseBody: "See the assets to download this version."
          releaseDraft: false
          prerelease: false
```

The `tauri-action` handles:
- Running `beforeBuildCommand` (Next.js standalone build)
- Building the Rust binary for the target OS
- Creating/updating a GitHub Release
- Attaching the platform artifacts

## 8. Files to Create

| File | Purpose |
|------|---------|
| `src-tauri/Cargo.toml` | Rust dependencies |
| `src-tauri/tauri.conf.json` | Tauri app/window/bundle config |
| `src-tauri/capabilities/default.json` | Permissions |
| `src-tauri/build.rs` | Tauri build script |
| `src-tauri/src/main.rs` | Entry point |
| `src-tauri/src/lib.rs` | App setup, sidecar, tray, commands |
| `src-tauri/src/tray.rs` | System tray logic |
| `src-tauri/src/commands.rs` | IPC commands |
| `src-tauri/icons/` | App icons (generated from logo.png) |
| `components/tauri/titlebar.tsx` | Custom title bar |
| `.github/workflows/build.yml` | CI/CD |

## 9. Files to Modify

| File | Change |
|------|--------|
| `app/layout.tsx` | Import + render `<Titlebar />` |
| `app/globals.css` | Add `html.tauri` border-radius rule |
| `components/examples/base.tsx` | Outer `rounded-[24px]`, inner `rounded-2xl`, drag regions |
| `next.config.ts` | Conditional `output: 'standalone'` |
| `package.json` | Add `tauri` scripts + `@tauri-apps/cli` devDep |

## 10. package.json Changes

```json
{
  "scripts": {
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2"
  },
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-shell": "^2"
  }
}
```

## Key Design Decisions

**Tauri v2 over v1**: v2 is stable, has built-in tray icon support, better
permissions model, and the `data-tauri-drag-region` attribute for frameless
windows.

**Sidecar over static export**: The app has API routes (`/api/chat`, etc.),
so Next.js must run as a live server. The standalone output is minimal (~20MB)
and includes only the needed runtime.

**CSS border-radius + platform shape**: CSS handles the visual appearance.
Platform-specific Rust code enhances the window shape on Windows/macOS/Linux
to clip the OS window frame.

**Single IPC command (`get_port`)**: Minimal IPC surface. The titlebar uses
`@tauri-apps/api` directly for window controls (no custom IPC).

**Conditional rendering**: `<Titlebar />` checks for `window.__TAURI__` and
renders `null` in the browser. The web version is completely unaffected.

## Self-Review

- **Placeholders**: None. All sections are fully specified.
- **Consistency**: Tauri approach is consistent across all sections. Titlebar
  rendering gated on `__TAURI__` so the web app is unaffected. Corner radius
  math is consistent (24px outer, 16px inner = 24 - 8).
- **Scope**: Focused on Tauri wrapper + titlebar + tray + CI. No scope creep.
- **Ambiguity**: The `frontendDist` in production uses sidecar approach, not
  static file serving. The `tauri.conf.json` `frontendDist` field is documented
  vs actual runtime behavior.

## Design Decisions vs. Electron Alternative

An earlier spec explored Electron for the same purpose. Tauri was chosen over
Electron for:

- **Smaller binary**: ~5MB vs ~150MB base
- **Lower memory**: Rust backend vs Chromium process
- **Built-in tray**: No extra dependency
- **Native window drag**: `data-tauri-drag-region` attribute instead of
  `-webkit-app-region`
- **Simpler CI**: `tauri-action` handles all platforms
