import { SiGoogle } from "react-icons/si";
import { cn } from "@/lib/utils";

export function renderConnectorIcon(icon: string, className?: string) {
  return <SiGoogle className={cn("h-5 w-5", className)} />;
}
