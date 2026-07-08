# Qube Desktop — Electron Wrapper Design

## Overview

Wrap the existing Qube Next.js web app in an Electron shell with a custom frameless
title bar, system-tray background behavior, and automatic cross-platform builds.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Electron Main Process (main.js)                 │
│  • BrowserWindow (frameless, transparent)        │
│  • System tray (hide→tray on close)              │
│  • Spawns Next.js server child process           │
│                                                   │
│  ┌────────────────────────────────────────────┐  │
│  │  Web Contents                              │  │
│  │  ┌──────────────────────────────────────┐  │  │
│  │  │  Next.js Standalone Server (prod)    │  │  │
│  │  │  or Next.js Dev Server (dev)         │  │  │
│  │  │                                       │  │  │
│  │  │  ┌────────────────────────────────┐  │  │  │
│  │  │  │  React App (unchanged except   │  │  │  │
│  │  │  │  base.tsx ~8 line changes)     │  │  │  │
│  │  │  │  + TitleBar component          │  │  │  │
│  │  │  └────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  Preload Script (preload.js)                      │
│  • contextBridge exposes: closeToTray, minimize   │
│  • IPC channel: close-to-tray, minimize           │
└──────────────────────────────────────────────────┘
```

## Project Layout

```
Qube/
├── electron/
│   ├── main.js          ← Electron main process
│   ├── preload.js       ← contextBridge API
│   └── tray.js          ← system tray module
├── components/
│   └── shared/
│       └── title-bar.tsx    ← NEW: notch + X button
├── components/examples/base.tsx  ← ~8 lines changed
├── next.config.ts                        ← +output: standalone for prod
├── app/globals.css                       ← +electron-specific overrides
├── electron-builder.yml                  ← NEW: electron-builder config
├── .github/workflows/release.yml         ← NEW: CI/CD
├── package.json                          ← +electron scripts/deps, +main field
```

## 1. Electron Main Process (`electron/main.js`)

### Window
- `BrowserWindow` with `frame: false`, `transparent: true`, `show: false`
- Size: `1200x800`, minWidth: `800`, minHeight: `600`
- `webPreferences.preload`: path to `electron/preload.js`
- `webPreferences.contextIsolation: true`, `nodeIntegration: false`
- On `ready-to-show`, window is shown

### Transparent window & border-radius
- `transparent: true` lets the background CSS border-radius clip the window
- The rendered page has `html { border-radius: 24px; overflow: hidden; }`
- Electron clips the window shape to the HTML's border-radius automatically
- On Windows: `backgroundMaterial: 'mica'` is NOT used (we use transparent + CSS)
- On Linux and macOS: transparent windows work natively
- A `1px` solid border is drawn via CSS to simulate the window border on all platforms

### Starting Next.js
- **Production**: `next build` with `output: 'standalone'` produces `/.next/standalone/`.
  Electron forks `node server.js --port=3456` from the standalone directory.
  Waits for `http://localhost:3456` to respond, then loads the URL.
- **Development**: If `QUBE_DEV=true` env, loads `http://localhost:3000` (user runs
  `npm run dev` separately).
- The Next.js server port is configurable via env `QUBE_PORT` (default 3456).

### System Tray
- `tray.js` module creates a `Tray` with a 16x16 icon (the existing logo)
- `tray.setToolTip('Qube')`
- Context menu: "Show Qube" → `win.show()` + `win.focus()`; "Quit" → full exit
- `tray.on('click')` → toggle window visibility
- When the window is shown, tray icon is in normal state
- On `win.on('close')`: if NOT quitting, `win.hide()` instead of `win.destroy()`
- A global `isQuitting` flag set by the "Quit" menu item prevents `hide()` on quit

### IPC (via preload)
- `close-to-tray` channel: `win.hide()`
- `minimize` channel: `win.minimize()`

## 2. Preload Script (`electron/preload.js`)

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  closeToTray: () => ipcRenderer.send('close-to-tray'),
  minimize: () => ipcRenderer.send('minimize'),
  isDesktop: true,
  platform: process.platform, // 'linux' | 'win32' | 'darwin'
});
```

TypeScript declaration (`electron/electron.d.ts`):

```ts
interface ElectronAPI {
  closeToTray: () => void;
  minimize: () => void;
  isDesktop: boolean;
  platform: NodeJS.Platform;
}

