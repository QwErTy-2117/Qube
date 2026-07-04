import ZAI from "@lobehub/icons/es/ZAI";
import OpenAI from "@lobehub/icons/es/OpenAI";
import Gemma from "@lobehub/icons/es/Gemma";

export function docsModelOptions() {
  return [
    { id: "zai-glm-4.7", name: "GLM 4.7", icon: <ZAI size={16} /> },
    { id: "gpt-oss-120b", name: "GPT-OSS 120B", icon: <OpenAI size={16} /> },
    { id: "gemma-4-31b", name: "Gemma 4 31B", icon: <Gemma.Color size={16} /> },
  ];
}

