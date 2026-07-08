# Qube Desktop — Electron Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap Qube in an Electron desktop app with frameless window, custom notch/X button, system tray background, and auto-build on push to main.

**Architecture:** Electron main process spawns Next.js standalone server as child process. Frameless transparent window clips to CSS `border-radius: 24px`. A React TitleBar component renders the notch + X button (conditionally in Electron only). Closing hides to system tray. GitHub Actions builds and releases on push to main.

**Tech Stack:** Electron 34+, electron-builder 25+, Next.js standalone output, lucide-react X icon

---

## File Structure

### Create
| File | Responsibility |
|------|---------------|
| `electron/main.cjs` | Electron BrowserWindow, tray, Next.js server lifecycle, IPC |
| `electron/preload.cjs` | contextBridge (`closeToTray`, `minimize`, `isDesktop`) + set `data-electron` attr |
| `electron/electron.d.ts` | TypeScript declaration for `window.electronAPI` |
| `components/shared/title-bar.tsx` | Notch div + X button, Electron-only render |
| `electron-builder.yml` | electron-builder packaging config |
| `.github/workflows/release.yml` | CI/CD: build + release on push to main |

### Modify
| File | Change |
|------|--------|
| `package.json` | Add `main`, `electron:*` scripts, electron/electron-builder devDeps |
| `next.config.ts` | Add conditional `output: 'standalone'` when `ELECTRON_BUILD=true` |
| `components/examples/base.tsx` | Add TitleBar, outer `rounded-[24px]`, inner `rounded-2xl`, drag regions |
| `app/globals.css` | Add Electron-specific styles (border-radius, window border, drag regions) |
| `.gitignore` | Add `dist-electron/` |

---

### Task 1: Update package.json with Electron scripts & dependencies

**Files:**
- Modify: `package.json` (fields and devDependencies)

- [ ] **Edit package.json**

```json
{
  "main": "electron/main.cjs",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "electron:build": "ELECTRON_BUILD=true next build && electron-builder",
    "electron:dev": "QUBE_DEV=true electron .",
    "electron:start": "electron ."
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.3.1",
    "@types/jsdom": "^28.0.3",
    "@types/node": "^26.0.0",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "electron": "^34.0.0",
    "electron-builder": "^25.0.0",
    "tailwindcss": "^4.3.1",
    "typescript": "^6.0.3"
  }
}
```

The `"main"` field tells Electron which process file to use. `electron:build` runs the Next.js standalone build then packages with electron-builder. `electron:dev` launches Electron in dev mode (expects `npm run dev` running separately on port 3000).

- [ ] **Install dependencies**

Run: `npm install`
Expected: electron and electron-builder downloaded, no errors.

- [ ] **Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add electron dependencies and scripts"
```

---

### Task 2: Create Electron main process

**Files:**
- Create: `electron/main.cjs`
- Create: `electron/preload.cjs`

- [ ] **Create `electron/preload.cjs`**

```js
const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.setAttribute('data-electron', 'true');
});

contextBridge.exposeInMainWorld('electronAPI', {
  closeToTray: () => ipcRenderer.send('close-to-tray'),
  minimize: () => ipcRenderer.send('minimize'),
  isDesktop: true,
  platform: process.platform,
});
```

Sets `data-electron` on `<html>` so CSS can target Electron-only styles. Exposes typed API via `contextBridge`.

- [ ] **Create `electron/main.cjs`**

```js
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');

const PORT = process.env.QUBE_PORT || 3456;
const isDev = process.env.QUBE_DEV === 'true';

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;

