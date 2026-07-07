import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Nvidia from "@lobehub/icons/es/Nvidia";
import XiaomiMiMo from "@lobehub/icons/es/XiaomiMiMo";
import { Sparkles } from "lucide-react";

export function docsModelOptions() {
  return [
    { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash", icon: <DeepSeek.Color size={16} /> },
    { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra", icon: <Nvidia.Color size={16} /> },
    { id: "mimo-v2.5-free", name: "MiMo V2.5", icon: <XiaomiMiMo size={16} /> },
  ];
}
