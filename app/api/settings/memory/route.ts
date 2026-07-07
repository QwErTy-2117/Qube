import { NextResponse } from "next/server";
import { getMemoryEntries, addMemoryEntry, deleteMemoryEntry, clearMemory } from "@/lib/memory/memory-store";

export async function GET() {
  try {
    const entries = await getMemoryEntries();
    return NextResponse.json({ entries });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { category, content, relevance, confidence } = await req.json();
    if (!category || !content) {
      return NextResponse.json({ error: "Category and content are required" }, { status: 400 });
    }
    await addMemoryEntry(category, content, relevance, confidence);
    const entries = await getMemoryEntries();
    return NextResponse.json({ entries });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const deleted = await deleteMemoryEntry(id);
      if (!deleted) {
        return NextResponse.json({ error: "Memory entry not found" }, { status: 404 });
      }
    } else {
      await clearMemory();
    }

    const entries = await getMemoryEntries();
    return NextResponse.json({ entries });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
