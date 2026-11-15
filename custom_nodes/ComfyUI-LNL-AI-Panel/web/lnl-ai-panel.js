// LNL AI Panel — tab "AI" ở thanh bên trái ComfyUI: ra lệnh Claude Code ngay trong app.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const H = { "Content-Type": "application/json", "X-LNL-AI": "1" };
const LS = "lnl-ai-state-v1";
const state = Object.assign({ sessionId: null, mode: "auto", model: "", history: [] }, JSON.parse(localStorage.getItem(LS) || "{}"));
const save = () => localStorage.setItem(LS, JSON.stringify({ ...state, history: state.history.slice(-80) }));

const CSS = `
.lnl-ai{display:flex;flex-direction:column;height:calc(100vh - 48px);font-size:13px;color:var(--fg-color,#ddd)}
.lnl-ai-top{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px;border-bottom:1px solid var(--border-color,#333)}
.lnl-ai-top select,.lnl-ai-top button{background:var(--comfy-input-bg,#222);color:inherit;border:1px solid var(--border-color,#444);border-radius:6px;padding:3px 6px;font-size:12px}
.lnl-ai-log{flex:1;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:8px}
.lnl-ai-msg{padding:8px 10px;border-radius:8px;white-space:pre-wrap;word-break:break-word;line-height:1.45}
.lnl-ai-msg.user{background:#2a3b55;align-self:flex-end;max-width:90%}
.lnl-ai-msg.ai{background:var(--comfy-menu-bg,#1e1e1e);border:1px solid var(--border-color,#333)}
.lnl-ai-msg.err{background:#4a1f1f}
.lnl-ai-tool{font-size:11px;opacity:.75;font-family:ui-monospace,Consolas,monospace;padding:2px 6px;border-left:2px solid #6aa0ff;white-space:pre-wrap;word-break:break-all}
.lnl-ai-msg img{max-width:100%;border-radius:6px;margin-top:6px;cursor:pointer;display:block}
.lnl-ai-in{display:flex;flex-direction:column;gap:6px;padding:8px;border-top:1px solid var(--border-color,#333)}
.lnl-ai-in textarea{width:100%;box-sizing:border-box;min-height:70px;max-height:220px;resize:vertical;background:var(--comfy-input-bg,#222);color:inherit;border:1px solid var(--border-color,#444);border-radius:8px;padding:8px;font:inherit}
.lnl-ai-row{display:flex;gap:6px;justify-content:space-between;align-items:center;font-size:11px;opacity:.9}
.lnl-ai-send{background:#3b6fe0!important;color:#fff!important;border:none!important;border-radius:6px;padding:5px 14px;cursor:pointer}
`;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

