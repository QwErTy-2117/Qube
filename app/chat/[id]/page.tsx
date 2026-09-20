import { ChatRoute } from "@/components/chat/chat-route";

/**
 * Deep-link route: only the route effect lives here. The thread UI itself
 * renders once in the persistent AppShell, so switching chats never
 * remounts it (sidebar switches, send handoff animations all keep state).
 */
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatRoute id={id} />;
}
