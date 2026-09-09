import { Base } from "@/components/examples/base";
import { HomeRoute } from "@/components/chat/chat-route";

export default function Page() {
  return (
    <main className="h-dvh overflow-hidden">
      <HomeRoute />
      <Base />
    </main>
  );
}
