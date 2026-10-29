# Tool Group Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finished groups show the friendly label for a single tool, and `used N apps` for connector-only groups; everything else keeps today's behavior.

**Architecture:** Extract the finished-title decision from `ToolGroupWithTitle` into pure `finishedGroupTitle` in `components/assistant-ui/tools/group-title.ts`, unit-test the matrix, then wire the component to it. Running titles untouched.

**Tech Stack:** TypeScript, `node:test` + `tsx`. No new dependencies.

---

### Task 1: Pure `finishedGroupTitle` helper + tests

**Files:**
- Create: `components/assistant-ui/tools/group-title.ts`
- Create: `tests/group-title.test.ts`

- [ ] **Step 1: Write the failing test**

`getConnectorIconEntries` in `base.tsx` de-dups icons by app (`seen` set). So the component already knows the distinct-app count as `connectorIcons.length`. The pure helper therefore takes precomputed inputs, not tool parts:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { finishedGroupTitle } from "@/components/assistant-ui/tools/group-title";

describe("finishedGroupTitle", () => {
  it("single tool shows its friendly label, never used 1 tool", () => {
    assert.equal(
      finishedGroupTitle({ labels: ["Going down a rabbit hole"], visibleCount: 1, connectorOnly: false, connectorAppCount: 0 }),
      "Going down a rabbit hole",
    );
  });

  it("single connector app group says used 1 app", () => {
    assert.equal(
      finishedGroupTitle({ labels: ["Fiddling with your inbox"], visibleCount: 1, connectorOnly: true, connectorAppCount: 1 }),
      "used 1 app",
    );
  });

  it("two connector apps say used 2 apps", () => {
    assert.equal(
      finishedGroupTitle({ labels: ["a", "b"], visibleCount: 2, connectorOnly: true, connectorAppCount: 2 }),
      "used 2 apps",
    );
  });

  it("three tool calls on one app say used 1 app", () => {
    assert.equal(
      finishedGroupTitle({ labels: ["a", "b", "c"], visibleCount: 3, connectorOnly: true, connectorAppCount: 1 }),
      "used 1 app",
    );
  });

  it("mixed groups keep the last label when connector icons exist", () => {
    assert.equal(
      finishedGroupTitle({ labels: ["Going down a rabbit hole", "Poking the repo"], visibleCount: 2, connectorOnly: false, connectorAppCount: 1, hasConnectorIcons: true }),
      "Poking the repo",
    );
  });

  it("mixed groups without connectors keep used N tools", () => {
    assert.equal(
      finishedGroupTitle({ labels: ["a", "b"], visibleCount: 2, connectorOnly: false, connectorAppCount: 0 }),
      "used 2 tools",
    );
  });

  it("falls back to Working on it with no labels", () => {
    assert.equal(
      finishedGroupTitle({ labels: [], visibleCount: 2, connectorOnly: false, connectorAppCount: 0 }),
      "Working on it",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/group-title.test.ts`
Expected: FAIL with "Cannot find module '@/components/assistant-ui/tools/group-title'".

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Finished (non-running) tool-group title. Pure — unit-tested in
 * tests/group-title.test.ts. Callers pass precomputed group facts; running
 * titles ("Exploring", live verbs) are decided in base.tsx and untouched.
 */
export function finishedGroupTitle(opts: {
  /** Friendly labels of visible (non-hidden) tool calls, in order. */
  labels: string[];
  /** Visible tool calls + reasoning parts (today's counting rule). */
  visibleCount: number;
  /** True when every visible tool call is connector-backed. */
  connectorOnly: boolean;
  /** Distinct connector apps used (icons already de-duped by app). */
  connectorAppCount: number;
  /** True when any connector icon renders (mixed groups). */
  hasConnectorIcons?: boolean;
}): string {
  const { labels, connectorOnly, connectorAppCount } = opts;
  if (connectorOnly && connectorAppCount > 0) {
    return `used ${connectorAppCount} ${connectorAppCount === 1 ? "app" : "apps"}`;
  }
  if (labels.length === 1) {
    return labels[0] || "Working on it";
  }
  if (opts.hasConnectorIcons) {
    return labels[labels.length - 1] || "Working on it";
  }
  if (labels.length === 0) return "Working on it";
  return `used ${opts.visibleCount} ${opts.visibleCount === 1 ? "tool" : "tools"}`;
}
```

Design note: `labels.length === 1` subsumes the old `used 1 tool` case; `connectorOnly` is checked first so single-connector groups say `used 1 app`, never the action label. `hasConnectorIcons` preserves today's mixed-group branch exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/group-title.test.ts`
Expected: PASS (7 passing).

- [ ] **Step 5: Commit**

```bash
git add components/assistant-ui/tools/group-title.ts tests/group-title.test.ts
git commit -m "feat: pure finished tool-group title helper"
```

### Task 2: Wire `ToolGroupWithTitle` to the helper

**Files:**
- Modify: `components/examples/base.tsx:1053-1090` (`labels`/`connectorIcons`/`visibleCount` + finished title branch)

- [ ] **Step 1: Replace the finished-title branch**

Current code (lines 1053-1090):

```ts
const labels = visibleParts.map(getToolLabel);
const connectorIcons = getConnectorIconEntries(visibleParts);
const visibleCount = visibleParts.length + reasoningParts.length;
...
} else if (connectorIcons.length > 0) {
  // When a connector tool finishes, show its own friendly title instead of
  // the generic "used N tools" — the connector icons sit before it.
  title = labels[labels.length - 1] || "Working on it";
} else {
  title = `used ${visibleCount} ${visibleCount === 1 ? "tool" : "tools"}`;
}
```

Change to:

```ts
import { finishedGroupTitle } from "@/components/assistant-ui/tools/group-title";
```

(put with the other `@/` imports at the top of base.tsx), then:

```ts
const labels = visibleParts.map(getToolLabel);
const connectorIcons = getConnectorIconEntries(visibleParts);
const visibleCount = visibleParts.length + reasoningParts.length;
// A group is connector-only when every visible tool call resolves to a
// connector app — direct name match, or a composio/mcp meta-tool whose
// args infer only connector metas (same resolution as the icons above).
const connectorOnly =
  visibleParts.length > 0 &&
  visibleParts.every((p) => {
    const direct = getConnectorMetaForTool(p.toolName);
    if (direct && direct.displayId !== "composio") return true;
    if (direct || INFER_CONNECTOR_META_TOOLS.has(p.toolName)) {
      try {
        const inferred = inferConnectorMetasFromArgs(p.args);
        return inferred.length > 0;
      } catch {
        return false;
      }
    }
    return false;
  });
```

`getConnectorMetaForTool`, `inferConnectorMetasFromArgs`, and `INFER_CONNECTOR_META_TOOLS` are already imported/defined in base.tsx (lines 15, 974) — reuse them, do not re-import.

and the finished branch becomes:

```ts
} else {
  title = finishedGroupTitle({
    labels,
    visibleCount,
    connectorOnly,
    connectorAppCount: connectorIcons.length,
    hasConnectorIcons: connectorIcons.length > 0,
  });
}
```

The `active` branch (lines 1076-1083) is untouched. Icon rendering (lines 1094-1120) is untouched.

- [ ] **Step 2: Typecheck and run title tests**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors naming `base.tsx` or `group-title`. (Compare against `main` if unrelated errors exist.)

Run: `npx tsx --test tests/group-title.test.ts tests/tool-labels.test.ts tests/connectors-identity.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/examples/base.tsx
git commit -m "feat: single tool label and used N apps group titles"
```

## Self-review note (plan author)

Spec section 6 coverage: pure helper (yes), connector-only any-N incl. 1 (tests), single-tool label (test), mixed legacy (tests), hidden-tool counting unchanged (`visibleCount` formula untouched). No placeholders: all code inline. Type consistency: `finishedGroupTitle` input names match test and call-site usage exactly; `connectorAppCount` = `connectorIcons.length` matches de-duped app semantics in `getConnectorIconEntries`.
