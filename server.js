const express = require("express");
const compression = require("compression");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const VERSION = "v3-matrix-rain-typewriter-decay";
const clients = new Set();
const HEARTBEAT_MS = 15000;

// Root UI
app.get("/", (_req, res) => {
  res.set({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "Surrogate-Control": "no-store"
  });
  res.end(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Matrix Live Feed ${VERSION}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
:root { --txt:#00ff66; --bg:#000; --glow:6px; --fs:14px; }
* { box-sizing: border-box; }
html,body{height:100%;margin:0;background:var(--bg);color:var(--txt);
  font:400 var(--fs)/1.4 ui-monospace,Consolas,monospace;overflow:hidden;}
#rain{position:fixed;inset:0;z-index:0;display:block;}
.wrap{height:100%;display:flex;flex-direction:column;position:relative;z-index:1;}
.head{padding:8px 10px;opacity:.9;user-select:none;letter-spacing:.5px;
  border-bottom:1px solid rgba(0,255,102,.15);}
.feed{flex:1;overflow:auto;padding:10px;white-space:pre-wrap;word-break:break-word;
  text-shadow:0 0 var(--glow) var(--txt);}
.line{opacity:.95;transition:filter .8s,opacity .8s;}
.line.decay1{filter:blur(.3px) brightness(.95);opacity:.9;}
.line.decay2{filter:blur(.6px) brightness(.85);opacity:.75;}
.line.decay3{filter:blur(1px) brightness(.75);opacity:.6;}
.cursor{display:inline-block;width:7px;height:1.1em;background:currentColor;
  animation:blink 1s steps(1) infinite;vertical-align:-2px;margin-left:2px;}
@keyframes blink{50%{opacity:0}}
@keyframes pulseGlow{0%{filter:brightness(1.8) drop-shadow(0 0 10px var(--txt));}
 100%{filter:brightness(1) drop-shadow(0 0 0 var(--txt));}}
.line.fresh{animation:pulseGlow 300ms ease-out;}
</style>
</head>
<body>
<canvas id="rain"></canvas>
<div class="wrap">
  <div class="head">/matrix-feed — live <strong>${VERSION}</strong></div>
  <div id="feed" class="feed" aria-live="polite"></div>
</div>
<script>
console.log("Client loaded ${VERSION}");
const params = new URLSearchParams(location.search);
const color=params.get("color"); if(color)document.documentElement.style.setProperty("--txt",color);
const fs=params.get("fs");       if(fs)document.documentElement.style.setProperty("--fs",fs);
const glow=params.get("glow");   if(glow)document.documentElement.style.setProperty("--glow",glow);

// Digital rain
(() => {
  const rainSpeed = parseFloat(params.get("rainSpeed") || "1");
  const density   = parseFloat(params.get("density")   || "0.9");
  const colorHex  = getComputedStyle(document.documentElement).getPropertyValue("--txt").trim() || "#00ff66";
  const canvas = document.getElementById("rain");
  const ctx = canvas.getContext("2d");
  let w,h,cols,fontSize,drops;
  const glyphs="アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズブプエェケセテネヘメレヱゲゼデベペオォコソトノホモヨョロヲゴゾドボポヴ0123456789";
  function resize(){
    w=canvas.width=innerWidth; h=canvas.height=innerHeight;
    fontSize=Math.max(12,Math.floor(w/90));
    ctx.font=fontSize+"px ui-monospace, monospace";
    cols=Math.floor(w/fontSize);
    drops=new Array(cols).fill(0).map(()=>Math.random()*h);
  }
  addEventListener("resize",resize,{passive:true}); resize();
  function step(){
    ctx.fillStyle="rgba(0,0,0,0.08)"; ctx.fillRect(0,0,w,h);
    ctx.fillStyle=colorHex;
    for(let i=0;i<cols;i++){
      const x=i*fontSize, y=drops[i];
      const ch=glyphs[(Math.random()*glyphs.length)|0];
      ctx.shadowColor=colorHex; ctx.shadowBlur=12; ctx.fillText(ch,x,y); ctx.shadowBlur=0;
      const speed=(fontSize*(0.9+Math.random()*0.2))*rainSpeed;
      const reset=0.997-(1-density)*0.01;
      drops[i]=(y>h||Math.random()>reset)?0:y+speed;
    }
    requestAnimationFrame(step);
  }
  step();
})();

// Typewriter + decay
const feed=document.getElementById("feed");
const cursor=document.createElement("span"); cursor.className="cursor"; feed.appendChild(cursor);
function typeIn(el,text,cps=180){
  let i=0; const timer=setInterval(()=>{
    el.textContent=text.slice(0,++i);
    el.scrollIntoView({block:"end"});
    if(i>=text.length) clearInterval(timer);
  }, Math.max(1, 1000/cps));
}
function ageLastLines(){
  const lines=[...document.querySelectorAll(".line")].slice(-200);
  lines.forEach(l=>l.classList.remove("decay1","decay2","decay3"));
  for(let i=lines.length-1, step=0; i>=0; i--, step++){
    if(step>120) lines[i].classList.add("decay3");
    else if(step>60) lines[i].classList.add("decay2");
    else if(step>30) lines[i].classList.add("decay1");
  }
}

// SSE
const es=new EventSource("/events");
es.onmessage=(e)=>{
  let text;
  try{ const d=JSON.parse(e.data); text=(typeof d.text==="string")? d.text : JSON.stringify(d); }
  catch{ text=e.data; }
  const line=document.createElement("div");
  line.className="line fresh";
  feed.insertBefore(line,cursor);
  typeIn(line,text,180);
  ageLastLines();
};
es.onerror=()=>{
  const line=document.createElement("div");
  line.className="line";
  line.textContent="[connection lost… retrying]";
  feed.insertBefore(line,cursor);
};
</script>
</body>
</html>`);
});

// SSE stream
app.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive"
  });
  res.flushHeaders();
  const client = { res, hb: null };
  clients.add(client);
  client.hb = setInterval(() => {
    res.write(\`event: ping\\ndata: \${Date.now()}\\n\\n\`);
  }, HEARTBEAT_MS);
  req.on("close", () => {
    clearInterval(client.hb);
    clients.delete(client);
  });
});

// Ingest
app.post("/ingest", (req, res) => {
  const payload = req.body && Object.keys(req.body).length ? req.body : { text: String(req.body || "") };
  const data = "data: " + JSON.stringify(payload) + "\\n\\n";
  for (const c of clients) c.res.write(data);
  res.status(200).json({ ok: true, deliveredTo: clients.size, version: "${VERSION}" });
});

// Health
app.get("/health", (_req, res) => res.json({ ok: true, clients: clients.size, version: VERSION }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("matrix live feed on :"+port, VERSION));