interface Window {
  electronAPI?: ElectronAPI;
}
```

## 3. TitleBar Component (`components/shared/title-bar.tsx`)

### Visual structure — placed inside the outer `bg-muted` container

```
┌─────────────────────────────────╥──┐
│ bg-muted (rounded-[24px])      ║✕ ║  ← notch: bg-muted
│  ┌──┐ ┌────────────────────┐   ║  ║  bottom-left corner: rounded-bl-xl
│  │  │ │ bg-background      │   └──╜
│  │s │ │ (rounded-2xl=16px) │
│  │i │ │                     │
│  │d │ │                     │
│  │e │ │                     │
│  │  │ │                     │
│  └──┘ └─────────────────────┘
└────────────────────────────────────┘
```

### The notch
- `absolute top-0 right-0 w-10 h-7 bg-muted rounded-bl-xl flex items-center justify-center z-50`
- The curved bottom-left corner of the notch (`rounded-bl-xl` = 12px) gives it the "notch" look
- The notch sits at the right edge, slightly overlapping the outer container's curved corner
- `rounded-[24px]` on the parent + `overflow-hidden` clips both the outer container and the
  notch to the smooth outer curve

### X button inside the notch
- `size-5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-muted-foreground flex items-center justify-center transition-colors`
- Renders an SVG X icon (simple path: two crossed lines, 10px, centered)
- On click: `window.electronAPI?.closeToTray()`
- The hover circle effect mirrors the settings dialog close button style
- Uses `-webkit-app-region: no-drag` so window dragging doesn't interfere

- The component conditionally renders ONLY when `window.electronAPI?.isDesktop` is true,
  so it doesn't appear in the browser.

## 4. base.tsx Changes

Current:
```tsx
<div className="bg-muted flex h-full w-full">
  <div><Sidebar /></div>
  <div className="flex flex-1 flex-col overflow-hidden p-2 md:pl-0">
    <div className="bg-background flex flex-1 flex-col overflow-hidden rounded-lg">
```

New:
```tsx
<div className="bg-muted relative flex h-full w-full rounded-[24px] overflow-hidden select-none"
     style={{ WebkitAppRegion: 'drag' as any }}>
  <TitleBar />
  <div><Sidebar /></div>
  <div className="flex flex-1 flex-col overflow-hidden p-2 md:pl-0"
       style={{ WebkitAppRegion: 'no-drag' as any }}>
    <div className="bg-background flex flex-1 flex-col overflow-hidden rounded-2xl">
```

Key changes:
1. `rounded-[24px]` on the outer container
2. `overflow-hidden` to clip children
3. `relative` for absolute-positioned TitleBar
4. `select-none` to prevent accidental text selection during drag
5. `WebkitAppRegion: 'drag'` on the outer container for window dragging
6. `WebkitAppRegion: 'no-drag'` on the content area
7. Inner container `rounded-lg` → `rounded-2xl` (= 24px - 8px padding)
8. `<TitleBar />` rendered inside the outer div but outside the inner containers

## 5. CSS Overrides (`app/globals.css` additions)

```css
/* Applied only in Electron (body[data-electron]) */
body[data-electron] {
  border-radius: 24px;
  overflow: hidden;
}

/* Window border — 1px matching bg-muted border */
.electron-window-border {
  position: fixed;
  inset: 0;
  pointer-events: none;
  border: 1px solid hsl(var(--border));
  border-radius: 24px;
  z-index: 9999;
}
```

- The body gets `data-electron` attribute set via a script injected by the preload or an
  inline script in the HTML template
- The `electron-window-border` element is injected by the preload script on DOM ready
  to give the window a visible edge (since frameless transparent windows have no native
  border)

Electron's `BrowserWindow` paints the window background as transparent. The HTML body's
`border-radius: 24px` is respected by Electron on all platforms when `transparent: true`.

## 6. next.config.ts Changes

```ts
const nextConfig: NextConfig = {
  output: process.env.ELECTRON_BUILD === 'true' ? 'standalone' : undefined,
};
```

When building for Electron (`ELECTRON_BUILD=true next build`), Next.js outputs a
standalone server with all bundled dependencies.

The `distDir` stays default (`.next`).

## 7. electron-builder.yml

```yaml
appId: com.qube.desktop
productName: Qube
directories:
  output: dist-electron
  buildResources: public
