# Computer Use Feature Design

## Overview

Allow the Qube agent to control the user's desktop — take screenshots, move the mouse, click, type, press keys, scroll, and drag — as if it had access to a keyboard and mouse. Access is gated by an explicit allow list (configured in Advanced settings) and the existing permission-widget system.

## Platforms

Targets all platforms Qube ships on (Linux x86_64/aarch64, macOS aarch64, Windows x64).

## Cross-Platform Library: `@nut-tree-fork/nut-js`

- **Screen capture** — full display or per-window
- **Mouse control** — move, click (left/right/middle), drag, scroll
- **Keyboard control** — type text, press key combos
- **Window management** — list windows by title, focus, get region
- Single API across Linux (X11), macOS, Windows. Wayland is limited (XWayland windows only).

## Architecture

### 1. Computer Manager (`lib/agent/computer/computer-manager.ts`)

Singleton wrapping `@nut-tree-fork/nut-js` APIs. Per-thread state tracking which window the agent is currently focused on.

```
Methods:
  screenshot(threadId, windowTitle?): { base64, width, height }
    // If windowTitle given, focuses that window first, then captures full screen.
    // Always returns the full display — agent sees the whole desktop.
  click(threadId, x, y, button?): void
  type(text): void
  pressKey(key, modifier?): void
  moveMouse(x, y): void
  scroll(x, y, direction, amount): void
  drag(x1, y1, x2, y2): void
  listWindows(): Array<{ title, pid }>
  focusWindow(titlePattern): void
```

### 2. Computer Tools (`lib/agent/computer/computer-tools.ts`)

Factory function `createComputerTools(threadId, modelSupportsImages)` returns tool definitions. Each tool checks permissions against the allowed apps list before executing.

| Tool | Description | Input Params |
|------|-------------|-------------|
| `computer_screenshot` | Capture full screen or a specific window | `windowTitle?`, `label?` |
| `computer_click` | Click at coordinates | `x`, `y`, `button?` (left/right/middle), `label?` |
| `computer_type` | Type text | `text`, `label?` |
| `computer_press_key` | Press key(s) | `keys` (e.g. "ctrl+c"), `label?` |
| `computer_move_mouse` | Move pointer to coordinates | `x`, `y`, `label?` |
| `computer_scroll` | Scroll at position | `x`, `y`, `direction` (up/down/left/right), `amount`, `label?` |
| `computer_drag` | Drag between points | `fromX`, `fromY`, `toX`, `toY`, `label?` |
| `computer_list_windows` | List visible windows | `label?` |

### 3. Computer Use Store (`lib/agent/computer/computer-store.ts`)

Persists allowed-apps configuration to `{QUBE_DATA_DIR}/.memory/computer-use.json`.

```typescript
interface ComputerUseSettings {
  enabled: boolean;
  fullScreen: boolean;
  allowedApps: Array<{
    id: string;
    titlePattern: string;   // window title substring match
    enabled: boolean;
  }>;
}
```

### 4. API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/computer/settings` | GET | Returns `ComputerUseSettings` |
| `/api/computer/settings` | POST | Saves `ComputerUseSettings` |
| `/api/computer/available-apps` | GET | Returns list of running window titles (for the "Add App" popup) |

### 5. Permission Integration

- `computer_store.ts` exports `isTargetAllowed(windowTitle): boolean`
  - If `fullScreen === true` and no `windowTitle` specified → allowed
  - If `windowTitle` matches any `allowedApps[i].titlePattern` where `.enabled === true` → allowed
  - Otherwise → denied

- When denied, the tool returns a structured error like `{ permissionRequired: true, windowTitle }` and the tool is wrapped with the same `withPermissionCheck` pattern used for file/command access:
  - A `createPermissionRequest()` fires
  - The permission widget pops up (already exists in `base.tsx` via `usePermissionPoller`)
  - On approval → re-executes; on deny → returns "Operation not permitted"

- The `evaluateComputerUse()` function is added to the existing `permission-middleware.ts` (or its own file).

### 6. Settings UI (`components/shared/settings-dialog.tsx`)

New "Computer Use" section in the **Advanced** tab (below Custom Instructions). Contains:

- **Enable toggle** — master switch. When off, no computer tools are injected into the agent.
- **Full Screen toggle** — grants full screen capture access (bypasses permission prompt).
- **Managed Apps** section:
  - List of added apps, each with: toggle (enabled/disabled), title pattern, delete button
  - "Add App" button → opens a sub-popup (following the Add Provider pattern):
    - Shows a list of currently running windows (fetched from `/api/computer/available-apps`)
    - User can select one or type a custom title pattern
    - On confirm, the app is added to the list with toggle enabled by default
  - Empty state: "No apps configured. Click 'Add App' to allow access."
- The entire section is **only visible** when the current model supports `imageInput: true`.

### 7. Agent Integration

In `lib/agent/agent.ts`:
```typescript
const computerUseSettings = computerStore.getAll();
const modelSupportsImages = /* check model's imageInput from providerStore */;
if (computerUseSettings.enabled && modelSupportsImages) {
  tools = { ...tools, ...createComputerTools(threadId) };
}
```

In `lib/agent/system-prompt.ts`:
- Add a `## Computer Use` section describing the available tools and how to use them (target windows by title, coordinate system, etc.)

### 8. Tool UI Components

File: `components/assistant-ui/tools/computer-tool-ui.tsx`

- `ComputerScreenshotToolUI` — renders the captured screenshot as an image (base64, same pattern as `BrowserScreenshotToolUI`)
- `ComputerToolUI` — generic renderer for click/type/key/move/scroll/drag actions, showing coordinates and values

Registered in `agent-runtime-provider.tsx`:
```typescript
useAssistantToolUI({ toolName: "computer_screenshot", render: ComputerScreenshotToolUI });
useAssistantToolUI({ toolName: "computer_click", render: ComputerToolUI });
// ... etc
```

### 9. Image Model Check

The `agent.ts` needs to know if the current model supports image input. This comes from the provider config's model entry (`detectModelImageSupport` in `settings-dialog.tsx`). The check is:

```typescript
const provider = providerStore.getProviderByModel(config.modelName);
const modelInfo = provider?.provider.models.find(m => m.id === provider.modelId);
const hasImageSupport = modelInfo?.imageInput ?? false;
```

If `hasImageSupport === false`, computer tools are not injected and the settings section is hidden.

## File Checklist

### New Files
- `lib/agent/computer/computer-manager.ts`
- `lib/agent/computer/computer-tools.ts`
- `lib/agent/computer/computer-store.ts`
- `app/api/computer/settings/route.ts`
- `app/api/computer/available-apps/route.ts`
- `components/assistant-ui/tools/computer-tool-ui.tsx`

### Modified Files
- `lib/agent/agent.ts` — inject computer tools conditionally
- `lib/agent/system-prompt.ts` — add computer use instructions
- `lib/middleware/permission-middleware.ts` — add `evaluateComputerUse()`
- `components/shared/settings-dialog.tsx` — add Computer Use section in Advanced tab
- `components/assistant-ui/agent-runtime-provider.tsx` — register tool UIs
- `package.json` — add `@nut-tree-fork/nut-js` dependency

## Package Dependencies

- `@nut-tree-fork/nut-js` — cross-platform desktop automation
- Linux build: `libxtst-dev` (for X11 input simulation) — should already be covered by the GitHub Actions `apt-get install` block
