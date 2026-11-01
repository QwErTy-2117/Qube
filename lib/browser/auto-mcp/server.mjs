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
// pages (autocomplete, ads, React re-renders — Amazon re-renders continuously:
// lazy images, carousels, sponsored slots) replace those nodes, wiping the
// attrs — the classic "stale ref" loop (snapshot → act → stale → snapshot…,
// a model round-trip per cycle). To break it:
// 1. Every snapshot stores per-ref descriptors {role,name,tag,type,href}.
// 2. Snapshots cover the first 80 VISIBLE nodes (not the first 80 in DOM
//    order, which ad/script-heavy pages exhaust above the fold).
// 3. act auto-recovers a stale ref: wait for render quiet → fresh capture +
//    fuzzy re-match (href-path and /dp/ASIN aware, so session-token rotation
//    doesn't break product links) + re-tag — zero extra model calls.
// 4. Each action retries in-page (resolve → settle → re-resolve → trusted
//    coordinate click) up to 3 times before ever bothering the model.
// 5. Unrecoverable errors come back WITH a fresh snapshot attached, so the
//    model retries with new refs in ONE step instead of two.
// Agent-navigation URL gate (mirrors validateAgentNavUrl in
// lib/agent/browser/ssrf.ts). The managed browser is local, so localhost
// and LAN stay allowed for dev servers; blocked are non-http(s) schemes
// (file:// would exfiltrate local files via snapshots), credentials in
// URL, and cloud instance metadata. Throws with a model-actionable message.
const AGENT_NAV_BLOCKED_HOSTS = ["metadata.google.internal", "metadata.google.com", "metadata.goog", "instance-data"];
function assertAgentNavUrl(raw) {
  if (!raw || typeof raw !== "string" || !raw.trim()) throw new Error("URL is required");
  let t = raw.trim();
  if (t.length > 8192) throw new Error("URL too long (max 8192 chars)");
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) t = "https://" + t;
  let u;
  try { u = new URL(t); } catch { throw new Error("Invalid URL: " + String(raw).slice(0, 120)); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`Blocked scheme "${u.protocol}" — only http(s) allowed (no file/javascript/data access to local resources)`);
  if (u.username || u.password) throw new Error("URLs with credentials are blocked");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "169.254.169.254") throw new Error("Blocked cloud instance-metadata address");
  for (const b of AGENT_NAV_BLOCKED_HOSTS) {
    if (host === b || host.endsWith("." + b)) throw new Error(`Blocked cloud metadata host: ${u.hostname}`);
  }
  return u.href;
}

const SNAP_SEL = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [onclick]';
let lastSnap = { url: "", at: 0, refs: new Map() };

const normTxt = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 120);
const samePage = (a, b) => {
  try {
    const u = (s) => String(s || "").split("#")[0].replace(/\/$/, "");
    return u(a) === u(b);
  } catch { return false; }
};

// URL path without query/hash (session tokens like ?qid=/sr= rotate per load).
function hrefPath(h) {
  try {
    return new URL(String(h || ""), "http://local").pathname || "";
  } catch { return String(h || "").split("?")[0].split("#")[0]; }
}

// Amazon-style product id: /dp/B0XXXXXXX — stable across searches/sessions.
function dpAsin(h) {
  const m = hrefPath(h).match(/\/dp\/([A-Za-z0-9]{10})/);
  return m ? m[1].toUpperCase() : "";
}

