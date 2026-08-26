import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

function readLegalFile(filename: string): string {
  const tried: string[] = [];
  const cwd = process.cwd();
  const candidates = [
    join(/* turbopackIgnore: true */ cwd, filename),
    join(/* turbopackIgnore: true */ cwd, ".next", "standalone", filename),
    join(/* turbopackIgnore: true */ cwd, "..", filename),
    join(/* turbopackIgnore: true */ cwd, "..", ".next", "standalone", filename),
    join(/* turbopackIgnore: true */ cwd, "sidecar-dist", filename),
  ];
  for (const p of candidates) {
    tried.push(p);
    try {
      if (existsSync(p)) return readFileSync(p, "utf-8");
    } catch {}
    try {
      return readFileSync(p, "utf-8");
    } catch {}
  }
  const lastErr = new Error(`File not found. Tried: ${tried.join(", ")}`);
  (lastErr as any).tried = tried;
  throw lastErr;
}

export async function GET() {
  try {
    const content = readLegalFile("PRIVACY.md");
    return new Response(content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
