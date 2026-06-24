import { AgentRuntimeProvider } from "@/components/assistant-ui/agent-runtime-provider";
import { Base } from "@/components/examples/base";

export default function Page() {
  return (
    <main className="h-dvh overflow-hidden">
      <AgentRuntimeProvider>
        <Base />
      </AgentRuntimeProvider>
    </main>
  );
}
