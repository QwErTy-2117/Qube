export function migrateThreadRecord(rec: { id: string; title: string }) {
  return { id: rec.id.slice(0, 128), title: rec.title.slice(0, 120) || "New Chat" };
}
