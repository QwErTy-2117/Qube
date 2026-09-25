import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CONNECTOR_PREFIX_LABELS,
  friendlyToolLabel,
  FALLBACK_TOOL_LABEL,
} from "../components/assistant-ui/tools/tool-labels";

// Every tool the app can render must have a friendly, non-technical name —
// raw snake_case ids (or words like snapshot/cdp/mcp/heartbeat) never leak.
const REGISTERED_TOOLS = [
  "web_search",
  "web_fetch",
  "read_file",
  "write_file",
  "edit_file",
  "delete_file",
  "list_directory",
  "run_command",
  "read_scratchpad",
  "write_scratchpad",
  "append_scratchpad",
  "present_file",
  "ask_question",
  "ask_user",
  "schedule_task",
  "update_heartbeat",
  "list_sessions",
  "read_session_summary",
  "read_session",
  "read_memory",
  "save_memory",
  "connect_service",
  "composio_search_tools",
  "composio_multi_execute_tool",
  "mcp_tool_call",
  "command_execution",
  "file_change",
  "read_external_file",
  "list_external_directory",
  "TodoWrite",
  "subagent",
  "open_tab",
  "navigate",
  "tabs",
  "user_tabs",
  "page_info",
  "snapshot",
  "act",
  "click",
  "type",
  "press_key",
  "cdp",
  "move_mouse",
  "run_action_plan",
  "wait_load",
  "claim_tab",
  "finalize_tabs",
  "name_session",
  "turn_ended",
  "ping",
  "info",
  "browser_navigate",
  "browser_snapshot",
  "browser_act",
  "browser_screenshot",
  "browser_pixel_act",
  "computer_observe",
  "computer_act",
  "open_path",
  "request_takeover",
];

const JARGON = [
  "_",
  "composio",
  "mcp",
  "snapshot",
  "cdp",
  "pixel",
  "takeover",
  "heartbeat",
  "scratchpad",
  "ref",
  "todo",
  "cron",
];

describe("tool labels: every registered tool has a friendly name", () => {
  for (const name of REGISTERED_TOOLS) {
    it(`${name} -> plain language`, () => {
      const label = friendlyToolLabel(name, {});
      assert.ok(label.length > 0, "label is empty");
      assert.ok(!label.includes("_"), `leaks snake_case: ${label}`);
      for (const j of JARGON) {
        assert.ok(
          !label.toLowerCase().includes(j),
          `"${label}" leaks jargon "${j}"`
        );
      }
    });
  }
});

describe("tool labels: precedence and safety", () => {
  it("prefers the model-provided label arg", () => {
    assert.equal(
      friendlyToolLabel("read_file", { label: "Looking at the budget" }),
      "Looking at the budget"
    );
  });
  it("matches connector prefixes (gmail_send_email, composio_*)", () => {
    assert.equal(friendlyToolLabel("gmail_send_email", {}), CONNECTOR_PREFIX_LABELS.gmail);
    assert.equal(
      friendlyToolLabel("composio_multi_execute_tool", {}),
      CONNECTOR_PREFIX_LABELS.composio
    );
  });
  it("never mislabels unrelated tools via short prefixes", () => {
    // A ClickUp tool must not match the "click" browser label.
    assert.equal(friendlyToolLabel("clickup_create_task", {}), FALLBACK_TOOL_LABEL);
  });
  it("falls back to a generic title — never the raw id", () => {
    assert.equal(friendlyToolLabel("xenon_bulk_mutate_records", {}), FALLBACK_TOOL_LABEL);
    assert.equal(friendlyToolLabel(undefined, {}), FALLBACK_TOOL_LABEL);
    assert.ok(!FALLBACK_TOOL_LABEL.includes("_"));
  });
});
