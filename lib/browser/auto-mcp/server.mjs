#!/usr/bin/env node
/**
 * Qube Auto Browser MCP — zero-setup, managed-Chrome backed.
 * Exposes the same tools as `obu mcp` (open_tab, navigate, tabs, page_info, cdp, etc.)
 * but drives the shared managed Chromium via CDP on 127.0.0.1:9222.
 * No extension, no npx setup, no socket — works automatically.
 * Adapted from open-browser-use tool shapes to Qube's side-panel CDP.
 */

let cdpEndpoint = process.env.BROWSER_CDP_ENDPOINT || "http://127.0.0.1:9222";
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === "--cdp-endpoint" && process.argv[i+1]) cdpEndpoint = process.argv[i+1];
}
const baseUrl = () => cdpEndpoint.replace(/\/$/, "");

async function devtools(path, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try { return await fetch(`${baseUrl()}${path}`, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}
async function listTargets() {
  const r = await devtools("/json/list"); if (!r.ok) return []; return await r.json();
}
async function getPageTarget(preferNewest = true) {
  const targets = await listTargets();
  const pages = targets.filter(t => t.type === "page" && t.webSocketDebuggerUrl);
  const http = pages.filter(p => /^https?:\/\//i.test(p.url));
  const pool = http.length ? http : pages;
  return preferNewest ? pool[pool.length-1] || null : pool[0] || null;
}
async function ensureTarget() {
  let t = await getPageTarget();
  if (t) return t;
  await devtools("/json/new?about:blank", { method: "PUT" });
  await new Promise(r=>setTimeout(r,600));
  return await getPageTarget();
}
let _cdpId = 1;
async function cdpCall(target, method, params={}) {  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error("No wsUrl");
  const { default: WebSocket } = await import("ws");
  return new Promise((resolve, reject)=>{
    const ws = new WebSocket(wsUrl, { handshakeTimeout: 8000 });
    let done=false;
    const id = _cdpId++ % 100000;
    const timer=setTimeout(()=>{ if(!done){done=true; try{ws.close();}catch{} reject(new Error(`CDP ${method} timeout`));}}, 8000);
    ws.on("open",()=> ws.send(JSON.stringify({id, method, params})));
    ws.on("message", raw=>{
      try{
        const msg=JSON.parse(raw.toString());
        if(msg.id===id){ clearTimeout(timer); done=true; try{ws.close();}catch{}; if(msg.error) reject(new Error(msg.error.message||JSON.stringify(msg.error))); else resolve(msg.result); }
      }catch{}
    });
    ws.on("error", e=>{ if(!done){done=true; clearTimeout(timer); reject(e);} });
  });
}

// ---------- Self-healing refs ----------
// snapshot injects data-qube-ref attrs into live DOM nodes. SPAs and dynamic
// pages (autocomplete, ads, React re-renders) replace those nodes, wiping the
// attrs — the classic "stale ref" loop (snapshot → act → stale → snapshot…,
// a model round-trip per cycle). To break it:
// 1. Every snapshot stores per-ref descriptors {role,name,tag,type,href}.
// 2. act auto-recovers a stale ref: fresh capture + fuzzy re-match + re-tag,
//    zero extra model calls in the common case.
// 3. Unrecoverable errors come back WITH a fresh snapshot attached, so the
//    model retries with new refs in ONE step instead of two.
const SNAP_SEL = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [onclick]';
let lastSnap = { url: "", at: 0, refs: new Map() };

const normTxt = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 120);
const samePage = (a, b) => {
  try {
    const u = (s) => String(s || "").split("#")[0].replace(/\/$/, "");
    return u(a) === u(b);
  } catch { return false; }
};

function snapshotExpr() {
  return `(() => {
    const text=(document.body?document.body.innerText:"").slice(0,4000);
    const nodes=Array.from(document.querySelectorAll(${JSON.stringify(SNAP_SEL)})).slice(0,80);
    let n=0; const els=[];
    for(let idx=0; idx<nodes.length; idx++){ const el=nodes[idx]; n++;
      const rect=el.getBoundingClientRect?el.getBoundingClientRect():null;
      if(rect&&(rect.width===0&&rect.height===0)) continue;
      const tag=(el.tagName||"").toLowerCase();
      const type=((el.getAttribute&&el.getAttribute("type"))||"").toLowerCase();
      const role=(el.getAttribute&&el.getAttribute("role"))||(tag==="a"?"link":tag==="button"?"button":tag||"element");
      let name=((el.getAttribute&&(el.getAttribute("aria-label")||el.innerText||el.value||el.placeholder||el.name||el.id||tag))||tag||"element").toString().replace(/\\s+/g," ").trim().slice(0,120);
      const href=(tag==="a"&&(el.getAttribute&&el.getAttribute("href"))||"").toString().slice(0,200);
      let value=""; try{ if(tag==="input"&&type==="password") value="***"; else if(tag==="input"||tag==="textarea"||tag==="select") value=String(el.value||"").slice(0,200);}catch{}
      els.push({ref:"e"+n,idx,role,name,tag,type,href,value});
      try{el.setAttribute("data-qube-ref","e"+n);}catch{}
    }
    const tree=els.length?els.map(e=>"- "+e.role+' "'+e.name+'" ['+e.ref+"]"+(e.value?" value="+JSON.stringify(e.value):"")).join("\\n"):"(no interactive elements)";
    return {title:document.title,url:location.href,text,tree,elements:els};
  })()`;
}

async function captureSnapshot(target) {
  const r = await cdpCall(target, "Runtime.evaluate", { expression: snapshotExpr(), returnByValue: true, awaitPromise: true });
  const v = r.result?.value || {};
  const elements = Array.isArray(v.elements) ? v.elements : [];
  lastSnap = { url: v.url || target.url || "", at: Date.now(), refs: new Map(elements.map((e) => [e.ref, e])) };
  const text = `Title: ${v.title || ""}\nURL: ${v.url || target.url}\n\n${(v.text || "").slice(0, 4000)}\n\n${v.tree || ""}`.slice(0, 10000);
  return { title: v.title || "", url: v.url || target.url || "", tree: v.tree || "", text, elements };
}

function matchScore(want, cand) {
  let s = 0;
  if (want.tag && want.tag === cand.tag) s += 2;
  if (want.role && want.role === cand.role) s += 1;
  if (want.type && want.type === cand.type) s += 1;
  const wn = normTxt(want.name), cn = normTxt(cand.name);
  if (wn && wn === cn) s += 4;
  else if (wn && cn && wn.length > 3 && (cn.includes(wn) || wn.includes(cn))) s += 2;
  if (want.href && want.href === cand.href) s += 4;
  return s;
}

function findMatch(want, elements) {
  let best = null, bestScore = 0;
  for (const c of elements) {
    const s = matchScore(want, c);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return bestScore >= 6 ? best : null;
}

// Re-tag the node at enumeration index idx with ref (same selector/order as capture).
async function retagByIndex(t, idx, ref) {
  const expr = `(() => { const nodes=Array.from(document.querySelectorAll(${JSON.stringify(SNAP_SEL)})); const el=nodes[${Math.max(0, idx | 0)}]; if(!el) return false; try{el.setAttribute("data-qube-ref",${JSON.stringify(ref)});}catch{} return true; })()`;
  const r = await cdpCall(t, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  return !!r.result?.value;
}

async function refExists(t, ref) {
  const expr = `(()=>{const el=document.querySelector('[data-qube-ref="${ref}"]');return !!el;})()`;
  const r = await cdpCall(t, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  return !!r.result?.value;
}

// Ensure ref resolves; auto-heal via fresh capture + descriptor re-match.
// Returns {recovered:boolean, note?:string} or throws with fresh snapshot attached.
async function ensureRef(t, ref) {
  try {
    if (await refExists(t, ref)) return { recovered: false };
  } catch {}
  const want = lastSnap.refs.get(ref);
  const oldUrl = lastSnap.url;
  // Let any in-flight render settle, then capture fresh (also refreshes lastSnap).
  await new Promise((r) => setTimeout(r, 350));
  let snap;
  try {
    snap = await captureSnapshot(t);
  } catch (e) {
    throw new Error(`Stale ref ${ref}: page unreachable (${e.message || e}). Take a fresh snapshot and retry in this same turn — do not stop or summarize.`);
  }
  const freshBlock = `\n\nFresh snapshot (use these new refs NOW, same turn — do not stop):\n${snap.tree}`.slice(0, 4500);
  if (!want) {
    throw new Error(`Stale ref ${ref}: unknown ref (page changed).${freshBlock}`);
  }
  if (!samePage(oldUrl, snap.url)) {
    throw new Error(`Stale ref ${ref}: page navigated (${oldUrl || "?"} → ${snap.url || "?"}).${freshBlock}`);
  }
  const match = findMatch(want, snap.elements);
  if (!match) {
    throw new Error(`Stale ref ${ref} ("${String(want.name || "").slice(0, 80)}"): element is gone after re-render and no confident match was found.${freshBlock}`);
  }
  const ok = await retagByIndex(t, match.idx, ref).catch(() => false);
  if (!ok) {
    throw new Error(`Stale ref ${ref}: re-match found "${String(match.name || "").slice(0, 80)}" but re-tagging failed.${freshBlock}`);
  }
  return { recovered: true, note: `${ref}→${match.ref} ("${String(match.name || "").slice(0, 60)}")` };
}

// Repetition guard: identical back-to-back calls that change nothing are the
// signature of a loop. Never blocks — annotates with a strategy-switch hint.
let lastSig = { sig: "", count: 0 };
function repetitionNote(name, args) {
  let sig = name;
  try { sig = name + ":" + JSON.stringify(args || {}).slice(0, 300); } catch {}
  if (name === "snapshot" || name === "navigate" || name === "open_tab") {
    lastSig = { sig: "", count: 0 };
    return "";
  }
  if (sig === lastSig.sig) lastSig.count++;
  else lastSig = { sig, count: 1 };
  if (lastSig.count >= 3) {
    return `\n\nNote: you've run this exact call ${lastSig.count} times in a row without progress. SWITCH STRATEGY now: navigate directly to the target URL (e.g. a site search URL like https://www.amazon.com/s?k=QUERY, a product/cart URL) instead of clicking through the page, or use different refs/approach. Do not repeat this call again.`;
  }
  return "";
}

const tools = {
  ping: {
    description: "Ping browser backend.",
    inputSchema: { type:"object", properties:{}, additionalProperties:false },
    fn: async()=>{
      const r=await devtools("/json/version");
      if(!r.ok) throw new Error("Browser not reachable");
      const j=await r.json();
      return { content:[{type:"text", text: JSON.stringify(j)}] };
    }
  },
  open_tab: {
    description: "Open a new tab and optionally navigate to URL. Auto-creates managed Chrome if needed.",
    inputSchema: { type:"object", properties:{ url:{type:"string"} }, additionalProperties:false },
    fn: async({url})=>{
      if (url && /^https?:\/\//i.test(url)) {
        // Try to reuse current tab via CDP navigate first, else new tab
        const t=await ensureTarget();
        try { await cdpCall(t,"Page.navigate",{url}); await new Promise(r=>setTimeout(r,900)); const cur=await getPageTarget(); return { content:[{type:"text", text: `Opened ${url} (navigated current tab, now ${cur?.url||url})`}] }; } catch {}
        const r=await devtools(`/json/new?${encodeURIComponent(url)}`,{method:"PUT"});
        const j=await r.json().catch(()=>({}));
        return { content:[{type:"text", text: `Opened new tab ${url} id=${j.id||"unknown"}`}] };
      }
      const r=await devtools("/json/new?about:blank",{method:"PUT"});
      const j=await r.json().catch(()=>({}));
      return { content:[{type:"text", text: `Opened blank tab id=${j.id||"unknown"}`}] };
    }
  },
  navigate: {
    description: "Navigate current tab to URL.",
    inputSchema: { type:"object", properties:{ url:{type:"string"}, tab_id:{type:"integer"} }, required:["url"], additionalProperties:false },
    fn: async({url, tab_id})=>{
      if(!url || !/^https?:\/\//i.test(url)) throw new Error("valid url required");
      let target=null;
      if(tab_id){
        const all=await listTargets();
        target=all.find(t=> String(t.id)===String(tab_id));
      }
      if(!target) target=await ensureTarget();
      await cdpCall(target,"Page.navigate",{url});
      await new Promise(r=>setTimeout(r,900));
      const cur=await getPageTarget();
      return { content:[{type:"text", text: `Navigated to ${url} (now ${cur?.url||url})`}] };
    }
  },
  tabs: {
    description: "List session tabs.",
    inputSchema: { type:"object", properties:{}, additionalProperties:false },
    fn: async()=>{
      const all=await listTargets();
      const pages=all.filter(t=>t.type==="page").map(t=>({id:t.id, url:t.url, title:t.title||""}));
      return { content:[{type:"text", text: JSON.stringify(pages,null,2)}] };
    }
  },
  user_tabs: {
    description: "List user tabs (same as tabs in auto mode).",
    inputSchema: { type:"object", properties:{}, additionalProperties:false },
    fn: async()=>{
      const all=await listTargets();
      const pages=all.filter(t=>t.type==="page").map(t=>({id:t.id, url:t.url, title:t.title||""}));
      return { content:[{type:"text", text: JSON.stringify(pages,null,2)}] };
    }
  },
  page_info: {
    description: "Read title, URL, and body text from current tab.",
    inputSchema: { type:"object", properties:{ tab_id:{type:"integer"} }, additionalProperties:false },
    fn: async({tab_id})=>{
      let target=null;
      if(tab_id){ const all=await listTargets(); target=all.find(t=> String(t.id)===String(tab_id));}
      if(!target) target=await ensureTarget();
      const r=await cdpCall(target,"Runtime.evaluate",{expression:"({title: document.title, url: location.href, text: document.body.innerText.slice(0,8000), html: document.documentElement.outerHTML.slice(0,12000)})", returnByValue:true, awaitPromise:true});
      const v=r.result?.value||{};
      return { content:[{type:"text", text: `Title: ${v.title||""}\nURL: ${v.url||target.url}\n\n${v.text||""}`.slice(0,10000)}] };
    }
  },
  snapshot: {
    description: "Capture bounded accessibility snapshot with element refs (e1, e2, … up to 80). Masks password values. Use refs with the act tool. Stale refs self-heal (auto re-match); if recovery fails you get a fresh snapshot back in the error. If a control is missing here entirely (below fold, canvas-rendered, unusual roles), use screenshot to SEE the page, then click by x,y coordinates.",
    inputSchema: { type:"object", properties:{ tab_id:{type:"integer"} }, additionalProperties:false },
    fn: async({tab_id})=>{
      let target=null;
      if(tab_id){ const all=await listTargets(); target=all.find(t=> String(t.id)===String(tab_id));}
      if(!target) target=await ensureTarget();
      const snap=await captureSnapshot(target);
      return { content:[{type:"text", text: snap.text}] };
    }
  },
  screenshot: {
    description: "Capture a JPEG screenshot of the current tab viewport that you can SEE. Use when a control is missing from snapshot (below fold, canvas-rendered, unusual roles): LOOK at the image, estimate the control's x,y in CSS viewport pixels, then click via the click tool or act. Coordinates match click x,y exactly.",
    inputSchema: { type:"object", properties:{ fullPage:{type:"boolean", description:"Capture beyond the viewport (full page height)"} }, additionalProperties:false },
    fn: async({fullPage})=>{
      const t=await ensureTarget();
      const res=await cdpCall(t,"Page.captureScreenshot",{format:"jpeg",quality:60,captureBeyondViewport:!!fullPage});
      const data=res?.data||"";
      if(!data) throw new Error("empty screenshot — browser may be unreachable");
      const kb=(data.length/1024).toFixed(0);
      return { content:[
        {type:"text", text:`Screenshot captured (${kb}KB jpeg). LOOK at it: find the target control, estimate its x,y in CSS viewport pixels, then use click {x,y}. If you cannot see it, scroll or snapshot again — do not stop.`},
        {type:"image", data, mimeType:"image/jpeg"}
      ]};
    }
  },
  cdp: {
    description: "Run a CDP command on current tab. Example: Runtime.evaluate, Input.dispatchMouseEvent, Page.captureScreenshot.",
    inputSchema: { type:"object", properties:{ method:{type:"string"}, params:{type:"object", default:{}}, tab_id:{type:"integer"} }, required:["method"], additionalProperties:false },
    fn: async({method, params, tab_id})=>{
      let target=null;
      if(tab_id){ const all=await listTargets(); target=all.find(t=> String(t.id)===String(tab_id));}
      if(!target) target=await ensureTarget();
      const res=await cdpCall(target, method, params||{});
      return { content:[{type:"text", text: JSON.stringify(res,null,2).slice(0,8000)}] };
    }
  },
  click: {
    description: "Click at x,y in current tab viewport.",
    inputSchema: { type:"object", properties:{ x:{type:"number"}, y:{type:"number"}, button:{type:"string", default:"left"} }, required:["x","y"], additionalProperties:false },    fn: async({x,y,button})=>{
      const t=await ensureTarget();
      const p={x:Math.round(x), y:Math.round(y), button:button||"left", clickCount:1};
      await cdpCall(t,"Input.dispatchMouseEvent",{...p, type:"mousePressed"});
      await cdpCall(t,"Input.dispatchMouseEvent",{...p, type:"mouseReleased"});
      return { content:[{type:"text", text:`Clicked ${x},${y}`}] };
    }
  },
  type: {
    description: "Type text into focused element.",
    inputSchema: { type:"object", properties:{ text:{type:"string"} }, required:["text"], additionalProperties:false },
    fn: async({text})=>{
      const t=await ensureTarget();
      await cdpCall(t,"Input.insertText",{text});
      return { content:[{type:"text", text:`Typed ${text.length} chars`}] };
    }
  },
  press_key: {
    description: "Press a key like Enter, Tab, Escape.",
    inputSchema: { type:"object", properties:{ key:{type:"string"} }, required:["key"], additionalProperties:false },
    fn: async({key})=>{
      const t=await ensureTarget();
      const map={Enter:{key:"Enter",code:"Enter",windowsVirtualKeyCode:13}, Tab:{key:"Tab",code:"Tab",windowsVirtualKeyCode:9}, Escape:{key:"Escape",code:"Escape",windowsVirtualKeyCode:27}, Backspace:{key:"Backspace",code:"Backspace",windowsVirtualKeyCode:8}};
      const spec=map[key]||{key,code:key, windowsVirtualKeyCode:key.length===1?key.charCodeAt(0):0};
      await cdpCall(t,"Input.dispatchKeyEvent",{...spec, type:"keyDown"});
      await cdpCall(t,"Input.dispatchKeyEvent",{...spec, type:"keyUp"});
      return { content:[{type:"text", text:`Pressed ${key}`}] };
    }
  },
  act: {
    description: "Act on snapshot refs (up to 24): [{kind:'click',ref:'e1'},{kind:'fill'|'type',ref:'e2',text:'...'}]. Stale refs self-heal automatically (re-matched after re-render) — just use the latest snapshot's refs; if recovery fails you get a fresh snapshot back, retry in the SAME turn. Only already-completed actions must not be repeated.",
    inputSchema: { type:"object", properties:{ actions:{type:"array", items:{type:"object"}} }, required:["actions"], additionalProperties:false },
    fn: async({actions})=>{
      if(!Array.isArray(actions)||!actions.length) throw new Error("act requires at least one action");
      if(actions.length>24) throw new Error("act accepts at most 24 actions");
      const t=await ensureTarget();
      let completed=0;
      const recovered=[];
      for(const a of actions){
        const kind=String(a.kind||"");
        const ref=String(a.ref||"").trim();
        if(!ref) throw new Error("act action requires ref");
        // Resolve + self-heal BEFORE attempting (each action re-resolved, so
        // mid-batch re-renders e.g. autocomplete don't kill the batch).
        try {
          const h=await ensureRef(t, ref);
          if(h.recovered) recovered.push(h.note);
        } catch(e) {
          const done=completed>0?` (confirmed ${completed}/${actions.length} actions before this failure; do NOT repeat those)`:"";
          throw new Error(`${e.message||String(e)}${done}`);
        }
        if(kind==="click"){
          const expr=`(() => { const el=document.querySelector('[data-qube-ref="'+ref+'"]'); if(!el) return {found:false}; el.scrollIntoView({block:"center"}); el.click(); return {found:true}; })()`;
          const r=await cdpCall(t,"Runtime.evaluate",{expression:expr, returnByValue:true, awaitPromise:true});
          // ensureRef resolved this ref milliseconds ago; a miss here is a mid-action re-render race.
          if(!r.result?.value?.found) throw new Error(`Ref ${ref} vanished mid-action (page re-rendered between resolve and click). Take the hit as transient: snapshot once and retry in this same turn — do not stop.`);
        } else if(kind==="fill"||kind==="type"){
          if(typeof a.text!=="string") throw new Error(`act ${kind} requires text`);
          const expr=`(() => { const el=document.querySelector('[data-qube-ref="'+ref+'"]'); if(!el) return {found:false}; el.scrollIntoView({block:"center"}); el.focus(); return {found:true, tag:el.tagName}; })()`;
          const r=await cdpCall(t,"Runtime.evaluate",{expression:expr, returnByValue:true, awaitPromise:true});
          if(!r.result?.value?.found) throw new Error(`Ref ${ref} vanished mid-action (page re-rendered between resolve and fill). Take the hit as transient: snapshot once and retry in this same turn — do not stop.`);
          const tag=r.result.value.tag;
          if(kind==="fill"&&(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT")){
            const expr2=`(() => { const el=document.querySelector('[data-qube-ref="'+ref+'"]'); el.value=${JSON.stringify(a.text)}; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;
            await cdpCall(t,"Runtime.evaluate",{expression:expr2, returnByValue:true, awaitPromise:true});
          } else {
            await cdpCall(t,"Input.insertText",{text:String(a.text)});
          }
        } else throw new Error(`unsupported act kind ${kind}`);
        completed++;
        await new Promise(r=>setTimeout(r,250));
      }
      const healNote = recovered.length ? ` (auto-recovered stale refs: ${recovered.join("; ")})` : "";
      return { content:[{type:"text", text:`Acted ${completed}/${actions.length} by ref${healNote}`}] };
    }
  },
  run_action_plan: {
    description: "Run a line-oriented action plan (each line: navigate <url> | click <x> <y> | type <text> | press <key> | wait <ms> | eval <js>).",
    inputSchema: { type:"object", properties:{ script:{type:"string"} }, required:["script"], additionalProperties:false },
    fn: async({script})=>{
      const lines=String(script).split("\n").map(s=>s.trim()).filter(Boolean);
      const out=[];
      for(const line of lines){
        const [cmd, ...rest]=line.split(" ");
        try{
          if(cmd==="navigate"){ const url=rest.join(" "); await tools.navigate.fn({url}); out.push(`navigated ${url}`); }
          else if(cmd==="click"){ const [x,y]=rest.map(Number); await tools.click.fn({x,y}); out.push(`clicked ${x},${y}`); }
          else if(cmd==="type"){ const text=line.slice(5); await tools.type.fn({text}); out.push(`typed ${text.slice(0,40)}`); }
          else if(cmd==="press"){ await tools.press_key.fn({key:rest[0]}); out.push(`pressed ${rest[0]}`); }
          else if(cmd==="wait"){ await new Promise(r=>setTimeout(r, Math.min(Number(rest[0])||1000,5000))); out.push(`waited ${rest[0]}`); }
          else if(cmd==="eval"){ const expr=line.slice(5); const r=await tools.cdp.fn({method:"Runtime.evaluate", params:{expression: expr, returnByValue:true, awaitPromise:true}}); out.push(`eval: ${JSON.stringify(r).slice(0,300)}`); }
          else out.push(`unknown cmd: ${line}`);
        }catch(e){ out.push(`error ${cmd}: ${e.message.slice(0,200)}`); }
        await new Promise(r=>setTimeout(r,250));
      }
      return { content:[{type:"text", text: out.join("\n").slice(0,8000)}] };
    }
  },
  // Compat
  wait_load: { description:"Wait for load", inputSchema:{type:"object",properties:{},additionalProperties:false}, fn: async()=>{ await new Promise(r=>setTimeout(r,1200)); return {content:[{type:"text",text:"waited"}]}; } },
  name_session: { description:"Name session", inputSchema:{type:"object",properties:{name:{type:"string"}},required:["name"]}, fn: async({name})=>({content:[{type:"text",text:`named ${name}`}]} ) },
  turn_ended: { description:"End turn", inputSchema:{type:"object",properties:{},additionalProperties:false}, fn: async()=>({content:[{type:"text",text:"ended"}]}) },
  finalize_tabs: { description:"Finalize", inputSchema:{type:"object",properties:{keep:{type:"array", default:[]}},additionalProperties:false}, fn: async()=>({content:[{type:"text",text:"finalized"}]}) },
  move_mouse: {
    description:"Move mouse", inputSchema:{type:"object",properties:{x:{type:"number"}, y:{type:"number"}},required:["x","y"]},
    fn: async({x,y})=>{
      const t=await ensureTarget();
      await cdpCall(t,"Input.dispatchMouseEvent",{type:"mouseMoved", x:Math.round(x), y:Math.round(y)});
      return {content:[{type:"text",text:`moved ${x},${y}`}]}
    }
  },
};

// MCP stdio
let buf="";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk=>{
  buf+=chunk;
  let idx;
  while((idx=buf.indexOf("\n"))>=0){
    const line=buf.slice(0,idx).trim(); buf=buf.slice(idx+1);
    if(!line) continue;
    let msg; try{msg=JSON.parse(line);}catch{continue;}
    handle(msg).catch(e=>{ if(msg.id!=null) send({jsonrpc:"2.0", id:msg.id, error:{code:-32603, message:e.message||String(e)}}); });
  }
});
function send(o){ process.stdout.write(JSON.stringify(o)+"\n"); }
async function handle(msg){
  const {id, method, params}=msg;
  if(method==="initialize"){ send({jsonrpc:"2.0", id, result:{ protocolVersion:"2024-11-05", capabilities:{tools:{}}, serverInfo:{name:"qube-auto-browser", version:"1.0.0"}}}); return; }
  if(method==="notifications/initialized"||method==="initialized") return;
  if(method==="tools/list"){ send({jsonrpc:"2.0", id, result:{ tools: Object.entries(tools).map(([name,t])=>({name, description:t.description, inputSchema:t.inputSchema})) }}); return; }
  if(method==="tools/call"){
    const name=params?.name; const args=params?.arguments||{};
    const tool=tools[name];
    if(!tool){ send({jsonrpc:"2.0", id, error:{code:-32602, message:`Unknown tool ${name}`}}); return; }
    const loopHint = repetitionNote(name, args);
    const withHint = (content) => {
      if (!loopHint) return content;
      const first = content && content[0] && typeof content[0].text === "string" ? content[0] : null;
      if (!first) return content;
      return [{ type: "text", text: first.text + loopHint }, ...content.slice(1)];
    };
    try{
      const result=await tool.fn(args);
      send({jsonrpc:"2.0", id, result:{ content: withHint(result.content), isError:false }});
    }catch(e){ send({jsonrpc:"2.0", id, result:{ content: withHint([{type:"text", text: e.message||String(e)}]), isError:true }}); }
    return;
  }
  if(method==="ping"){ send({jsonrpc:"2.0", id, result:{}}); return; }
  if(id!=null) send({jsonrpc:"2.0", id, error:{code:-32601, message:`Method not found: ${method}`}});
}
process.on("SIGTERM",()=>process.exit(0));
process.on("SIGINT",()=>process.exit(0));
