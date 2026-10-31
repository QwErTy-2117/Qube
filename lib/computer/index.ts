/**
 * Qube Computer — Qube-owned persistent runtime used instead of a
 * browser-use/computer-use bridge. See `paths.ts` for the layout and
 * `session.ts` for the lifecycle guarantees.
 */

export { COMPUTER_DIR_NAME, computerDirectories, getComputerPaths, type ComputerPaths } from "./paths";
export {
  appendActivity,
  directoryUsage,
  ensureComputer,
  ensureComputerDirs,
  getComputerStatus,
  readActivity,
  resetComputer,
  touchComputer,
  type ActivityEntry,
  type ActivityKind,
  type ComputerSession,
  type ComputerStatus,
  type ResetResult,
} from "./session";
export {
  ComputerPathError,
  DEFAULT_READ_BYTES,
  MAX_ATTACHMENT_BYTES,
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
  deleteComputerPath,
  exportToHost,
  isInside,
  listComputerDir,
  previewComputerFile,
  readComputerFile,
  resolveRuntimePath,
  sanitizeFilename,
  stageAttachmentBuffer,
  stageAttachmentFromHost,
  writeComputerFile,
  type ComputerEntry,
  type ComputerFileRead,
  type StagedAttachment,
} from "./files";
export { computerEnv, runInComputer, shellCommand, DEFAULT_TIMEOUT_MS, MAX_OUTPUT_BYTES, MAX_TIMEOUT_MS, type ExecResult } from "./exec";
export {
  findBrowserBinary,
  getComputerBrowserStatus,
  ensureComputerBrowser,
  openInComputerBrowser,
  stopComputerBrowser,
  type ComputerBrowser,
  type ComputerBrowserStatus,
} from "./browser";
export { COMPUTER_TOOL_NAMES, createComputerTools } from "./tools";
export {
  readBrowserPage,
  navigateBrowser,
  clickBrowserElement,
  typeBrowserElement,
  pressBrowserKey,
  screenshotBrowser,
  type BrowserActionOutcome,
  type PageSnapshot,
} from "./cdp";
