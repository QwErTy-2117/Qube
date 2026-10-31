import { getConnectorMetaForTool } from "@/lib/connectors/connector-meta";

/**
 * Friendly, non-technical names for tool calls.
 *
 * Single source of truth for every "what is the agent doing?" label in the
 * chat UI (group trigger titles, fallback cards, subagent steps, connector
 * cards). Style follows the established examples: playful plain language,
 * never the raw tool name and never jargon (no snapshot/ref/pixel/cdp/
 * heartbeat/scratchpad/mcp/composio/takeover/...).
 *
 * Precedence: an explicit `label` arg from the model always wins (the system
 * prompt requires one on every call), then exact match, then connector
 * prefix match, then a generic fallback — raw snake_case names never leak.
 */

export const FRIENDLY_TOOL_LABELS: Record<string, string> = {
  // Files & notes
  read_file: "Sneaking a peek",
  read_external_file: "Sneaking a peek",
  write_file: "Doodling something up",
  edit_file: "Tweaking things",
  delete_file: "Sending to the void",
  list_directory: "Nosing around",
  list_external_directory: "Nosing around",
  read_scratchpad: "Checking the notes",
  write_scratchpad: "Jotting something down",
  append_scratchpad: "Adding to the notes",
  present_file: "Pulling up a file",
  file_change: "Tweaking things",
  // Shell
  run_command: "Making magic happen",
  command_execution: "Making magic happen",
  dev_server: "Starting the app",
  dev_server_log: "Reading the server log",
  // Web
  web_search: "Going down a rabbit hole",
  web_fetch: "Grabbing a page",
  // Talking to you
  ask_user: "Poking the human",
  ask_question: "Asking you",
  // Planning, memory, sessions
  TodoWrite: "Making a plan",
  schedule_task: "Planning ahead",
  update_heartbeat: "Checking in",
  list_sessions: "Checking the logbook",
  read_session_summary: "Skimming the past",
  read_session: "Reading the tea leaves",
  read_memory: "Scratching the brain",
  save_memory: "Remembering that",
  goal: "Working toward the goal",
  generate_ui: "Cooking up a visual",
  // Apps & services
  connect_service: "Connecting an app",
  mcp_tool_call: "Using an app",
  subagent: "Asking for backup",
  // Thinking (same playful voice — never raw "Reasoning"/"Thinking")
  thinking: "Noodling on it",
  reasoning: "Noodling on it",
  chainOfThought: "Connecting the dots",
  // Qube Computer (a persistent runtime Qube owns — not your desktop)
  computer_status: "Checking the computer",
  computer_list: "Looking through the computer",
  computer_read: "Reading a file",
  computer_write: "Writing a file",
  computer_delete: "Deleting a file",
  computer_run: "Running a command",
  computer_import: "Copying a file in",
  computer_export: "Copying a file out",
  computer_browser: "Working in the computer's browser",
  computer_reset: "Resetting the computer",
};

/**
 * Connected-app prefixes (prefix match, e.g. gmail_send_email, composio_*).
 * Kept separate from exact names so a short exact key can never mislabel an
 * unrelated tool (e.g. a ClickUp tool must not match "click").
 * Single source of truth lives in lib/connectors/connector-meta — this map
 * mirrors it so existing imports keep working.
 */
export const CONNECTOR_PREFIX_LABELS: Record<string, string> = {
  gmail: "Fiddling with your inbox",
  slack: "Slacking off",
  linear: "Organizing chaos",
  github: "Poking the repo",
  googlecalendar: "Rearranging your life",
  googledrive: "Digging through files",
  google: "Rummaging through Google",
  notion: "Notion-ing around",
  hubspot: "CRM-ing it up",
  asana: "Asana-ing tasks",
  trello: "Carding things",
  airtable: "Databasing casually",
  dropbox: "Dropping files",
  jira: "Ticketing around",
  atlassian: "Ticketing around",
  canva: "Doodling a design",
  composio: "Rooting around your apps",
};

/** Generic title when nothing matches — never a raw technical name. */
export const FALLBACK_TOOL_LABEL = "Working on it";

export function friendlyToolLabel(
  toolName: unknown,
  args?: unknown
): string {
  try {
    const label = (args as { label?: unknown } | null)?.label;
    if (typeof label === "string" && label.trim()) {
      return label.trim().slice(0, 120);
    }
  } catch {}
  if (typeof toolName !== "string" || !toolName) return FALLBACK_TOOL_LABEL;
  const exact = FRIENDLY_TOOL_LABELS[toolName];
  if (exact) return exact;
  // Connector prefix match via the shared resolver (longest-first, strict
  // "_" boundary so "clickup_*" never matches "click" etc.). Every known
  // connector tool gets its pre-made playful name here.
  const meta = getConnectorMetaForTool(toolName);
  if (meta) return meta.playful;
  return FALLBACK_TOOL_LABEL;
}
