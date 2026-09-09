"use client";

import { useEffect, useState } from "react";

type BrainStats = {
  left: number;
  right: number;
  cross: number;
  total: number;
  stm: number;
  ltm: number;
  warmedUp: boolean;
  prefetchCache: number;
};

type MemoryNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  type: "left-fact" | "right-persona" | "central";
  shape: "circle" | "triangle" | "square" | "diamond";
};

const LEFT_NODES: Omit<MemoryNode, "type">[] = [
  { id: "work", label: "work", x: 35, y: 28, shape: "circle" },
  { id: "health", label: "health", x: 52, y: 38, shape: "circle" },
  { id: "knowledge", label: "knowledge", x: 28, y: 45, shape: "circle" },
  { id: "daily_life", label: "daily_life", x: 38, y: 65, shape: "circle" },
  { id: "relationships", label: "relationships", x: 58, y: 62, shape: "circle" },
  { id: "goals", label: "goals", x: 42, y: 82, shape: "circle" },
  { id: "finance", label: "finance", x: 62, y: 80, shape: "circle" },
];

const RIGHT_NODES: Omit<MemoryNode, "type">[] = [
  { id: "emotion", label: "emotion", x: 72, y: 32, shape: "square" },
  { id: "personality", label: "personality", x: 75, y: 68, shape: "triangle" },
  { id: "preference", label: "preference", x: 62, y: 70, shape: "square" },
];

function BrainHemisphere({ side, nodes, stats }: { side: "left" | "right"; nodes: any[]; stats?: BrainStats | null }) {
  const isLeft = side === "left";
  return (
    <div className="relative flex-1 aspect-[4/5] bg-zinc-950 rounded-[2.5rem] border border-zinc-800 overflow-hidden">
      {/* Brain texture - subtle radial */}
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-900/50 to-transparent" />
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: `radial-gradient(circle at 50% 30%, white 1px, transparent 1px)`, backgroundSize: "18px 18px" }} />
      
      {/* Hemisphere outline */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path
          d={isLeft 
            ? "M 8 10 C 2 25, 5 75, 18 90 C 28 95, 45 92, 50 50 C 45 20, 25 5, 8 10 Z" 
            : "M 92 10 C 98 25, 95 75, 82 90 C 72 95, 55 92, 50 50 C 55 20, 75 5, 92 10 Z"}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="0.8"
        />
        {/* Gyri lines */}
        <path d={isLeft ? "M 20 30 C 25 35, 30 45, 28 60" : "M 80 30 C 75 35, 70 45, 72 60"} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
        <path d={isLeft ? "M 35 20 C 32 30, 35 50, 40 70" : "M 65 20 C 68 30, 65 50, 60 70"} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
      </svg>

      {/* Nodes */}
      {nodes.map((n) => (
        <div
          key={n.id}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
        >
          <div className="relative flex flex-col items-center">
            <div
              className={
                n.shape === "triangle" ? "size-2.5 bg-amber-500/90 rotate-45" :
                n.shape === "square" ? "size-2 bg-emerald-500/80 rounded-[2px]" :
                n.shape === "diamond" ? "size-2 bg-violet-500 rotate-45" :
                "size-1.5 bg-sky-400/70 rounded-full"
              }
              style={{ boxShadow: n.shape === "circle" ? "0 0 6px rgba(56,189,248,0.4)" : "0 0 6px rgba(0,0,0,0.5)" }}
            />
            <div className="mt-1 px-1 py-0.5 rounded bg-zinc-900/90 border border-zinc-700/50 backdrop-blur">
              <span className="text-[7px] font-medium tracking-wide text-zinc-300 whitespace-nowrap">{n.label}</span>
            </div>
          </div>
        </div>
      ))}

      {/* Small dots - the many memories */}
      {Array.from({ length: isLeft ? 28 : 18 }).map((_, i) => {
        const angle = (i / (isLeft ? 28 : 18)) * Math.PI * 2 + (isLeft ? 0 : Math.PI);
        const r = 32 + Math.random() * 18;
        const cx = 50 + Math.cos(angle) * (r * 0.45) + (isLeft ? -12 : 12);
        const cy = 50 + Math.sin(angle) * (r * 0.35);
        if (cx < 10 || cx > 90 || cy < 15 || cy > 88) return null;
        return (
          <div
            key={i}
            className="absolute size-1 rounded-full bg-sky-400/40"
            style={{ left: `${cx}%`, top: `${cy}%`, transform: "translate(-50%, -50%)" }}
          />
        );
      })}

      {/* Right brain triangles for personality */}
      {!isLeft && Array.from({ length: 8 }).map((_, i) => (
        <div key={`tri-${i}`} className="absolute size-1.5 bg-amber-500/60 rotate-45" style={{ left: `${68 + (i%3)*4}%`, top: `${72 + Math.floor(i/3)*4}%`, transform: "translate(-50%, -50%) rotate(45deg)" }} />
      ))}
    </div>
  );
}

