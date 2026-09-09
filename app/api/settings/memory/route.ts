import { NextResponse } from "next/server";
import { getMemoryEntries, addMemoryEntry, deleteMemoryEntry, clearMemory } from "@/lib/memory/memory-store";
import { getDualStore, isWarmedUp, getPrefetchCacheSize } from "@/lib/memory/voicemem-core";

export async function GET() {
  try {
    const [entries, dual] = await Promise.all([getMemoryEntries(), getDualStore().catch(()=>null)]);
    const stats = dual ? {
      left: dual.left.length,
      right: dual.right.length,
      cross: dual.cross.length,
      total: dual.left.length + dual.right.length + dual.cross.length,
      warmedUp: isWarmedUp(),
      prefetchCache: getPrefetchCacheSize(),
      // hierarchical: hot is STM recent, cold is rest
      stm: [...dual.left, ...dual.right, ...dual.cross].filter(e=>e.stm).length,
      ltm: [...dual.left, ...dual.right, ...dual.cross].filter(e=>!e.stm).length,
    } : null;
    return NextResponse.json({ entries, stats });
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

    const [entries, dual] = await Promise.all([getMemoryEntries(), import("@/lib/memory/voicemem-core").then(m=>m.getDualStore().catch(()=>null))]);
    const stats = dual ? {
      left: dual.left.length, right: dual.right.length, cross: dual.cross.length,
      total: dual.left.length+dual.right.length+dual.cross.length,
      warmedUp: (await import("@/lib/memory/voicemem-core")).isWarmedUp(),
      prefetchCache: (await import("@/lib/memory/voicemem-core")).getPrefetchCacheSize(),
      stm: [...dual.left, ...dual.right, ...dual.cross].filter(e=>e.stm).length,
      ltm: [...dual.left, ...dual.right, ...dual.cross].filter(e=>!e.stm).length,
    } : null;
    return NextResponse.json({ entries, stats });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
