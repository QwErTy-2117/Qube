/**
 * Memory store — now powered by VoiceMem-inspired dual-brain (left/right) streaming core.
 * API remains identical for backward compat; internally delegates to voicemem-core.
 * UI never references VoiceMem.
 */

export type { MemoryEntry } from "./voicemem-core";
export {
  addMemoryEntry,
  getMemoryEntries,
  deleteMemoryEntry,
  updateMemoryEntry,
  replaceAllEntries,
  clearMemory,
  getRelevantContext,
  getRelevantContextSemantic,
  detectContradictions,
  upsertMemoryWithContradictionCheck,
} from "./voicemem-core";

// Additional VoiceMem streaming APIs re-exported for harness use (not UI)
export { warmup, prefetchQuery, getPrefetchCacheSize, isWarmedUp, getDualStore } from "./voicemem-core";