function startServer() {
  const serverDir = path.join(__dirname, '..', '.next', 'standalone');
  const serverPath = path.join(serverDir, 'server.js');

  serverProcess = fork(serverPath, [], {
    env: { ...process.env, PORT: String(PORT) },
    cwd: serverDir,
    stdio: 'pipe',
  });

  serverProcess.stdout?.on('data', (d) => process.stdout.write(`[next] ${d}`));
  serverProcess.stderr?.on('data', (d) => process.stderr.write(`[next] ${d}`));

  return new Promise((resolve) => {
    const poll = () => {
      const req = http.get(`http://localhost:${PORT}`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => setTimeout(poll, 300));
      req.end();
    };
    poll();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    transparent: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = isDev ? 'http://localhost:3000' : `http://localhost:${PORT}`;

  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'public', 'logo.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('Qube');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Qube',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        if (tray) tray.destroy();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  ipcMain.on('close-to-tray', () => {
    if (mainWindow) mainWindow.hide();
  });

  ipcMain.on('minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  if (!isDev) {
    await startServer();
  }

  createWindow();
  createTray();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});
```

Key behavior: Starts Next.js standalone server as a forked child process on port 3456 (prod) or connects to localhost:3000 (dev). Creates a frameless transparent window. Closing hides to tray instead of quitting. System tray has Show/Quit and click-to-toggle.

- [ ] **Commit**

```bash
git add electron/main.cjs electron/preload.cjs
git commit -m "feat: add electron main process with tray and IPC"
```

---

### Task 3: Create TypeScript declarations for Electron API

**Files:**
- Create: `electron/electron.d.ts`

- [ ] **Create `electron/electron.d.ts`**

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

This lets TypeScript know about `window.electronAPI` without errors.

- [ ] **Commit**

```bash
git add electron/electron.d.ts
git commit -m "feat: add electron API type declarations"
```

---

### Task 4: Add Electron-specific CSS to globals.css

**Files:**
- Modify: `app/globals.css` (append at end)

- [ ] **Add Electron styles to `app/globals.css`**

Append these rules at the end of the file:

```css
/* ── Electron desktop overrides ── */
html[data-electron] {
  border-radius: 24px;
  overflow: hidden;
}

html[data-electron] body {
  border-radius: 24px;
  overflow: hidden;
}

html[data-electron]::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  border: 1px solid hsl(var(--border));
  border-radius: 24px;
  z-index: 9999;
}
```

When `data-electron` is present (set by preload script), the HTML element gets `border-radius: 24px` which Electron respects for window clipping (since `transparent: true`). The `::after` pseudo-element draws a 1px border matching the theme's border color to give the window a visible edge.

- [ ] **Commit**

```bash
git add app/globals.css
git commit -m "feat: add desktop window border-radius and border styles"
```

---

### Task 5: Update next.config.ts for standalone output

**Files:**
- Modify: `next.config.ts`

- [ ] **Edit `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.ELECTRON_BUILD === "true" ? "standalone" : undefined,
};

export default nextConfig;
```

When `ELECTRON_BUILD=true`, Next.js outputs a standalone server with bundled dependencies at `.next/standalone/`. When unset (normal dev), the output config is `undefined` so Next.js uses default behavior.

- [ ] **Commit**

```bash
git add next.config.ts
git commit -m "feat: enable standalone output for electron builds"
```

---

### Task 6: Create the TitleBar component (notch + X button)

**Files:**
- Create: `components/shared/title-bar.tsx`

- [ ] **Create `components/shared/title-bar.tsx`**

```tsx
"use client";

import { X } from "lucide-react";

