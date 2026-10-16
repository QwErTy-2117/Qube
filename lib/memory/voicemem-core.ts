/**
 * Backward-compat shim — the single memory implementation lives in
 * ./memory-store. This module re-exports it so older imports keep working.
 * New code must import from "@/lib/memory/memory-store" directly.
 */
export type { MemoryEntry, MemoryExtOpts, MemoryTier, RememberAction, RememberResult } from "./memory-store";
export {
  remember,
  warmup,
  addMemoryEntry,
  addMemoryEntryExt,
  getMemoryEntries,
  getTopEntries,
  deleteMemoryEntry,
  updateMemoryEntry,
  replaceAllEntries,
  clearMemory,
  getRelevantContext,
  getRelevantContextSemantic,
  detectContradictions,
  upsertMemoryWithContradictionCheck,
  searchMemories,
  consolidateMemories,
  getMemoryStats,
  prefetchQuery,
  getPrefetchCacheSize,
  isWarmedUp,
  getDualStore,
} from "./memory-store";
