import { Type } from "@earendil-works/pi-ai";
import { createRegistry, defineExtension, defineTool } from "@earendil-works/pi-durable";
import { readFile } from "node:fs/promises";

const readFileTool = defineTool({
  name: "read_file",
  description: "Read a workspace file",
  parameters: Type.Object({ path: Type.String() }),
  replay: "safe",
  execute: async (args) => {
    const text = await readFile(args.path, "utf-8").catch((e: Error) => `Error: ${e.message}`);
    return { content: [{ type: "text", text: text.slice(0, 20000) }] };
  },
});

const writeFileTool = defineTool({
  name: "write_file",
  description: "Write a workspace file (never auto-replayed after crash)",
  parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  execute: async () => ({ content: [{ type: "text", text: "written (stub)" }] }),
});

export async function buildDurableRegistry() {
  const registry = createRegistry();
  registry.install(defineExtension({ name: "workspace", tools: [readFileTool, writeFileTool] }));
  return registry;
}

export function approvalMemoKey(tool: string, argsHash: string): string {
  return `approval:${tool}:${argsHash}`;
}
