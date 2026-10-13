/**
 * Qube OpenUI component library.
 *
 * Uses OpenUI's built-in chat-optimized library (Card root, vertical
 * container for chat responses) so the model can render cards, tables,
 * charts, forms, tabs, etc. with zero custom component maintenance.
 *
 * The CLI serializes this file into `openui.spec.json` (see package.json
 * `openui:spec` script). The server builds its system-prompt fragment from
 * that spec via `@openuidev/lang-core` (no React import on the server), and
 * the client renders with `openuiChatLibrary` via `@openuidev/react-lang`.
 *
 * Docs: https://www.openui.com/docs/build-agents/ui-generation
 */
export {
  openuiChatLibrary as library,
  openuiChatPromptOptions as promptOptions,
} from "@openuidev/react-ui/genui-lib";