export function TitleBar() {
  if (typeof window === "undefined" || !window.electronAPI?.isDesktop) return null;

  return (
    <div
      className="absolute top-0 right-0 z-50 flex h-7 w-10 items-center justify-center rounded-bl-xl bg-muted"
      style={{ WebkitAppRegion: "no-drag" as any }}
    >
      <button
        type="button"
        onClick={() => window.electronAPI?.closeToTray()}
        className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/10 dark:hover:bg-white/10"
        aria-label="Close to tray"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
```

The component:
- Returns `null` in the browser or during SSR (checks `window.electronAPI?.isDesktop`)
- Renders an absolutely-positioned notch at `top-0 right-0` of the parent container
- The notch is `w-10 h-7` with `rounded-bl-xl` (12px curved bottom-left corner) to create the notch shape
- Background matches `bg-muted` (same as the outer container, creating a seamless look)
- The X button inside is `size-5 rounded-full` with a `hover:bg-black/10` circle effect
- Clicking calls `window.electronAPI.closeToTray()` which hides the window
- `WebkitAppRegion: 'no-drag'` prevents window dragging on the button and notch area

- [ ] **Commit**

```bash
git add components/shared/title-bar.tsx
git commit -m "feat: add title bar notch with close button"
```

---

### Task 7: Modify base.tsx for desktop layout

**Files:**
- Modify: `components/examples/base.tsx`

- [ ] **Add TitleBar import**

Add after line 103 (`import { SettingsDialog } from "@/components/shared/settings-dialog";`):

```tsx
import { TitleBar } from "@/components/shared/title-bar";
```

- [ ] **Update the outer container in the Base component**

Replace the outer div (lines 1112-1123):

Old:
```tsx
export const Base: FC = () => {
  return (
    <div className="bg-muted flex h-full w-full">
      <div>
        <Sidebar />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden p-2 md:pl-0">
        <div className="bg-background flex flex-1 flex-col overflow-hidden rounded-lg">
          <main className="flex-1 overflow-hidden">
            <Thread />
          </main>
        </div>
      </div>
    </div>
  );
};
```

New:
```tsx
export const Base: FC = () => {
  return (
    <div
      className="bg-muted relative flex h-full w-full select-none rounded-[24px] overflow-hidden"
      style={{ WebkitAppRegion: "drag" as any }}
    >
      <TitleBar />
      <div>
        <Sidebar />
      </div>
      <div
        className="flex flex-1 flex-col overflow-hidden p-2 md:pl-0"
        style={{ WebkitAppRegion: "no-drag" as any }}
      >
        <div className="bg-background flex flex-1 flex-col overflow-hidden rounded-2xl">
          <main className="flex-1 overflow-hidden">
            <Thread />
          </main>
        </div>
      </div>
    </div>
  );
};
```

Key changes:
1. `rounded-[24px]` — matches the settings dialog's `rounded-3xl` (24px)
2. `overflow-hidden` — clips children to the rounded shape (this is what creates the visible rounded corners)
3. `relative` — anchor for the absolutely-positioned TitleBar
4. `select-none` — prevents accidental text selection when dragging the window
5. `WebkitAppRegion: 'drag'` — enables frameless window dragging from the outer container
6. `WebkitAppRegion: 'no-drag'` — the content area disables dragging so interactive elements work
7. `<TitleBar />` — renders the notch + X button
8. Inner container `rounded-lg` → `rounded-2xl` (16px = 24px outer - 8px padding)

- [ ] **Verify the file still compiles**

Run: `npx tsc --noEmit`
Expected: No errors. (The `WebkitAppRegion` cast to `any` prevents type errors.)

- [ ] **Commit**

```bash
git add components/examples/base.tsx
git commit -m "feat: add desktop layout with rounded corners and title bar"
```

---

### Task 8: Update .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Add `dist-electron/` to `.gitignore`**

Append at end of file:
```
dist-electron/
```

electron-builder outputs packaged builds to `dist-electron/`. This should not be committed.

- [ ] **Commit**

```bash
git add .gitignore
git commit -m "chore: ignore electron build output"
```

---

### Task 9: Create electron-builder config

**Files:**
- Create: `electron-builder.yml`

- [ ] **Create `electron-builder.yml`**

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
asar: false
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

Bundles the Electron process files, the Next.js standalone server, and static assets. Packages as AppImage/deb (Linux), dmg/zip (macOS), nsis installer (Windows).

- [ ] **Commit**

```bash
git add electron-builder.yml
git commit -m "feat: add electron-builder packaging config"
```

---

### Task 10: Create GitHub Actions CI/CD workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Create `.github/workflows/release.yml`**

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
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build Next.js standalone
        run: npm run build
        env:
          ELECTRON_BUILD: "true"

      - name: Build and release Electron app
        run: npx electron-builder --publish=always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

On every push to `main`, runs on Ubuntu, Windows, and macOS in parallel. Installs deps, builds Next.js with standalone output, then packages with electron-builder and uploads artifacts to a GitHub Release.

- [ ] **Create directory and commit**

```bash
mkdir -p .github/workflows
git add .github/workflows/release.yml
git commit -m "feat: add CI/CD workflow for desktop builds on push to main"
```

---

### Task 11: Full build verification

- [ ] **Build the Next.js standalone**

Run: `ELECTRON_BUILD=true npm run build`
Expected: Build succeeds, `.next/standalone/` is created with `server.js` + `package.json`.

- [ ] **Verify the standalone server starts**

Run: `node .next/standalone/server.js &
curl http://localhost:3000`
Expected: Server starts, curl returns HTML.

- [ ] **Kill the test server**

Run: `kill %1`

- [ ] **Verify TypeScript compiles clean**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Commit any final build artifacts (but not standalone)**

The standalone output is already in `.gitignore`. Only commit if there are source changes.

```bash
git status
# Should show only expected changes (no build artifacts)
```

---

## Self-Review

**Spec coverage check:**
- Electron main process with frameless transparent window → Task 2
- System tray with hide-on-close → Task 2
- Preload with `closeToTray`, `minimize`, `isDesktop` → Task 2
- TypeScript declarations → Task 3
- CSS for `border-radius: 24px` + window border → Task 4
- `next.config.ts` standalone output → Task 5
- TitleBar component with notch + X button → Task 6
- `base.tsx` changes: outer rounded-[24px], inner rounded-2xl, drag regions → Task 7
- `.gitignore` update → Task 8
- `electron-builder.yml` packaging config → Task 9
- GitHub Actions release workflow → Task 10
- All covered. No gaps.

**Placeholder scan:** No TBD, TODO, or vague steps. Every step has complete code and exact commands.

**Type consistency:** `electronAPI` interface in Task 3 matches usage in Task 6. `WebkitAppRegion` type assertions used consistently. `preload.cjs` and `main.cjs` IPC channel names match. `rounded-[24px]` in base.tsx matches `border-radius: 24px` in globals.css. Inner `rounded-2xl` = 24px - 8px padding = 16px, which matches spec.
