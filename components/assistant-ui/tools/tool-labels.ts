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
  // Apps & services
  connect_service: "Connecting an app",
  mcp_tool_call: "Using an app",
  subagent: "Asking for backup",
  // Browsing (same plain voice as BrowserToolUI)
  open_tab: "Opening a page",
  navigate: "Going to a page",
  tabs: "Checking open pages",
  user_tabs: "Checking open pages",
  page_info: "Reading the page",
  snapshot: "Reading the page",
  cdp: "Working with the page",
  click: "Clicking something",
  act: "Browsing around",
  type: "Typing",
  press_key: "Pressing a key",
  move_mouse: "Moving the mouse",
  run_action_plan: "Browsing around",
  wait_load: "Waiting for the page",
  claim_tab: "Picking up the page",
  finalize_tabs: "Wrapping up",
  ping: "Checking the browser",
  info: "Checking the browser",
  name_session: "Saving the session",
  turn_ended: "Taking a pause",
  browser_navigate: "Going to a page",
  browser_navigate_back: "Going back",
  browser_navigate_forward: "Going forward",
  browser_search: "Searching the page",
  browser_click: "Clicking something",
  browser_hover: "Pointing at something",
  browser_drag: "Dragging something",
  browser_type: "Typing",
  browser_fill: "Filling something in",
  browser_find: "Searching the page",
  browser_fill_form: "Filling something in",
  browser_press_key: "Pressing a key",
  browser_select_option: "Picking an option",
  browser_file_upload: "Uploading a file",
  browser_handle_dialog: "Answering a popup",
  browser_back: "Going back",
  browser_read: "Reading the page",
  browser_snapshot: "Reading the page",
  browser_screenshot: "Looking at the page",
  browser_pixel_act: "Using the page",
  browser_act: "Using the page",
  computer_observe: "Looking at the page",
  computer_act: "Using the page",
  open_path: "Opening a file",
  request_takeover: "Asking you to step in",
  browser_console_messages: "Checking page details",
  browser_network_requests: "Checking page details",
  browser_evaluate: "Checking page details",
  browser_wait_for: "Waiting for the page",
  browser_tabs: "Checking open pages",
  browser_close: "Closing the page",
};

/**
 * Connected-app prefixes (prefix match, e.g. gmail_send_email, composio_*).
 * Kept separate from exact names so a short exact key can never mislabel an
 * unrelated tool (e.g. a ClickUp tool must not match "click").
 */
export const CONNECTOR_PREFIX_LABELS: Record<string, string> = {
  gmail: "Fiddling with your inbox",
  slack: "Slacking off",
  linear: "Organizing chaos",
  github: "Poking the repo",
  googlecalendar: "Rearranging your life",
  googledrive: "Digging through files",
  notion: "Notion-ing around",
  hubspot: "CRM-ing it up",
  asana: "Asana-ing tasks",
  trello: "Carding things",
  airtable: "Databasing casually",
  dropbox: "Dropping files",
  jira: "Ticketing around",
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
  const lower = toolName.toLowerCase();
  for (const [prefix, title] of Object.entries(CONNECTOR_PREFIX_LABELS)) {
    if (lower.startsWith(prefix)) return title;
  }
  return FALLBACK_TOOL_LABEL;
}
