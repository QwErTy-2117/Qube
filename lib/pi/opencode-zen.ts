/**
 * OpenCode Zen's OpenAI-compatible API expects these client-identification
 * headers, including for the free model tier when called from third-party
 * clients. Keep the same values on chat, Responses API, validation, and model
 * discovery requests so all Qube paths identify consistently.
 */
export const OPENCODE_ZEN_HEADERS: Record<string, string> = {
  "x-opencode-client": "cli",
  "x-opencode-session": "ses_global_sync",
};