files:
  - electron/**/*
  - .next/standalone/**/*
  - public/**/*
extraResources:
  - from: .next/static
    to: .next/static
asar: false  # simpler for Next.js standalone
linux:
  target:
    - AppImage
    - deb
  category: Utility
  icon: public/logo.png
mac:
  target:
    - dmg
    - zip
  icon: public/logo.png
win:
  target:
    - nsis
  icon: public/logo.png
```

## 8. package.json Changes

Additions:
```json
{
  "main": "electron/main.js",
  "scripts": {
    "electron:dev": "ELECTRON_BUILD=true next build && electron .",
    "electron:start": "electron .",
    "release": "electron-builder --publish=always"
  },
  "devDependencies": {
    "electron": "^34.0.0",
    "electron-builder": "^25.0.0"
  }
}
```

Note: `"type": "module"` is already present. Since `electron/main.js` uses `require()`,
we either:
- Name it `main.cjs` and adjust the `main` field, OR
- Use dynamic `import()` or a shim

Preferred: rename `electron/main.js` to `electron/main.cjs` and
`electron/preload.js` to `electron/preload.cjs` (Electron preload scripts support `.cjs`).

```json
{
  "main": "electron/main.cjs"
}
```

## 9. CI/CD — GitHub Actions (`.github/workflows/release.yml`)

```yaml
name: Build and Release

on:
  push:
    branches: [main]

jobs:
  release:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: npm ci

      - name: Build Next.js
        run: npm run build
        env:
          ELECTRON_BUILD: 'true'

      - name: Build & release Electron app
        run: npx electron-builder --publish=always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Workflow:
1. On push to `main`, runs on all three OS in parallel
2. Installs deps, builds Next.js standalone, then electron-builder packages and
   uploads to a GitHub Release
3. `GH_TOKEN` is automatically provided by GitHub Actions
4. electron-builder creates a draft release with artifacts:
   - `.AppImage` + `.deb` (Linux)
   - `.dmg` + `.zip` (macOS)
   - `.exe` installer (Windows)

## 10. Key Design Decisions

**Transparent window approach**: `transparent: true` + CSS `border-radius` is the
simplest way to get rounded window corners on all three platforms. macOS can use
`vibrancy` but we keep the same look everywhere.

**Standalone Next.js server**: The app has API routes (`/api/chat`, etc.) so static
export is not possible. Forking the Next.js server as a child process is the standard
pattern for Electron + Next.js apps.

**.cjs extension**: The project is `"type": "module"`. Electron main/preload scripts
use CommonJS, so `.cjs` avoids issues.

**Conditional TitleBar rendering**: The TitleBar component checks
`window.electronAPI?.isDesktop`. In the browser or SSR, it renders nothing. This
keeps the web version completely untouched.

**No auto-updater initially**: First release uses manual download from GitHub Releases.
Auto-update can be added later via `electron-updater`.

## 11. Files to Create

| File | Purpose |
|------|---------|
| `electron/main.cjs` | Electron main process |
| `electron/preload.cjs` | Context bridge API |
| `electron/electron.d.ts` | TypeScript declarations |
| `components/shared/title-bar.tsx` | Notch + X button |
| `electron-builder.yml` | Build configuration |
| `.github/workflows/release.yml` | CI/CD pipeline |

## 12. Files to Modify

| File | Change |
|------|--------|
| `components/examples/base.tsx` | ~8 lines: add TitleBar, outer rounded-[24px], inner rounded-2xl, drag regions |
| `next.config.ts` | Add conditional `output: 'standalone'` |
| `package.json` | Add `main`, `electron:*` scripts, electron/electron-builder devDeps |

## Self-Review

- **Placeholders**: None. All sections are fully specified.
- **Consistency**: Electron approach matches across all sections. TitleBar rendering is
  gated on `isDesktop` so the web app is unaffected. Corner radius math is
  consistent (24px outer, 16px inner = 24 - 8).
- **Scope**: Focused on the Electron wrapper + title bar + CI. No scope creep into UI
  features, auto-update, or other features.
- **Ambiguity**: The exact notch position relative to the sidebar is resolved by
  placing it as an absolutely-positioned child of the outer container, not the sidebar
  area. The electron window border is drawn via a fixed overlay element injected by
  the preload script.
