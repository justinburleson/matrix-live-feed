const express = require("express");
const compression = require("compression");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// --- Simple in-memory client registry for SSE ---
const clients = new Set();
const HEARTBEAT_MS = 15000;

// Serve the UI
app.get("/", (_req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Live Feed</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      --txt: #00ff66;   /* change via ?color=%2300ffaa */
      --bg: #000000;
      --glow: 6px;      /* change via ?glow=0px */
      --fs: 14px;       /* change via ?fs=14px */
    }
    html, body {
      height: 100%;
      margin: 0;
      background: var(--bg);
      color: var(--txt);
      font: 400 var(--fs)/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      overflow: hidden;
    }
    .wrap {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .head {
      padding: 8px 10px;
      opacity: .8;
      user-select: none;
      letter-spacing: .5px;
      border-bottom: 1px solid rgba(0,255,102,.15);
    }
    .feed {
      flex: 1;
      overflow: auto;
      padding: 10px;
      white-space: pre-wrap;
      word-break: break-word;
      text-shadow: 0 0 var(--glow) var(--txt);
    }
    .line { opacity: .95; }
    .line.dim { opacity: .65; }
    .cursor {
      display:inline-block; width:7px; height:1.1em; background: currentColor;
      animation: blink 1s steps(1) infinite;
      vertical-align: -2px;
      margin-left: 2px;
    }
    @keyframes blink { 50% { opacity: 0; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">/matrix-feed — live</div>
    <div id="feed" class="feed" aria-live="polite"></div>
  </div>
  <script>
    // Read style overrides from URL: ?color=%2300ffaa&fs=16px&glow=8px
    const params = new URLSearchParams(location.search);
    const color = params.get("color");
    const fs = params.get("fs");
    const glow = params.get("glow");
    if (color) document.documentElement.style.setProperty("--txt", color);
    if (fs) document.documentElement.style.setProperty("--fs", fs);
    if (glow) document.documentElement.style.setProperty("--glow", glow);

    const feed = document.getElementById("feed");
    const cursor = document.createElement("span");
    cursor.className = "cursor";
    feed.appendChild(cursor);

    function appendLine(text, dim=false) {
      const line = document.createElement("div");
      line.className = "line" + (dim ? " dim" : "");
      line.textContent = text;
      feed.insertBefore(line, cursor);
      feed.scrollTop = feed.scrollHeight;
    }

    // Connect SSE
    const es = new EventSource("/events");
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        const text = typeof d.text === "string" ? d.text : JSON.stringify(d);
        appendLine(text);
      } catch {
        appendLine(e.data);
      }
    };
    es.onerror = () => appendLine("[connection lost… retrying]", true);
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

  const client = { res, last: Date.now(), hb: null };
  clients.add(client);

  // heartbeat to keep connections alive on free hosts/proxies
  client.hb = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(client.hb);
    clients.delete(client);
  });
});

// Ingest endpoint for Make (no batching; one POST per event)
app.post("/ingest", (req, res) => {
  // Body can be JSON { text: "..." } or any JSON you want
  const payload = req.body && Object.keys(req.body).length ? req.body : { text: String(req.body || "") };
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    c.res.write(data);
  }
  res.status(200).json({ ok: true, deliveredTo: clients.size });
});

// Minimal health check
app.get("/health", (_req, res) => res.json({ ok: true, clients: clients.size }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("matrix live feed on :" + port));
