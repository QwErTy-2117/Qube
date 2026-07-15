export function detectModelThinkingSupport(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (
    // OpenAI reasoning models
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4") ||
    lower.includes("gpt-5") ||
    lower.includes("gpt-5.5") ||
    lower.includes("gpt-5.6") ||
    // Anthropic extended thinking models
    (lower.includes("claude") && /sonnet.*4\.\d|opus.*4\.\d|fable|mythos/.test(lower)) ||
    lower.includes("claude-4") ||
    lower.includes("claude-5") ||
    // Google reasoning
    lower.includes("gemini-2.5-pro") ||
    lower.includes("gemini-thinking") ||
    // DeepSeek
    lower.includes("deepseek-r1") ||
    lower.includes("deepseek-v3")
  ) {
    return true;
  }
  return false;
}
