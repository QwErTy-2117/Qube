/**
 * @deprecated Use lib/pi/model-client instead. Pi is authoritative.
 * This shim re-exports Pi model client for backward compat.
 */
export { createPiModelClient as createModelClient, createPiModelClientForRequest as createModelClientForRequest, isChatGPTModel, createModelClient as createPiModelClient, createModelClientForRequest as createPiModelClientForRequest } from "@/lib/pi/model-client";
