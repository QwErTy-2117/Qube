export function detectModelImageSupport(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (
    lower.includes("vision") ||
    lower.includes("vqa") ||
    lower.includes("multimodal") ||
    lower.includes("image") ||
    lower.includes("vl") ||
    lower.includes("pixtral") ||
    lower.includes("llava") ||
    lower.includes("cogvlm") ||
    lower.includes("cogview") ||
    lower.includes("glm-4v") ||
    lower.includes("minicpm") ||
    lower.includes("deepseek-vl") ||
    lower.includes("idefics") ||
    lower.includes("florence") ||
    lower.includes("internvl") ||
    lower.includes("internlm") ||
    lower.includes("paligemma") ||
    lower.includes("moondream") ||
    lower.includes("reka") ||
    lower.includes("kosmos") ||
    lower.includes("fuyu") ||
    lower.includes("imp-v") ||
    lower.includes("qwen-vl") ||
    lower.includes("qwen2-vl") ||
    (lower.includes("claude") && /3(\.\d)?|4|5/.test(lower)) ||
    (lower.includes("gemini") && !lower.includes("gemma")) ||
    lower.includes("gpt-4o") ||
    lower.includes("gpt-4.1") ||
    lower.includes("gpt-4.5") ||
    lower.includes("gpt-4-turbo") ||
    lower.includes("o1") ||
    lower.includes("o3") ||
    lower.includes("llama-3.2") ||
    lower.includes("phi-3-vision") ||
    lower.includes("phi-3.5-vision") ||
    lower.includes("phi-4")
  ) {
    return true;
  }
  return false;
}
