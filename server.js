const express = require("express");
const compression = require("compression");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// --- Simple in-memory SSE client list ---
const clients = new Set();
const HEARTBEAT_MS = 15000;

app.get("/", (_req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Matrix Live Feed</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
:root {
  --txt:#00ff66;
  --bg:#000;
  --glow:6px;
  --fs:14px;
}
html,body{
  height:100%;
  margin:0;
  background:var(--bg);
  color:var(--txt);
  font:400 var(--fs)/1.4 ui-monospace,Consolas,monospace;
  overflow:hidden;
}
.wrap{height:100%;display:flex;flex-direction:column;position:relative;z-index:1;}
.head{padding:8px 10px;opacity:.8;user-select:none;letter-spacing:.5px;
  border-bottom:1px solid rgba(0,255,102,.15);}
.feed{flex:1;overflow:auto;padding:10px;white-space:pre-wrap;word-break:break-word;
  text-shadow:0 0 var(--glow) var(--txt);}
.line{opacity:.95;transition:filter .8s,opacity .8s;}
.line.decay1{filter:blur(0.3px) brightness(0.95);opacity:.9;}
.line.decay2{filter:blur(0.6px) brightness(0.85);opacity:.75;}
.line.decay3{filter:blur(1px) brightness(0.75);opacity:.6;}
.cursor{display:inline-block;width:7px;height:1.1em;background:currentColor;
  animation:blink 1s steps(1) infinite;vertical-align:-2px;margin-left:2px;}
@keyframes blink{50%{opacity:0}}
@keyframes pulseGlow{
  0%{filter:brightness(1.8) drop-shadow(0 0 10px var(--txt));}
 100%{filter:brightness(1) drop-shadow(0 0 0 var(--txt));}}
.line.fresh{animation:pulseGlow 300ms ease-out;}
</style>
</head>
<body>
<div class="wrap">
  <div class="head">/matrix-feed — live</div>
  <div id="feed" class="feed" aria-live="polite"></div>
</div>
<script>
const params=new URLSearchParams(location.search);
const color=params.get("color");if(color)document.documentElement.style.setProperty("--txt",color);
const fs=params.get("fs");if(fs)document.documentElement.style.setProperty("--fs",fs);
const glow=params.get("glow");if(glow)document.documentElement.style.setProperty("--glow",glow);

const feed=document.getElementById("feed");
const cursor=document.createElement("span");cursor.className="cursor";feed.appendChild(cursor);

// --- Typewriter + phosphor decay ---
function typeIn(el,text,cps=120){
  let i=0;
  const timer=setInterval(()=>{
    el.textContent=text.slice(0,++i);
    el.scrollIntoView({block:"end"});
    if(i>=text.length)clearInterval(timer);
  },Math.max(1,1000/cps));
}
function ageLastLines(){
  const lines=[...document.querySelectorAll(".line")].slice(-200);
  lines.forEach(l=>l.classList.remove("decay1","decay2","decay3"));
  for(let i=lines.length-1,step=0;i>=0;i--,step++){
    if(step>120)lines[i].classList.add("decay3");
    else if(step>60)lines[i].classList.add("decay2");
    else if(step>30)lines[i].classList.add("decay1");
  }
}

// --- SSE stream listener ---
const es=new EventSource("/events");
es.onmessage=e=>{
  let text;
  try{
    const d=JSON.parse(e.data);
    text=typeof d.text==="string"?d.text:JSON.stringify(d);
  }catch{ text=e.data; }
  const line=document.createElement("div");
  line.className="line fresh";
  feed.insertBefore(line,cursor);
  typeIn(line,text,180);
  ageLastLines();
};
es.onerror=()=>{const line=document.createElement("div");
  line.className="line dim";
  line.textContent="[connection lost… retrying]";
  feed.insertBefore(line,cursor);
};
</script>
</body>
</html>`);
});

// SSE endpoint
app.get("/events", (req,res)=>{
  res.set({
    "Content-Type":"text/event-stream",
    "Cache-Control":"no-cache, no-transform",
    "Connection":"keep-alive"
  });
  res.flushHeaders();
  const client={res, hb:null};
  clients.add(client);
  client.hb=setInterval(()=>res.write("event:ping\\ndata:"+Date.now()+"\\n\\n"),HEARTBEAT_MS);
  req.on("close",()=>{clearInterval(client.hb);clients.delete(client);});
});

// Ingest endpoint for Make
app.post("/ingest",(req,res)=>{
  const payload=req.body&&Object.keys(req.body).length?req.body:{text:String(req.body||"")};
  const data=\`data: \${JSON.stringify(payload)}\\n\\n\`;
  for(const c of clients)c.res.write(data);
  res.status(200).json({ok:true,deliveredTo:clients.size});
});

app.get("/health",(_req,res)=>res.json({ok:true,clients:clients.size}));

const port=process.env.PORT||3000;
app.listen(port,()=>console.log("matrix live feed on :"+port));
