# Settings Screen Redesign

## Overview

Replace the current sidebar-based settings dialog with a tabbed layout using the assistant-ui `Tabs` component. Remove the "Qube Settings" header and the "Memories and sessions are stored locally on disk..." footer. Reorganize into three sections: Preferences, Memories, and Advanced.

## Layout

- **Dialog**: Same Radix `Dialog` modal, size stays `sm:max-w-4xl` with `min(660px, 90vh)` height.
- **Navigation**: Assistant-ui `Tabs` with `variant="line"` rendered at the top of the dialog content, replacing the left sidebar. Three tabs with icons:
  - Preferences (`SlidersIcon`)
  - Memories (`BrainIcon`) — with count badge showing total memories + sessions
  - Advanced (`SettingsIcon`)
- **Content Area**: Single scrollable panel below the tabs, switching content via `TabsContent`.

## Tab Contents

### Preferences Tab
New tab collecting personalization settings:

1. **Your Name** — Text input, saved to `localStorage` as `qube-user-name`.
2. **About You** — Textarea (4 rows) for personal context (background, goals, preferences, etc.). Saved as `qube-user-about`. Both name and about are appended to the agent's system prompt on every request.
3. **Theme** — Three-option radio group: Light / Dark / System. Uses `next-themes` `setTheme`/`theme` under the hood. Matches the existing theme system.
4. **Save Preferences** button — Saves name + about to localStorage, shows "Saved!" confirmation.

### Memories Tab
Combines current Memories + Sessions tabs into a single scrollable view:

- **Long-Term Memories** section (same as current): list with category badges, content, relevance bars, per-item delete, Clear All.
- **Past Sessions** section (same as current): list with titles, summaries, dates, per-item delete, Clear All.
- Both sections stacked vertically with section headers, each independently scrollable or the whole tab scrolls.

### Advanced Tab
Receives the current Preferences content (moved as-is):

1. **Default Model** — Three radio-card options (zai-glm-4.7, gpt-oss-120b, gemma-4-31b).
2. **Temperature** — Range slider 0.0–1.5.
3. **Custom System Instructions** — Textarea (5 rows).
4. **Save Preferences** button — Saves model/temperature/instructions to localStorage, shows "Saved!" confirmation.

## Data Flow

### localStorage keys
| Key | Tab | Type |
|---|---|---|
| `qube-user-name` | Preferences | string |
| `qube-user-about` | Preferences | string |
| `qube-default-model` | Advanced | string |
| `qube-temperature` | Advanced | number |
| `qube-custom-system-prompt` | Advanced | string |

### System prompt integration
The agent runtime provider (`agent-runtime-provider.tsx`) already reads `qube-custom-system-prompt` and `qube-temperature` from localStorage and passes them as `body()`. Extend it to also read `qube-user-name` and `qube-user-about` and append them to the system prompt in the format:
```
User name: {name}
About the user: {about}
```

### Theme integration
`next-themes` is already wired. Preferences tab will use `useTheme()` to get/set the theme. No changes needed to the provider.

## Installation

- `npx shadcn@latest add https://r.assistant-ui.com/tabs.json` to install the assistant-ui tabs component.
- This creates `components/assistant-ui/tabs.tsx`.

## Component Changes

### `components/shared/settings-dialog.tsx`
- Remove sidebar nav, footer text, manual `activeTab` state and conditional rendering.
- Import assistant-ui `Tabs, TabsList, TabsTrigger, TabsContent`.
- Wrap content in `<Tabs defaultValue="preferences">` with tabs at top.
- Three `<TabsContent>` blocks: preferences, memories, advanced.
- Add name/about inputs + theme radio to preferences.
- Move current preferences content (model, temperature, instructions) to advanced.
- Merge memories + sessions into one tab (same components, stacked).

### `components/assistant-ui/agent-runtime-provider.tsx`
- Extend localStorage reads to include `qube-user-name` and `qube-user-about`.
- Append them to the system prompt in the request body.

## Testing

Manual verification:
- Open settings, verify three tabs render at top with correct icons.
- Switch between tabs, verify content changes.
- Set name + about in Preferences, save, start a new chat, verify agent receives the info.
- Toggle theme in Preferences, verify light/dark/system works.
- Verify model/temperature/instructions in Advanced still work.
- Verify memories and sessions display correctly in Memories tab.