function snapshotExpr() {
  return `(() => {
    const text=(document.body?document.body.innerText:"").slice(0,4000);
    const nodes=Array.from(document.querySelectorAll(${JSON.stringify(SNAP_SEL)}));
    let n=0; const els=[];
    for(let idx=0; idx<nodes.length && els.length<80; idx++){ const el=nodes[idx];
      const rect=el.getBoundingClientRect?el.getBoundingClientRect():null;
      if(!rect||(rect.width===0&&rect.height===0)) continue;
      n++;
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
  const r = await evalWithDialogRetry(target, snapshotExpr());
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
  if (want.href && want.href === cand.href) {
    s += 4;
  } else if (want.href && cand.href) {
    // Session tokens rotate (?qid=, ?sr=, ref=): same product, new query.
    const wa = dpAsin(want.href), ca = dpAsin(cand.href);
    if (wa && ca && wa === ca) s += 5;
    else {
      const wp = hrefPath(want.href), cp = hrefPath(cand.href);
      if (wp && wp === cp && wp !== "/") s += 3;
    }
  }
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

// JS-dialog auto-dismiss: a pending alert/confirm/beforeunload BLOCKS all
// Runtime.evaluate calls (CDP waits on the modal), freezing snapshot/act.
// Dismiss once with accept:false (never auto-confirm a real choice), then let
// the caller retry — the kernel surfaces a `new_dialog` signal + hint.
async function dismissPendingDialog(t) {
  try {
    await cdpCall(t, "Page.handleJavaScriptDialog", { accept: false });
    return true;
  } catch { return false; }
}

// Evaluate with one dialog-dismiss retry: if the first evaluate hangs or
// fails (likely a blocking JS dialog), dismiss once and retry a single time.
async function evalWithDialogRetry(t, expression) {
  try {
    return await cdpCall(t, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  } catch (e) {
    const dismissed = await dismissPendingDialog(t);
    if (!dismissed) throw e;
    const r = await cdpCall(t, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    r.dialogDismissed = true;
    return r;
  }
}
// Settle helper shared by navigation, act healing, and wait_load.
// Returns true when the DOM actually went quiet, false on timeout or when
// evaluation failed (e.g. mid-navigation context loss). Callers that only
// need pacing can ignore the result.
async function waitForQuiet(t, { timeout = 2500, quietMs = 450 } = {}) {
  const expr = `((timeout, quietMs) => new Promise((resolve) => {
    let done=false; const finish=(v)=>{ if(!done){ done=true; try{obs.disconnect();}catch{} resolve(v); } };
    let tm=setTimeout(()=>finish(true), quietMs);
    let obs=null;
    try {
      obs=new MutationObserver(()=>{ clearTimeout(tm); tm=setTimeout(()=>finish(true), quietMs); });
      obs.observe(document.documentElement,{childList:true,subtree:true,attributes:true,characterData:true});
    } catch(e){ clearTimeout(tm); finish(false); return; }
    setTimeout(()=>finish(false), timeout);
  }))(${timeout | 0},${quietMs | 0})`;
  try {
    const r = await cdpCall(t, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r && r.result && typeof r.result.value === "boolean" ? r.result.value : false;
  } catch { return false; }
}

// In-page resolver shared by measure/focus/fill evaluates: attr tag first,
// then exact href, then /dp/ASIN, then fuzzy name+path. Returns {el,via}.
// (Plain string concat — no backticks/${} inside, safe to interpolate.)
const RESOLVER_SRC = `
  var norm=function(s){return String(s||"").replace(/\\s+/g," ").trim().toLowerCase().slice(0,120);};
  var pathOf=function(h){try{return new URL(String(h||""),location.href).pathname;}catch(e){return String(h||"").split("?")[0];}};
  var asinOf=function(h){var m=pathOf(h).match(/\\/dp\\/([A-Za-z0-9]{10})/);return m?m[1].toUpperCase():"";};
  var isVis=function(el){try{var r=el.getBoundingClientRect();return (r.width>0||r.height>0)?r:null;}catch(e){return null;}};
  function resolveEl(ref, want, SEL){
    var tagged=document.querySelector('[data-qube-ref="'+ref+'"]');
    if(tagged && isVis(tagged)) return {el:tagged,via:"attr"};
    if(want){
      var nodes=Array.from(document.querySelectorAll(SEL)), i, n, h;
      if(want.href){
        for(i=0;i<nodes.length;i++){ n=nodes[i];
          try{ if(n.tagName==="A"&&n.getAttribute("href")===want.href&&isVis(n)) return {el:n,via:"href"}; }catch(e){}
        }
        var wa=asinOf(want.href);
        if(wa){ for(i=0;i<nodes.length;i++){ n=nodes[i];
          try{ h=n.getAttribute&&n.getAttribute("href"); if(h&&asinOf(h)===wa&&isVis(n)) return {el:n,via:"asin"}; }catch(e){}
        } }
      }
      var wn=norm(want.name), best=null, bestScore=0;
      var wtag=String(want.tag||"").toLowerCase();
      for(i=0;i<nodes.length;i++){ n=nodes[i];
        if(!isVis(n)) continue;
        var nm=""; try{ nm=norm(n.getAttribute&&(n.getAttribute("aria-label")||n.innerText||n.value||n.placeholder||n.name||n.id||"")); }catch(e){}
        var s=0;
        try{ var candTag=String(n.tagName||"").toLowerCase(); if(wtag&&candTag&&candTag===wtag) s+=2; }catch(e){}
        if(wn&&nm===wn) s+=4;
        else if(wn&&nm&&wn.length>3&&(nm.indexOf(wn)>=0||wn.indexOf(nm)>=0)) s+=2;
        try{ h=n.getAttribute&&n.getAttribute("href");
          if(want.href&&h&&pathOf(h)===pathOf(want.href)&&pathOf(h)!=="/") s+=3;
        }catch(e){}
        if(s>bestScore){ bestScore=s; best=n; }
      }
      if(best&&bestScore>=5) return {el:best,via:"fuzzy"};
    }
    return {el:null,via:""};
  }
`;

// Build one evaluate: resolve (+optional scroll/measure or focus/fill tail).
function resolveExpr(ref, want, tail) {
  return `((ref, want, SEL) => { ${RESOLVER_SRC} var f=resolveEl(ref,want,SEL); if(!f.el) return {found:false}; var el=f.el, via=f.via; ${tail} })(${JSON.stringify(ref)},${JSON.stringify(want || null)},${JSON.stringify(SNAP_SEL)})`;
}

const MEASURE_TAIL = `try{el.scrollIntoView({block:"center"});}catch(e){}
  var rr=null; try{var q=el.getBoundingClientRect(); rr=(q.width>0||q.height>0)?q:null;}catch(e){}
  if(!rr) return {found:false};
  return {found:true,via:via,x:rr.left+rr.width/2,y:rr.top+rr.height/2,tag:el.tagName};`;

const FOCUS_FILL_TAIL = `try{el.scrollIntoView({block:"center"});}catch(e){}
  try{el.focus();}catch(e){}
  if(kind==="fill"&&(el.tagName==="INPUT"||el.tagName==="TEXTAREA"||el.tagName==="SELECT")){
    try{ el.value=text; el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); return {found:true,via:via,set:true}; }
    catch(e){ return {found:false}; }
  }
  return {found:true,via:via,set:false};`;

async function measureRef(t, ref, want) {
  const r = await cdpCall(t, "Runtime.evaluate", { expression: resolveExpr(ref, want, MEASURE_TAIL), returnByValue: true, awaitPromise: true });
  return r.result?.value || { found: false };
}

// Trusted click at resolved coordinates (real input events, not el.click()).
async function clickRefAtCoords(t, ref, want) {
  const r1 = await measureRef(t, ref, want);
  if (!r1.found) throw new Error(`Ref ${ref} not resolving (mid-render).`);
  await new Promise((r) => setTimeout(r, 300));
  const r2 = await measureRef(t, ref, want);
  if (!r2.found) throw new Error(`Ref ${ref} vanished mid-action (page re-rendered between resolve and click).`);
  const x = Math.round(r2.x), y = Math.round(r2.y);
  await cdpCall(t, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdpCall(t, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  return r2.via;
}

async function focusRefForText(t, ref, want, kind, text) {
  const expr = `((ref, want, SEL, kind, text) => { ${RESOLVER_SRC} var f=resolveEl(ref,want,SEL); if(!f.el) return {found:false}; var el=f.el, via=f.via; ${FOCUS_FILL_TAIL} })(${JSON.stringify(ref)},${JSON.stringify(want || null)},${JSON.stringify(SNAP_SEL)},${JSON.stringify(kind)},${JSON.stringify(text)})`;
  const r = await cdpCall(t, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  const v = r.result?.value || { found: false };
  if (!v.found) throw new Error(`Ref ${ref} vanished mid-action (page re-rendered between resolve and fill).`);
  if (!v.set) await cdpCall(t, "Input.insertText", { text });
  return v.via;
}

// Ensure ref resolves; auto-heal via fresh capture + descriptor re-match.
// Returns {recovered:boolean, note?:string} or throws with fresh snapshot attached.
async function ensureRef(t, ref) {
  try {
    if (await refExists(t, ref)) {
      // Present now, but the page may still be mid-render (carousel tick,
      // lazy image): brief quiet-wait so the click doesn't race it.
      await waitForQuiet(t, { timeout: 700, quietMs: 250 });
      if (await refExists(t, ref)) return { recovered: false };
    }
  } catch {}
  const want = lastSnap.refs.get(ref);
  const oldUrl = lastSnap.url;
  // Let any in-flight render settle, then capture fresh (also refreshes lastSnap).
  await waitForQuiet(t);
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
      // Any provided URL is validated first: previously a non-http(s) URL
      // silently fell through to a blank tab, swallowing the request.
      if (url) url = assertAgentNavUrl(String(url));
      if (/^https?:\/\//i.test(url)) {
        // Try to reuse current tab via CDP navigate first, else new tab
        const t=await ensureTarget();
        try { await cdpCall(t,"Page.navigate",{url}); await new Promise(r=>setTimeout(r,300)); await waitForQuiet(t,{timeout:2500,quietMs:400}); const cur=await getPageTarget(); return { content:[{type:"text", text: `Opened ${url} (navigated current tab, now ${cur?.url||url})`}] }; } catch {}
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
      url = assertAgentNavUrl(url);
      let target=null;
      if(tab_id){
        const all=await listTargets();
        target=all.find(t=> String(t.id)===String(tab_id));
      }
      if(!target) target=await ensureTarget();
      await cdpCall(target,"Page.navigate",{url});
      await new Promise(r=>setTimeout(r,300));
      await waitForQuiet(target,{timeout:2500,quietMs:400});
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
  download: {
    description: "Download the file at a URL (or the current page's main document) into the workspace downloads folder (<dataDir>/downloads, file name from URL or Content-Disposition). Navigating to PDFs/CSVs often renders them instead of saving — use this to actually fetch the bytes via CDP. Returns the saved path for read_file.",
    inputSchema: { type:"object", properties:{ url:{type:"string"}, tab_id:{type:"integer"} }, additionalProperties:false },
    fn: async({url, tab_id})=>{
      if (url) url = assertAgentNavUrl(String(url));
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const dataDir = process.env.QUBE_DATA_DIR || process.cwd();
      const dir = path.join(dataDir, "downloads");
      await fs.mkdir(dir, { recursive: true });
      let target=null;
      if(tab_id){ const all=await listTargets(); target=all.find(t=> String(t.id)===String(tab_id));}
      if(!target) target=await ensureTarget();
      const expr = url
        ? `(async (u) => { const r = await fetch(u, { credentials: "include" }); if (!r.ok) throw new Error("HTTP " + r.status); const cd = r.headers.get("content-disposition") || ""; let name = ""; const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i); if (m) name = decodeURIComponent(m[1].replace(/["']/g, "")); if (!name) { try { name = new URL(u).pathname.split("/").pop() || "download"; } catch { name = "download"; } } const buf = await r.arrayBuffer(); const bytes = Array.from(new Uint8Array(buf)); return { name: name.slice(0, 120), bytes, contentType: r.headers.get("content-type") || "" }; })(${JSON.stringify(String(url))})`
        : `(() => ({ name: (document.title || "page").replace(/[^a-z0-9-_]+/gi, "_").slice(0, 80) + ".html", bytes: null, contentType: "text/html" }))()`;
      const r = await evalWithDialogRetry(target, expr);
      const v = r.result?.value || {};
      if (!v || (!v.bytes && v.contentType !== "text/html")) throw new Error("Download fetch failed: " + JSON.stringify(v).slice(0, 200));
      let buf;
      if (v.bytes) buf = Buffer.from(v.bytes);
      else {
        const html = await evalWithDialogRetry(target, "document.documentElement.outerHTML");
        buf = Buffer.from(String(html.result?.value || ""));
      }
      const safe = String(v.name || "download").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "download";
      const dest = path.join(dir, safe);
      await fs.writeFile(dest, buf);
      return { content:[{type:"text", text: `Saved ${(buf.length/1024).toFixed(1)}KB to ${dest} (${v.contentType || "unknown type"}). Use read_file to inspect it.`}] };
    }
  },
  upload: {
    description: "Attach a workspace file to a file-input on the page. Give the input's snapshot ref and a workspace-relative path. Handles <input type=file> (including multi-file inputs); page JS that restyles inputs still works because we set files via CDP DOM.setFileInputFiles.",
    inputSchema: { type:"object", properties:{ ref:{type:"string"}, path:{type:"string"} }, required:["ref","path"], additionalProperties:false },
    fn: async({ref, path: filePath})=>{
      const path = await import("node:path");
      if(!ref || !/^e\d+$/.test(String(ref))) throw new Error("upload requires a snapshot ref like e4 pointing at a file input");
      if(!filePath) throw new Error("upload requires a workspace file path");
      const abs = path.isAbsolute(String(filePath)) ? String(filePath) : path.join(process.env.QUBE_WORKSPACE || process.cwd(), String(filePath));
      const t=await ensureTarget();
      await ensureRef(t, String(ref));
      const findExpr = `((ref, SEL) => { ${RESOLVER_SRC} var f=resolveEl(ref,null,SEL); if(!f.el) return {found:false}; var el=f.el; var file=el; if(el.tagName!=="INPUT"||String(el.type).toLowerCase()!=="file"){ file=el.querySelector&&el.querySelector('input[type="file"]'); } if(!file) return {found:false,notfile:true}; var bid=null; try{bid=file.getAttribute("data-qube-ref")||ref;}catch{} return {found:true}; })(${JSON.stringify(String(ref))},${JSON.stringify(SNAP_SEL)})`;
      const found = await evalWithDialogRetry(t, findExpr).then((r)=>r.result?.value).catch(()=>null);
      if(!found || !found.found) throw new Error(found && found.notfile ? `Ref ${ref} is not a file input (and contains none). Snapshot to find the upload control.` : `Ref ${ref} not resolving. Snapshot for fresh refs.`);
      // Resolve the backend node id for the input, then set files via CDP.
      const doc = await cdpCall(t, "DOM.getDocument", { depth: 0 });
      const q = await cdpCall(t, "DOM.querySelector", { nodeId: doc.root.nodeId, selector: `[data-qube-ref="${String(ref)}"]` }).catch(()=>null);
      let nodeId = q && q.nodeId;
      if(!nodeId) {
        const q2 = await cdpCall(t, "DOM.querySelector", { nodeId: doc.root.nodeId, selector: `input[type="file"]` }).catch(()=>null);
        nodeId = q2 && q2.nodeId;
      }
      if(!nodeId) throw new Error("Could not locate the file input in the DOM tree — the control may be hidden behind a custom picker. Snapshot and retry.");
      await cdpCall(t, "DOM.setFileInputFiles", { files: [abs], nodeId });
      const fired = await evalWithDialogRetry(t, `(()=>{ const el=document.querySelector('[data-qube-ref="${String(ref)}"]')||document.querySelector('input[type="file"]'); if(!el) return false; try{el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));return true;}catch{return false;} })()`).then((r)=>!!(r.result?.value)).catch(()=>false);
      return { content:[{type:"text", text: `Attached ${abs} to ${ref}${fired ? " (change event fired)" : ""}. Verify with a snapshot — look for the file name near the control before submitting.`}] };
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
    description: "Press a key like Enter, Tab, Escape, PageDown (scroll), ArrowDown.",
    inputSchema: { type:"object", properties:{ key:{type:"string"} }, required:["key"], additionalProperties:false },
    fn: async({key})=>{
      const t=await ensureTarget();
      const map={Enter:{key:"Enter",code:"Enter",windowsVirtualKeyCode:13}, Tab:{key:"Tab",code:"Tab",windowsVirtualKeyCode:9}, Escape:{key:"Escape",code:"Escape",windowsVirtualKeyCode:27}, Backspace:{key:"Backspace",code:"Backspace",windowsVirtualKeyCode:8}, PageDown:{key:"PageDown",code:"PageDown",windowsVirtualKeyCode:34}, PageUp:{key:"PageUp",code:"PageUp",windowsVirtualKeyCode:33}, Home:{key:"Home",code:"Home",windowsVirtualKeyCode:36}, End:{key:"End",code:"End",windowsVirtualKeyCode:35}, ArrowLeft:{key:"ArrowLeft",code:"ArrowLeft",windowsVirtualKeyCode:37}, ArrowUp:{key:"ArrowUp",code:"ArrowUp",windowsVirtualKeyCode:38}, ArrowRight:{key:"ArrowRight",code:"ArrowRight",windowsVirtualKeyCode:39}, ArrowDown:{key:"ArrowDown",code:"ArrowDown",windowsVirtualKeyCode:40}, Delete:{key:"Delete",code:"Delete",windowsVirtualKeyCode:46}};
      const spec=map[key]||{key,code:key, windowsVirtualKeyCode:key.length===1?key.charCodeAt(0):0};
      await cdpCall(t,"Input.dispatchKeyEvent",{...spec, type:"keyDown"});
      await cdpCall(t,"Input.dispatchKeyEvent",{...spec, type:"keyUp"});
      await waitForQuiet(t, { timeout: 1200, quietMs: 300 });
      return { content:[{type:"text", text:`Pressed ${key}`}] };
    }
  },
  act: {
    description: "Act on snapshot refs (up to 24): [{kind:'click',ref:'e1'},{kind:'fill'|'type',ref:'e2',text:'...'}]. Stale refs self-heal AND each action auto-retries in-page (settle → re-resolve → trusted click), so rapid re-renders (Amazon-style) resolve with zero extra model calls — just use the latest snapshot's refs. If recovery fails you get a fresh snapshot back, retry in the SAME turn. Only already-completed actions must not be repeated.",
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
        if(kind!=="click"&&kind!=="fill"&&kind!=="type") throw new Error(`unsupported act kind ${kind}`);
        if((kind==="fill"||kind==="type")&&typeof a.text!=="string") throw new Error(`act ${kind} requires text`);
        // Resolve + self-heal BEFORE attempting, and retry the whole
        // resolve→act sequence in-page: mid-batch re-renders (autocomplete,
        // carousels, lazy-load) no longer cost a model round-trip each.
        const want0 = lastSnap.refs.get(ref);
        let done=false, lastErr=null;
        for(let attempt=1; attempt<=3 && !done; attempt++){
          try {
            const h=await ensureRef(t, ref);
            if(h.recovered && !recovered.includes(h.note)) recovered.push(h.note);
            const want = lastSnap.refs.get(ref) || want0;
            if(kind==="click"){
              const via=await clickRefAtCoords(t, ref, want);
              if(h.recovered) recovered[recovered.length-1]+=` via ${via}`;
            } else {
              const via=await focusRefForText(t, ref, want, kind, String(a.text));
              if(h.recovered) recovered[recovered.length-1]+=` via ${via}`;
            }
            done=true;
          } catch(e){ lastErr=e; }
        }
        if(!done){
          const msg=(lastErr&&lastErr.message)||String(lastErr);
          const doneMsg=completed>0?` (confirmed ${completed}/${actions.length} actions before this failure; do NOT repeat those)`:"";
          // Attach a fresh snapshot unless the error already carries one, so
          // the model retries with new refs in ONE step instead of two.
          let freshBlock="";
          if(!/Fresh snapshot/.test(msg)){
            try{
              const snap=await captureSnapshot(t);
              freshBlock=`\n\nFresh snapshot (use these new refs NOW, same turn — do not stop):\n${snap.tree}`.slice(0,4500);
            }catch{}
          }
          throw new Error(`${msg}${doneMsg}${freshBlock}`);
        }
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
  wait_load: { description:"Wait until the page settles (DOM quiet) or timeout — event-driven, not a fixed sleep.", inputSchema:{type:"object",properties:{timeout:{type:"number",description:"Max wait in ms (default 8000, max 15000)"}},additionalProperties:false}, fn: async({timeout})=>{
      const t=await ensureTarget();
      const budget=Math.min(Math.max(Number(timeout)||8000,500),15000);
      const t0=Date.now();
      const settled=await waitForQuiet(t,{timeout:budget,quietMs:400});
      const ms=Date.now()-t0;
      return {content:[{type:"text",text:`waited ${ms}ms (${settled?"settled":"still busy after budget"})`}]};
    } },
  dismiss_dialogs: {
    description: "Dismiss cookie banners, newsletter popups, and overlay dialogs that block the page. Clicks only elements whose text matches reject/decline/close patterns (never 'accept all' or submit buttons); DOM modals only, never JS alert/confirm (those auto-dismiss with a kernel signal). Returns what was dismissed. If the blocker is a real choice the task needs (login wall, paywall, CAPTCHA), it reports that instead of clicking.",
    inputSchema: { type:"object", properties:{ tab_id:{type:"integer"} }, additionalProperties:false },
    fn: async({tab_id})=>{
      let target=null;
      if(tab_id){ const all=await listTargets(); target=all.find(t=> String(t.id)===String(tab_id));}
      if(!target) target=await ensureTarget();
      const expr = `(() => {
        const out = { dismissed: [], blocked: null };
        const REJECT = /^(reject( all)?|decline( all)?|refuse( all)?|deny( all)?|not now|no thanks|no thank you|maybe later|dismiss|close|got it|continue without (accepting|consent)|necessary only|essential only|save (my )?(choices|preferences|settings)|confirm (my )?(choices|selection))$/i;
        const NEEDS_HUMAN = /log ?in|sign ?in|sign up|create (an )?account|subscribe|pay|payment|captcha|verify you are|two-?factor|2fa/i;
        const nodes = Array.from(document.querySelectorAll('button, [role="button"], a[href], input[type="button"], input[type="submit"]'));
        const vis = (el) => { try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch { return false; } };
        const txt = (el) => ((el.getAttribute && (el.getAttribute("aria-label") || el.innerText || el.value || "")) || "").replace(/\\s+/g, " ").trim();
        // Classify first: if the overlay needs a human, report it untouched.
        try {
          const overlays = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open]'));
          for (const ov of overlays) {
            if (!vis(ov)) continue;
            const t = (ov.innerText || "").slice(0, 500);
            if (NEEDS_HUMAN.test(t)) { out.blocked = "human-choice: " + t.replace(/\\s+/g, " ").trim().slice(0, 160); return out; }
          }
        } catch {}
        const clicked = new Set();
        for (const el of nodes) {
          if (!vis(el)) continue;
          const t = txt(el);
          if (!t || t.length > 60) continue;
          if (!REJECT.test(t)) continue;
          // Never click inside a form that looks like login/payment (guard).
          try {
            const form = el.closest && el.closest("form");
            if (form) {
              const ft = ((form.innerText || "") + " " + (form.innerHTML || "")).slice(0, 1000);
              if (/password|card-number|cardnumber|cc-num|cvv|payment/i.test(ft)) continue;
            }
          } catch {}
          try { el.click(); clicked.add(t); } catch {}
          if (clicked.size >= 3) break;
        }
        out.dismissed = Array.from(clicked);
        return out;
      })()`;
      const r = await evalWithDialogRetry(target, expr);
      const v = r.result?.value || r?.result?.value || {};
      const dismissed = Array.isArray(v.dismissed) ? v.dismissed : [];
      if (v.blocked) return { content:[{type:"text", text: `Dialog needs a human decision (${v.blocked}). Do NOT click through it — call request_takeover or report the blocker.`}] };
      if (dismissed.length === 0) return { content:[{type:"text", text: "No dismissible banners found (no reject/close controls matched). Snapshot to see what is actually blocking."}] };
      await waitForQuiet(target, { timeout: 1500, quietMs: 350 });
      let snap = null;
      try { snap = await captureSnapshot(target); } catch {}
      return { content:[{type:"text", text: `Dismissed: ${dismissed.join("; ")}. ${snap ? "Fresh snapshot:\n" + snap.tree : "Re-snapshot to confirm."}`.slice(0, 6000)}] };
    }
  },
  close_tab: {
    description: "Close a tab by id (see tabs for ids), or the current tab when tab_id is omitted. Never closes the last remaining page.",
    inputSchema: { type:"object", properties:{ tab_id:{type:"integer"} }, additionalProperties:false },
    fn: async({tab_id})=>{
      const all=await listTargets();
      const pages=all.filter(t=>t.type==="page");
      if(pages.length<=1) throw new Error("Refusing to close the last tab — navigate it elsewhere instead.");
      let target=null;
      if(tab_id) target=all.find(t=> String(t.id)===String(tab_id));
      if(!target) target=await ensureTarget();
      await devtools(`/json/close/${target.id}`, { method:"PUT" });
      return { content:[{type:"text", text:`Closed tab ${target.id} (${(target.url||"").slice(0,120)})`}] };
    }
  },
  switch_tab: {
    description: "Bring a tab to the front by id (see tabs for ids) so snapshot/act target it.",
    inputSchema: { type:"object", properties:{ tab_id:{type:"integer"} }, required:["tab_id"], additionalProperties:false },
    fn: async({tab_id})=>{
      const all=await listTargets();
      const target=all.find(t=> String(t.id)===String(tab_id));
      if(!target) throw new Error(`No tab ${tab_id} — call tabs first.`);
      await devtools(`/json/activate/${target.id}`, { method:"PUT" });
      await new Promise(r=>setTimeout(r,400));
      return { content:[{type:"text", text:`Switched to tab ${target.id} (${(target.url||"").slice(0,160)}) — snapshot to see it.`}] };
    }
  },
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

// Pure ref helpers, exported for unit tests (stdio loop stays off when
// QUBE_MCP_NO_STDIO=1 so the module is importable without hanging).
export { SNAP_SEL, normTxt, samePage, hrefPath, dpAsin, matchScore, findMatch, snapshotExpr, waitForQuiet };

// MCP stdio
let buf="";
if (!process.env.QUBE_MCP_NO_STDIO) {
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
}
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
