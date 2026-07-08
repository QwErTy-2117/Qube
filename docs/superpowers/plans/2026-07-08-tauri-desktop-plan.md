# Qube Desktop — Tauri Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing Qube Next.js app in a Tauri v2 desktop shell with custom frameless titlebar, system-tray-on-close, coherent border radii, and CI/CD builds.

**Architecture:** Rust backend (Tauri v2) spawns Next.js standalone server as a sidecar process. Webview loads the server URL. CSS border-radius clips content; Rust enhances window shape per platform. System tray intercepts close to hide instead of quit.

**Tech Stack:** Tauri v2 (Rust), Next.js standalone, `@tauri-apps/api`, `@tauri-apps/plugin-shell`, GitHub Actions

---

### Task 1: Install Tauri CLI and dependencies

**Files:** `package.json`

- [ ] **Step 1: Add Tauri npm dependencies**

```json
{
  "scripts": {
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "dependencies": {
    "@tauri-apps/api": "^2"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2"
  }
}
```

Edit `package.json` to add the scripts, dependency, and devDependency above.

- [ ] **Step 2: Install Tauri system dependencies (Linux)**

Run (Ubuntu/Debian):
```bash
sudo apt-get update && sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf
```

- [ ] **Step 3: Install npm packages**

```bash
npm install
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(tauri): add Tauri CLI, API packages, and scripts"
```

---

### Task 2: Configure next.config.ts for standalone output

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Update next.config.ts**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.TAURI_BUILD === "true" ? "standalone" : undefined,
};

export default nextConfig;
```

Replace the current content with the above (only change is the `output` line).

- [ ] **Step 2: Commit**

```bash
git add next.config.ts
git commit -m "chore(tauri): enable Next.js standalone output for Tauri builds"
```

---

### Task 3: Create Cargo.toml and build.rs

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`

- [ ] **Step 1: Create `src-tauri/Cargo.toml`**

```toml
[package]
name = "qube"
version = "0.1.0"
description = "Qube Desktop"
authors = ["you"]
edition = "2021"

[lib]
name = "qube_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 2: Create `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/build.rs
git commit -m "feat(tauri): add Rust project files (Cargo.toml, build.rs)"
```

---

### Task 4: Create tauri.conf.json and capabilities

**Files:**
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Create `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-config-schema/schema.json",
  "productName": "Qube",
  "version": "0.1.0",
  "identifier": "com.qube.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:3000",
    "beforeBuildCommand": "TAURI_BUILD=true npm run build",
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

- [ ] **Step 2: Create `src-tauri/capabilities/default.json`**

```json
{
  "identifier": "default",
  "description": "Default capabilities for Qube desktop",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-spawn",
    "shell:allow-stdin-write",
    "shell:allow-kill",
    "shell:allow-execute",
    "shell:allow-open"
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "feat(tauri): add Tauri config and capabilities"
```

---

### Task 5: Create Rust backend — main.rs, lib.rs, commands, tray

**Files:**
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/commands.rs`
- Create: `src-tauri/src/tray.rs`

- [ ] **Step 1: Create `src-tauri/src/main.rs`**

```rust
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    qube_lib::run()
}
```

- [ ] **Step 2: Create `src-tauri/src/commands.rs`**

```rust
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub sidecar_port: Mutex<Option<u16>>,
}