const IMG_RE = /(?:^|[\s"'`(\\/])((?:[\w.\- ]+[\\/])*[\w.\-]+\.(?:png|jpe?g|webp|gif))/gi;
function addImages(box, text) {
  const seen = new Set([...box.querySelectorAll("img")].map((i) => i.dataset.f));
  for (const m of text.matchAll(IMG_RE)) {
    let p = m[1].replace(/\\/g, "/");
    const i = p.toLowerCase().lastIndexOf("output/");
    if (i < 0 && !/_\d{5}_\.(png|jpe?g|webp)$/i.test(p)) continue;
    if (i >= 0) p = p.slice(i + 7);
    if (seen.has(p)) continue; seen.add(p);
    const parts = p.split("/"); const filename = parts.pop();
    const img = el("img"); img.dataset.f = p;
    img.src = api.apiURL(`/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(parts.join("/"))}&type=output`);
    img.onerror = () => img.remove();
    img.onclick = () => window.open(img.src, "_blank");
    box.appendChild(img);
  }
}

// Gửi canvas đang mở cho server để MCP comfyui đọc được.
let lastCanvas = "";
async function syncCanvas() {
  try {
    if (!app.graph) return;
    const ui = app.graph.serialize();
    const s = JSON.stringify(ui);
    if (s === lastCanvas) return;
    lastCanvas = s;
    let prompt = null;
    try { prompt = (await app.graphToPrompt()).output; } catch {}
    await fetch(api.apiURL("/lnl-ai/canvas"), { method: "POST", headers: H, body: JSON.stringify({ ui, api: prompt, at: Date.now() }) });
  } catch {}
}

api.addEventListener("lnl-ai.load", async (e) => {
  const wf = e.detail?.workflow;
  if (!wf) return;
  try {
    if (Array.isArray(wf.nodes)) await app.loadGraphData(wf, true, true, e.detail.name);
    else await app.loadApiJson(wf, e.detail.name);
    lastCanvas = "";
    setTimeout(syncCanvas, 500);
  } catch (err) { console.error("[LNL AI] load", err); }
});

function render(root) {
  if (!document.getElementById("lnl-ai-css")) { const s = el("style"); s.id = "lnl-ai-css"; s.textContent = CSS; document.head.appendChild(s); }
  root.innerHTML = "";
  const wrap = el("div", "lnl-ai");
  const top = el("div", "lnl-ai-top");
  const title = el("b", null, "Claude Code"); title.style.cssText = "flex:1 0 100%;white-space:nowrap";
  const mode = el("select");
  for (const [v, t] of [["auto", "Tự động"], ["acceptEdits", "Tự sửa file"], ["bypassPermissions", "Toàn quyền"], ["plan", "Chỉ lập kế hoạch"]]) {
    const o = el("option", null, t); o.value = v; mode.appendChild(o);
  }
  mode.value = state.mode; mode.onchange = () => { state.mode = mode.value; save(); };
  const model = el("select");
  for (const [v, t] of [["", "Model mặc định"], ["opus", "Opus"], ["sonnet", "Sonnet"], ["haiku", "Haiku"]]) {
    const o = el("option", null, t); o.value = v; model.appendChild(o);
  }
  model.value = state.model; model.onchange = () => { state.model = model.value; save(); };
  const btnNew = el("button", null, "+ Mới"); btnNew.title = "Cuộc trò chuyện mới";
  btnNew.onclick = () => { state.sessionId = null; state.history = []; save(); log.innerHTML = ""; hint(); };
  top.append(title, mode, model, btnNew);

  const log = el("div", "lnl-ai-log");
  const hint = () => { if (!log.children.length) log.appendChild(el("div", "lnl-ai-tool", "Ra lệnh như trong Cursor: tạo ảnh, dựng/sửa workflow trên canvas, cài model, sửa code… Ctrl+Enter để gửi.")); };

  const inBox = el("div", "lnl-ai-in");
  const ta = el("textarea"); ta.placeholder = "Nhập lệnh cho Claude…";
  const row = el("div", "lnl-ai-row");
  const status = el("span", null, state.sessionId ? "Đang tiếp tục phiên trước" : "");
  const send = el("button", "lnl-ai-send", "Gửi");
  row.append(status, send); inBox.append(ta, row);
  wrap.append(top, log, inBox); root.appendChild(wrap);

  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const addMsg = (role, text) => { const m = el("div", "lnl-ai-msg " + role, text); log.appendChild(m); if (role === "ai") addImages(m, text); scroll(); return m; };
  for (const h of state.history) h.role === "tool" ? log.appendChild(el("div", "lnl-ai-tool", h.text)) : addMsg(h.role, h.text);
  hint(); scroll();

  let running = null;
  async function run() {
    if (running) { await fetch(api.apiURL("/lnl-ai/stop"), { method: "POST", headers: H, body: JSON.stringify({ run_id: running }) }); return; }
    const text = ta.value.trim(); if (!text) return;
    if (log.firstChild?.className === "lnl-ai-tool" && state.history.length === 0) log.innerHTML = "";
    ta.value = ""; addMsg("user", text); state.history.push({ role: "user", text }); save();
    await syncCanvas();
    send.textContent = "Dừng"; status.textContent = "Claude đang làm…"; running = "pending";
    let cur = null, curText = "";
    const flush = () => { if (cur && curText) { state.history.push({ role: "ai", text: curText }); addImages(cur, curText); } cur = null; curText = ""; };
    try {
      const res = await fetch(api.apiURL("/lnl-ai/chat"), { method: "POST", headers: H,
        body: JSON.stringify({ message: text, session_id: state.sessionId, mode: state.mode, model: state.model || undefined }) });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `HTTP ${res.status}`); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === "lnl_run") running = ev.run_id;
          else if (ev.type === "system" && ev.session_id) { state.sessionId = ev.session_id; save(); }
          else if (ev.type === "stream_event") {
            const d = ev.event;
            if (d?.type === "content_block_delta" && d.delta?.type === "text_delta") {
              if (!cur) { cur = addMsg("ai", ""); }
              curText += d.delta.text; cur.textContent = curText; scroll();
            } else if (d?.type === "message_stop") flush();
          } else if (ev.type === "assistant") {
            for (const b of ev.message?.content || []) {
              if (b.type === "tool_use") {
                flush();
                const arg = JSON.stringify(b.input); const t = `⚙ ${b.name} ${arg.length > 300 ? arg.slice(0, 300) + "…" : arg}`;
                log.appendChild(el("div", "lnl-ai-tool", t)); state.history.push({ role: "tool", text: t }); scroll();
              }
            }
          } else if (ev.type === "user") {
            for (const b of ev.message?.content || []) {
              if (b.type !== "tool_result") continue;
              const c = typeof b.content === "string" ? b.content : (b.content || []).map((x) => x.text || "").join("\n");
              const m = el("div", "lnl-ai-msg ai"); addImages(m, c);
              if (m.children.length) { log.appendChild(m); scroll(); }
            }
          } else if (ev.type === "result") {
            flush();
            if (ev.session_id) state.sessionId = ev.session_id;
            status.textContent = `Xong · ${Math.round((ev.duration_ms || 0) / 1000)}s`;
            if (ev.is_error && ev.result) addMsg("err", ev.result);
          } else if (ev.type === "lnl_error") { flush(); addMsg("err", ev.text); status.textContent = "Lỗi"; }
        }
      }
    } catch (err) { flush(); addMsg("err", String(err.message || err)); status.textContent = "Lỗi"; }
    flush(); save(); running = null; send.textContent = "Gửi";
    if (status.textContent === "Claude đang làm…") status.textContent = "Đã dừng";
  }
  send.onclick = run;
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } e.stopPropagation(); });
}

app.registerExtension({
  name: "LNL.AIPanel",
  async setup() {
    setInterval(syncCanvas, 3000);
    app.extensionManager.registerSidebarTab({
      id: "lnl-ai", icon: "pi pi-sparkles", title: "AI", tooltip: "Ra lệnh AI (Claude Code)", type: "custom",
      render: (container) => render(container),
    });
  },
});
