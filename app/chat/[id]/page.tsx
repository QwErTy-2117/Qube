import { Base } from "@/components/examples/base";
import { ChatRoute } from "@/components/chat/chat-route";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="h-dvh overflow-hidden">
      <ChatRoute id={id} />
      <Base />
    </main>
  );
}