export function MemoryBrain({ stats, liveInput, topKLeft, topKRight }: {
  stats?: BrainStats | null;
  liveInput?: { text: string; speaker: string; emotion: string; entity: string; schema: string };
  topKLeft?: string[];
  topKRight?: string[];
}) {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const id = setInterval(()=> setPulse(p=> (p+1)%2), 1200);
    return ()=> clearInterval(id);
  }, []);

  return (
    <div className="w-full bg-black rounded-2xl border border-zinc-800 overflow-hidden">
      {/* Top bar like VoiceMem demo: Chat | Memory Space | demo (32/30) | demo (69) | EN | All memories */}
      <div className="h-9 flex items-center gap-1.5 px-3 bg-zinc-900 border-b border-zinc-800 text-[11px]">
        <div className="px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-400">Chat</div>
        <div className="px-2.5 py-1 rounded-full bg-white text-black font-medium">Memory Space</div>
        <div className="px-2 py-1 rounded-full bg-zinc-800 text-zinc-300 flex items-center gap-1">
          <span className="size-2 rounded-full bg-emerald-500" />
          demo ({stats?.total ?? 69}/{stats?.stm ?? 30})
        </div>
        <div className="px-2 py-1 rounded-full bg-zinc-800 text-zinc-400">demo ({stats?.total ?? 69})</div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="px-2 py-1 rounded-full bg-zinc-800 text-zinc-400">EN</span>
          <span className="px-2 py-1 rounded-full bg-zinc-800 text-zinc-400 hidden sm:inline">All memories in this space</span>
          <span className={`size-2 rounded-full ${stats?.warmedUp ? "bg-emerald-500" : "bg-amber-500"} ${pulse===0?"opacity-100":"opacity-60"}`} />
        </div>
      </div>

      <div className="flex gap-0 bg-black">
        {/* Left panel: LIVE INPUT etc. like demo */}
        <div className="w-[280px] shrink-0 border-r border-zinc-800 p-3 space-y-3 hidden lg:block">
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-3">
            <div className="text-[10px] font-bold tracking-widest text-zinc-500 mb-2">LIVE INPUT</div>
            <div className="flex items-center gap-2 text-[11px] text-zinc-300">
              <span className="size-5 rounded-full bg-sky-500 flex items-center justify-center text-[10px] text-white">你</span>
              <span className="text-zinc-500">speaker 7 · recognized as “你”</span>
              <span className="ml-auto text-zinc-600">···</span>
            </div>
            <div className="mt-2 text-xs text-zinc-500">Waiting for you to speak...</div>
            <div className="mt-2 h-7 rounded bg-zinc-950 border border-zinc-800 flex items-center px-2 text-[11px] text-zinc-600">or type directly</div>
            <div className="mt-2 flex gap-1 text-[10px] text-zinc-600">
              <span>emotion —</span><span>entity —</span><span>schema —</span>
            </div>
          </div>

          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-3">
            <div className="text-[10px] font-bold tracking-widest text-zinc-500">TOP-K 召回</div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
              <div>
                <div className="text-zinc-500 text-[10px]">左脑 · 事实</div>
                <div className="text-zinc-400 mt-1">{topKLeft?.[0] || "Waiting for retrieval..."}</div>
                <div className="text-zinc-600 text-[10px]">{topKLeft ? `${topKLeft.length} memories` : "—"}</div>
              </div>
              <div>
                <div className="text-zinc-500 text-[10px]">右脑 · 画像</div>
                <div className="text-zinc-400 mt-1">{topKRight?.[0] || "Waiting for retrieval..."}</div>
                <div className="text-zinc-600 text-[10px]">{topKRight ? `${topKRight.length} memories` : "—"}</div>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-3">
            <div className="text-[10px] font-bold tracking-widest text-zinc-500">AI 回复</div>
            <div className="text-xs text-zinc-600 mt-1">No reply yet.</div>
          </div>
        </div>

        {/* Center: Dual hemispheres like video */}
        <div className="flex-1 relative bg-black p-4 flex items-center justify-center gap-2">
          <BrainHemisphere side="left" nodes={LEFT_NODES} stats={stats} />
          {/* Central you node like demo */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
            <div className="size-5 rounded-full bg-pink-500/90 border-2 border-white/20 flex items-center justify-center shadow-lg">
              <span className="text-[8px] font-bold text-white">you</span>
            </div>
            <div className="absolute inset-0 rounded-full bg-pink-500/20 animate-ping" />
          </div>
          <BrainHemisphere side="right" nodes={RIGHT_NODES} stats={stats} />

          {/* Play button overlay like video thumbnail */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="size-12 rounded-full bg-white/10 backdrop-blur flex items-center justify-center border border-white/10">
              <div className="size-0 border-l-[14px] border-l-white border-y-[8px] border-y-transparent ml-1" />
            </div>
          </div>

          {/* Bottom timeline like video */}
          <div className="absolute bottom-2 left-4 right-4 h-6 flex items-center gap-2 text-[10px] text-zinc-600">
            <span>0:00 / 1:00</span>
            <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full w-[2%] bg-white/60" />
            </div>
          </div>
        </div>
      </div>

      {/* Stats footer like VoiceMem demo */}
      <div className="h-7 flex items-center gap-3 px-3 bg-zinc-900 border-t border-zinc-800 text-[10px] font-mono text-zinc-500">
        <span>Left: {stats?.left ?? 0} · Right: {stats?.right ?? 0} · Cross: {stats?.cross ?? 0}</span>
        <span className="hidden sm:inline">· STM {stats?.stm ?? 0} · LTM {stats?.ltm ?? 0} · Top-K 5 · ~430 tokens</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${stats?.warmedUp ? "bg-emerald-500" : "bg-amber-500"}`} />
          {stats?.warmedUp ? "Streaming ready" : "Warming…"} · {stats?.prefetchCache ?? 0} prefetched · 0–300 ms
        </span>
      </div>
    </div>
  );
}
