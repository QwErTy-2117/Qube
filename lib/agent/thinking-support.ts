export function detectModelThinkingSupport(modelId: unknown): boolean {
  const lower = String(modelId ?? "").toLowerCase();
  if (!lower) return false;
  if (
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4") ||
    lower.includes("gpt-5") ||
    lower.includes("gpt-6") ||
    lower.includes("gpt-reserve") ||
    lower.includes("gpt-oss") ||
    (lower.includes("claude") && /sonnet.*4\.\d|opus.*4\.\d|fable|mythos/.test(lower)) ||
    lower.includes("claude-4") ||
    lower.includes("claude-5") ||
    lower.includes("gemini-2.5-pro") ||
    lower.includes("gemini-thinking") ||
    lower.includes("deepseek-r1") ||
    lower.includes("deepseek-v3") ||
    lower.includes("deepseek-v3.1") ||
    lower.includes("qwen3") ||
    lower.includes("qwq") ||
    lower.includes("magistral") ||
    lower.includes("phi-4-reasoning") ||
    lower.includes("phi4-reasoning") ||
    lower.includes("reasoning") ||
    lower.includes("think")
  ) {
    return true;
  }
  return false;
}