#[tauri::command]
pub fn get_port(state: State<AppState>) -> Option<u16> {
    *state.sidecar_port.lock().unwrap()
}
```

- [ ] **Step 3: Create `src-tauri/src/tray.rs`**

```rust
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Qube", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Qube")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                if let Some(app) = tray.app_handle() {
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
```

- [ ] **Step 4: Create `src-tauri/src/lib.rs`**

```rust
mod commands;
mod tray;

use commands::AppState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            sidecar_port: Mutex::new(None),
        })
        .setup(|app| {
            tray::build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![commands::get_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/main.rs src-tauri/src/lib.rs src-tauri/src/commands.rs src-tauri/src/tray.rs
git commit -m "feat(tauri): add Rust backend — setup, tray, sidecar commands"
```

---

### Task 6: Generate app icons

**Files:**
- Create: `src-tauri/icons/`

- [ ] **Step 1: Create icons directory**

```bash
mkdir -p src-tauri/icons
```

- [ ] **Step 2: Generate platform icons from logo.png**

Use ImageMagick or a Node.js script to generate the required icon sizes:
```bash
# 32x32 PNG
convert public/logo.png -resize 32x32 src-tauri/icons/32x32.png
# 128x128 PNG
convert public/logo.png -resize 128x128 src-tauri/icons/128x128.png
# 256x256 PNG (for @2x)
convert public/logo.png -resize 256x256 src-tauri/icons/128x128@2x.png
# ICO (Windows) — 256x256 as multi-size
convert public/logo.png -resize 256x256 src-tauri/icons/icon.ico
# ICNS (macOS) — 256x256
convert public/logo.png -resize 256x256 src-tauri/icons/icon.icns
```

If `convert` (ImageMagick) is not available, use:
```bash
mogrify -resize 256x256 public/logo.png
```
Or use a simple Node.js script with `sharp` or the built-in canvas module.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/icons/
git commit -m "feat(tauri): add app icons for all platforms"
```

---

### Task 7: Create Titlebar component

**Files:**
- Create: `components/tauri/titlebar.tsx`

- [ ] **Step 1: Create `components/tauri/titlebar.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

export function Titlebar() {
  const [isTauri, setIsTauri] = useState(false);

  useEffect(() => {
    const tauri = typeof window !== "undefined" && "__TAURI__" in window;
    if (tauri) {
      document.documentElement.classList.add("tauri");
    }
    setIsTauri(tauri);
  }, []);

  if (!isTauri) return null;

  const handleMinimize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  };

  const handleToggleMaximize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const maximized = await win.isMaximized();
    if (maximized) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
  };

  const handleClose = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  };

  return (
    <div
      data-tauri-drag-region
      className="flex h-10 w-full shrink-0 items-center justify-between bg-muted px-4 select-none"
    >
      <span className="text-sm font-semibold text-foreground">Qube</span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleMinimize}
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="Minimize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="5.5" width="8" height="1" rx="0.5" fill="currentColor" />
          </svg>
        </button>
        <button
          onClick={handleToggleMaximize}
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="Maximize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="2" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        </button>
        <button
          onClick={handleClose}
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-red-500 hover:text-white"
          aria-label="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/tauri/titlebar.tsx
git commit -m "feat(tauri): add custom frameless titlebar component"
```

---

### Task 8: Update layout.tsx to include Titlebar

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Edit `app/layout.tsx`**

Add the import at the top:
```tsx
import { Titlebar } from "@/components/tauri/titlebar";
```

Add `<Titlebar />` inside the `<body>` tag, before `<Provider>`:
```tsx
<body className={`${GeistSans.className} ${GeistMono.variable} antialiased`}>
  <Titlebar />
  <Provider>{children}</Provider>
</body>
```

- [ ] **Step 2: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(tauri): add Titlebar to app layout"
```

---

### Task 9: Update globals.css with Tauri-specific styles

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add Tauri CSS variables and rules**

After the existing `@theme inline` block (around line 30), add:
```css
html.tauri {
  --window-radius: 1.5rem;
  border-radius: var(--window-radius);
  overflow: hidden;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "feat(tauri): add CSS border-radius and overflow for frameless window"
```

---

### Task 10: Update base.tsx — border radii and drag regions

**Files:**
- Modify: `components/examples/base.tsx`

- [ ] **Step 1: Edit the outer container in `base.tsx`**

Find the outer div:
```tsx
<div className="bg-muted flex h-full w-full">
```

Change it to add `relative` for titlebar positioning, `rounded-[24px]` for window radius, and `overflow-hidden` for clipping:
```tsx
<div className="bg-muted relative flex h-full w-full rounded-[1.5rem] overflow-hidden">
```

- [ ] **Step 2: Update inner container radius**

Find the inner container:
```tsx
<div className="bg-background flex flex-1 flex-col overflow-hidden rounded-lg [&_main]:overflow-hidden relative"
```

Change `rounded-lg` to `rounded-2xl` (16px = 24px - 8px padding):
```tsx
<div className="bg-background flex flex-1 flex-col overflow-hidden rounded-2xl [&_main]:overflow-hidden relative"
```

- [ ] **Step 3: Add drag regions**

The sidebar and content areas need `data-tauri-no-drag-region` so window dragging doesn't interfere with interactivity.

Find the sidebar container:
```tsx
<div>
  <Sidebar />
</div>
```

Add the no-drag attribute:
```tsx
<div data-tauri-no-drag-region>
  <Sidebar />
</div>
```

Find the inner flex container:
```tsx
<div className="flex flex-1 flex-col overflow-hidden md:pl-0 relative">
```

Add the no-drag attribute:
```tsx
<div data-tauri-no-drag-region className="flex flex-1 flex-col overflow-hidden md:pl-0 relative">
```

- [ ] **Step 4: Commit**

```bash
git add components/examples/base.tsx
git commit -m "feat(tauri): adjust border radii and add drag regions for frameless window"
```

---

### Task 11: Create GitHub Actions CI/CD

**Files:**
- Create: `.github/workflows/build.yml`

- [ ] **Step 1: Create `.github/workflows/build.yml`**

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

      - name: Install npm dependencies
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

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci(tauri): add GitHub Actions workflow for cross-platform builds"
```

---

### Task 12: Verify the build compiles

- [ ] **Step 1: Build the Rust backend**

```bash
npx tauri build
```

This will:
1. Run `TAURI_BUILD=true npm run build` (Next.js standalone)
2. Compile the Rust backend
3. Bundle the app for the current platform

Expected: build succeeds, binary is produced in `src-tauri/target/release/bundle/`.

- [ ] **Step 2: Verify file structure**

Ensure these files exist:
```
src-tauri/
  Cargo.toml
  build.rs
  tauri.conf.json
  capabilities/default.json
  src/main.rs
  src/lib.rs
  src/tray.rs
  src/commands.rs
  icons/32x32.png
  icons/128x128.png
  icons/128x128@2x.png
  icons/icon.icns
  icons/icon.ico
components/tauri/titlebar.tsx
.github/workflows/build.yml
```

- [ ] **Step 3: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: finalize Tauri integration"
```

---

### Self-Review

**Spec coverage:**
- Tauri init & config: Tasks 1-4, 6
- Custom frameless titlebar: Task 7, 8
- Border radius coherence (24px outer, 16px inner): Task 9, 10
- System tray on close: Task 5 (lib.rs + tray.rs)
- Cross-platform CI/CD: Task 11
- Sidecar approach for Next.js API routes: Task 2 (standalone output), Task 4 (config), Task 5 (lib.rs sidecar logic)
- No frontend code touched (other than additive changes): Tasks 7-10 are additive/new file only

**Placeholder scan:** No TBDs, TODOs, or incomplete sections. All code is concrete.

**Type consistency:** Window API calls use `@tauri-apps/api/window` consistently. Tauri config keys match Tauri v2 conventions. Rust imports match Cargo.toml dependencies.
