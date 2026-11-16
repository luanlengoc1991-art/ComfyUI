// LNL AI Panel — khung AI ở bên phải ComfyUI (giống Claude trong Cursor): thanh dọc bên phải + khung chat kéo giãn được.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const H = { "Content-Type": "application/json", "X-LNL-AI": "1" };
const LS = "lnl-ai-state-v2";
const MAX_CONVS = 30;

// ---------- Trạng thái (nhiều cuộc trò chuyện, chuyển từ bản cũ) ----------
const newConv = (agent) => ({ id: Math.random().toString(36).slice(2, 10), title: "", agent, sessions: {}, history: [], at: Date.now() });
const state = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(LS) || "{}"); } catch {}
  s = Object.assign({ agent: "claude", mode: "auto", tools: "lean", model: { claude: "", codex: "" }, effort: { claude: "", codex: "" }, convs: [], cur: "", open: true, width: 420 }, s);
  if (!s.convs.length) {
    try {
      const old = JSON.parse(localStorage.getItem("lnl-ai-state-v1") || "null");
      if (old && old.history?.length) {
        const c = newConv(old.agent || "claude");
        c.sessions = old.sessions || {}; c.history = old.history;
        c.title = (old.history.find((h) => h.role === "user")?.text || "").slice(0, 60);
        s.convs.push(c);
      }
    } catch {}
  }
  if (!s.convs.length) s.convs.push(newConv(s.agent));
  if (!s.convs.some((c) => c.id === s.cur)) s.cur = s.convs[0].id;
  return s;
})();
const conv = () => state.convs.find((c) => c.id === state.cur) || state.convs[0];
let diskTimer = 0;
const toDisk = () => fetch(api.apiURL("/lnl-ai/state"), { method: "POST", headers: H, body: JSON.stringify(state), keepalive: true }).catch(() => {});
const save = () => {
  for (const c of state.convs) c.history = c.history.slice(-120);
  state.convs = state.convs.slice(0, MAX_CONVS);
  state.saved = Date.now();
  try { localStorage.setItem(LS, JSON.stringify(state)); } catch {}
  // Bản chính nằm trên ổ đĩa (user/lnl-ai/state.json): xoá dữ liệu trình duyệt hay đổi trình duyệt vẫn còn.
  clearTimeout(diskTimer); diskTimer = setTimeout(() => { diskTimer = 0; toDisk(); }, 600);
};
// Lấy bản trên ổ đĩa khi mở; bản nào mới hơn thì dùng bản đó (lần đầu: đẩy lịch sử cũ trong trình duyệt lên ổ đĩa).
async function loadDisk() {
  try {
    const r = await fetch(api.apiURL("/lnl-ai/state"), { headers: H });
    const d = await r.json();
    const hasLocal = state.convs.some((c) => c.history.length);
    // Lịch sử trong trình duyệt chưa từng lưu ra ổ đĩa thì giữ nó (đẩy lên), không để bản trên ổ đĩa đè.
    if (Array.isArray(d.convs) && d.convs.length && (state.saved ? (d.saved || 0) >= state.saved : !hasLocal)) {
      Object.assign(state, d);
      if (!state.convs.some((c) => c.id === state.cur)) state.cur = state.convs[0].id;
      try { localStorage.setItem(LS, JSON.stringify(state)); } catch {}
    } else if (hasLocal) { state.saved = state.saved || Date.now(); try { localStorage.setItem(LS, JSON.stringify(state)); } catch {} toDisk(); }
  } catch {}
}
window.addEventListener("pagehide", () => { if (diskTimer) { clearTimeout(diskTimer); toDisk(); } });

// ---- Báo khi xong (thông báo Windows + tiếng chuông) khi người dùng đang ở cửa sổ khác ----
let audio = null;
const chime = () => {
  try {
    audio = audio || new AudioContext();
    const t = audio.currentTime;
    for (const [i, hz] of [[0, 880], [1, 1320]]) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = hz; o.connect(g); g.connect(audio.destination);
      g.gain.setValueAtTime(0.0001, t + i * 0.16); g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.35);
      o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.4);
    }
  } catch {}
};
const askNotify = () => { try { if (state.notify !== false && "Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch {} };
const notify = (title, body) => {
  if (state.notify === false || (document.hasFocus() && !document.hidden)) return;
  chime();
  try { if ("Notification" in window && Notification.permission === "granted") { const n = new Notification(title, { body, tag: "lnl-ai" }); n.onclick = () => { window.focus(); n.close(); }; } } catch {}
};

const CSS = `
#comfyui-body-right:has(.lnl-dock){display:flex!important}
.lnl-dock{display:flex;height:100%;font-size:13px;color:var(--fg-color,#ddd);background:var(--comfy-menu-bg,#171717)}
.lnl-bar{width:44px;flex:0 0 44px;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 0;border-left:1px solid var(--border-color,#2c2c2c);background:#141821}
.lnl-bar button{width:34px;height:34px;border-radius:8px;border:none;background:transparent;color:#aab;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}
.lnl-bar button:hover{background:#262c3a;color:#fff}
.lnl-bar button.on{background:#2b3d63;color:#ffd166}
.lnl-bar .sp{flex:1}
.lnl-pane{position:relative;display:flex;flex-direction:column;min-width:0;border-left:1px solid var(--border-color,#2c2c2c);background:#181818}
.lnl-dock.closed .lnl-pane{display:none}
.lnl-grip{position:absolute;left:-3px;top:0;bottom:0;width:6px;cursor:ew-resize;z-index:3}
.lnl-grip:hover,.lnl-grip.drag{background:#3b6fe0}
.lnl-head{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #2a2a2a}
.lnl-head b{flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lnl-head button{background:none;border:none;color:#aaa;cursor:pointer;font-size:14px;padding:2px 6px;border-radius:5px}
.lnl-head button:hover{background:#2a2a2a;color:#fff}
.lnl-log{flex:1;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:10px}
.lnl-hint{opacity:.6;font-size:12px;line-height:1.5;padding:6px 2px}
.lnl-msg{line-height:1.55;word-break:break-word}
.lnl-msg.user{background:#24324a;border:1px solid #33496d;padding:8px 10px;border-radius:10px;white-space:pre-wrap;align-self:stretch}
.lnl-msg.err{background:#4a1f1f;padding:8px 10px;border-radius:8px;white-space:pre-wrap}
.lnl-msg p{margin:0 0 6px}.lnl-msg p:last-child{margin:0}
.lnl-msg h1,.lnl-msg h2,.lnl-msg h3{font-size:14px;margin:8px 0 4px}
.lnl-msg ul,.lnl-msg ol{margin:2px 0 6px;padding-left:20px}
.lnl-msg code{background:#2a2a2a;border-radius:4px;padding:1px 4px;font-family:ui-monospace,Consolas,monospace;font-size:12px}
.lnl-msg pre{background:#101010;border:1px solid #2c2c2c;border-radius:6px;padding:8px;overflow:auto;margin:4px 0}
.lnl-msg pre code{background:none;padding:0}
.lnl-msg table{border-collapse:collapse;margin:4px 0;font-size:12px}.lnl-msg td,.lnl-msg th{border:1px solid #333;padding:3px 6px}
.lnl-msg a{color:#7ab0ff}
.lnl-msg img,.lnl-imgs img{max-width:100%;border-radius:6px;margin-top:6px;cursor:pointer;display:block}
.lnl-tool{border:1px solid #2c2c2c;border-radius:7px;background:#1d1d1d;font-size:12px}
.lnl-tool summary{cursor:pointer;padding:5px 8px;list-style:none;display:flex;gap:6px;align-items:center;color:#bbb;white-space:nowrap;overflow:hidden}
.lnl-tool summary::-webkit-details-marker{display:none}
.lnl-tool summary .n{color:#8fb4ff;font-weight:600}
.lnl-tool summary .a{opacity:.6;overflow:hidden;text-overflow:ellipsis}
.lnl-tool summary .s{margin-left:auto;opacity:.8}
.lnl-tool pre{margin:0;padding:6px 8px;border-top:1px solid #2c2c2c;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:11px;opacity:.85}
.lnl-think{font-size:12px;opacity:.6;font-style:italic}
.lnl-in{padding:8px 10px 10px;border-top:1px solid #2a2a2a}
.lnl-box{border:1px solid #3a3a3a;border-radius:10px;background:#202020;padding:6px}
.lnl-box:focus-within{border-color:#3b6fe0}
.lnl-box.drop{border-color:#ffd166;background:#2a2618}
.lnl-chips{display:flex;flex-wrap:wrap;gap:4px}
.lnl-chip{display:flex;align-items:center;gap:4px;background:#2b2b2b;border-radius:6px;padding:2px 6px;font-size:11px;max-width:100%}
.lnl-chip img{width:22px;height:22px;object-fit:cover;border-radius:3px}
.lnl-chip button{background:none;border:none;color:#999;cursor:pointer;padding:0 2px}
.lnl-box textarea{width:100%;box-sizing:border-box;min-height:44px;max-height:240px;resize:none;background:transparent;color:inherit;border:none;outline:none;padding:4px;font:inherit;line-height:1.45}
.lnl-ctl{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.lnl-ctl select{background:#262626;color:#ccc;border:1px solid #333;border-radius:6px;padding:2px 4px;font-size:11px;max-width:150px}
.lnl-ctl .ic{background:none;border:none;color:#aaa;cursor:pointer;font-size:14px;padding:2px 5px;border-radius:5px}
.lnl-ctl .ic:hover{background:#2e2e2e;color:#fff}
.lnl-ctl .go{margin-left:auto;background:#3b6fe0;color:#fff;border:none;border-radius:7px;padding:4px 12px;cursor:pointer;font-size:12px}
.lnl-ctl .go.stop{background:#b33a3a}
.lnl-status{font-size:11px;opacity:.65;margin-top:5px;min-height:14px;display:flex;gap:8px}
.lnl-hist{position:absolute;inset:44px 0 0 0;background:#181818;z-index:4;overflow:auto;padding:8px;display:none}
.lnl-hist.show{display:block}
.lnl-hist div{padding:7px 8px;border-radius:6px;cursor:pointer;display:flex;gap:6px;align-items:center}
.lnl-hist div:hover{background:#262626}.lnl-hist div.cur{background:#24324a}
.lnl-hist span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lnl-hist small{opacity:.5}
.lnl-hist button{background:none;border:none;color:#888;cursor:pointer}
@media (max-width:900px){.lnl-pane{position:fixed;right:44px;top:0;bottom:0;z-index:1000;box-shadow:-8px 0 24px rgba(0,0,0,.5);max-width:calc(100vw - 60px)}}
`;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- Markdown gọn (đủ cho câu trả lời của AI) ----------
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank">$2</a>');
}
function md(src) {
  const out = []; const lines = src.replace(/\r/g, "").split("\n");
  let i = 0, list = null, para = [];
  const endPara = () => { if (para.length) { out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; } };
  const endList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      endPara(); endList(); const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>"); continue;
    }
    if (/^\|.*\|\s*$/.test(l) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      endPara(); endList(); const row = (r, t) => "<tr>" + r.trim().slice(1, -1).split("|").map((c) => `<${t}>${inline(c.trim())}</${t}>`).join("") + "</tr>";
      let h = "<table>" + row(l, "th"); i += 2;
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) h += row(lines[i++], "td");
      out.push(h + "</table>"); continue;
    }
    let m;
    if ((m = l.match(/^(#{1,3})\s+(.*)/))) { endPara(); endList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = l.match(/^\s*[-*]\s+(.*)/))) { endPara(); if (list !== "ul") { endList(); out.push("<ul>"); list = "ul"; } out.push("<li>" + inline(m[1]) + "</li>"); }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { endPara(); if (list !== "ol") { endList(); out.push("<ol>"); list = "ol"; } out.push("<li>" + inline(m[1]) + "</li>"); }
    else if (!l.trim()) { endPara(); endList(); }
    else { endList(); para.push(l); }
    i++;
  }
  endPara(); endList();
  return out.join("");
}

// ---------- Ảnh kết quả trong câu trả lời ----------
const IMG_RE = /(?:^|[\s"'`(\\/])((?:[\w.\- ]+[\\/])*[\w.\-]+\.(?:png|jpe?g|webp|gif))/gi;
function addImages(box, text) {
  const seen = new Set([...box.querySelectorAll("img")].map((i) => i.dataset.f));
  for (const m of text.matchAll(IMG_RE)) {
    let p = m[1].replace(/\\/g, "/"); let type = "output";
    let i = p.toLowerCase().lastIndexOf("output/");
    if (i < 0) { const j = p.toLowerCase().lastIndexOf("input/"); if (j >= 0) { i = j; type = "input"; } }
    if (i < 0 && !/_\d{5}_\.(png|jpe?g|webp)$/i.test(p)) continue;
    if (i >= 0) p = p.slice(i + (type === "input" ? 6 : 7));
    if (seen.has(p)) continue; seen.add(p);
    const parts = p.split("/"); const filename = parts.pop();
    const img = el("img"); img.dataset.f = p; img.loading = "lazy";
    img.src = api.apiURL(`/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(parts.join("/"))}&type=${type}`);
    img.onerror = () => img.remove();
    img.onclick = () => window.open(img.src, "_blank");
    box.appendChild(img);
  }
}

// ---------- Canvas đang mở → server (MCP comfyui đọc được) ----------
let lastCanvas = "";
async function syncCanvas() {
  try {
    if (!app.graph) return;
    const ui = app.graph.serialize(); const s = JSON.stringify(ui);
    if (s === lastCanvas) return;
    lastCanvas = s;
    let prompt = null;
    try { prompt = (await app.graphToPrompt()).output; } catch {}
    await fetch(api.apiURL("/lnl-ai/canvas"), { method: "POST", headers: H, body: JSON.stringify({ ui, api: prompt, at: Date.now() }) });
  } catch {}
}
api.addEventListener("lnl-ai.load", async (e) => {
  const wf = e.detail?.workflow; if (!wf) return;
  try {
    if (Array.isArray(wf.nodes)) await app.loadGraphData(wf, true, true, e.detail.name);
    else await app.loadApiJson(wf, e.detail.name);
    lastCanvas = ""; setTimeout(syncCanvas, 500);
  } catch (err) { console.error("[LNL AI] load", err); }
});

function selectedNodes() {
  const sel = app.canvas?.selected_nodes; if (!sel) return [];
  return Object.values(sel).slice(0, 12).map((n) => ({ id: n.id, title: n.title || n.type, type: n.type }));
}

// ---------- Giao diện ----------
let MODELS = { claude: [{ id: "", name: "Mặc định của Claude Code", efforts: ["low", "medium", "high", "xhigh", "max"] }], codex: [{ id: "", name: "Mặc định của Codex", efforts: [] }] };
const EFFORT_VI = { minimal: "Tối thiểu", low: "Thấp", medium: "Vừa", high: "Cao", xhigh: "Rất cao", max: "Tối đa", ultra: "Siêu cao" };
const AGENTS = [["claude", "Claude Code"], ["codex", "Codex (ChatGPT)"]];
const TOOLS = [["lean", "Gọn (ít token)"], ["full", "Đầy đủ (mọi MCP/skill)"]];
const COMPACT_PROMPT = "Tóm tắt cuộc trò chuyện này để tiếp tục ở phiên mới: mục tiêu của người dùng, việc đã làm (file/workflow/node/model cụ thể), quyết định, việc còn dở. Gạch đầu dòng, tối đa 250 từ, không làm thêm việc gì khác.";
const MODES = [["auto", "Tự động"], ["acceptEdits", "Tự sửa file"], ["bypassPermissions", "Toàn quyền"], ["plan", "Chỉ lập kế hoạch"]];

function build() {
  if (document.querySelector(".lnl-dock")) return true;
  const host = document.getElementById("comfyui-body-right");
  if (!host) return false;
  if (!document.getElementById("lnl-ai-css")) { const s = el("style"); s.id = "lnl-ai-css"; s.textContent = CSS; document.head.appendChild(s); }

  const dock = el("div", "lnl-dock" + (state.open ? "" : " closed"));
  const pane = el("div", "lnl-pane"); pane.style.width = state.width + "px";
  const bar = el("div", "lnl-bar");
  const bAI = el("button", state.open ? "on" : "", "✨"); bAI.title = "Khung AI (Ctrl+L)";
  const bNew = el("button", "", "＋"); bNew.title = "Cuộc trò chuyện mới";
  const bHist = el("button", "", "🕘"); bHist.title = "Các cuộc trò chuyện";
  const bCompact = el("button", "", "🗜"); bCompact.title = "Tóm gọn cuộc trò chuyện (giảm token cho các tin sau)";
  const bBell = el("button", state.notify === false ? "" : "on", "🔔"); bBell.title = "Báo khi AI làm xong / ảnh tạo xong (khi bạn đang ở cửa sổ khác)";
  bar.append(bAI, bNew, bHist, bCompact, el("div", "sp"), bBell);
  dock.append(pane, bar); host.appendChild(dock);

  // Kéo mép trái để đổi độ rộng
  const grip = el("div", "lnl-grip"); pane.appendChild(grip);
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId); grip.classList.add("drag");
    const x0 = e.clientX, w0 = pane.offsetWidth;
    const mv = (ev) => { state.width = Math.max(300, Math.min(window.innerWidth * 0.7, w0 + (x0 - ev.clientX))); pane.style.width = state.width + "px"; relayout(); };
    const up = () => { grip.classList.remove("drag"); grip.removeEventListener("pointermove", mv); grip.removeEventListener("pointerup", up); save(); };
    grip.addEventListener("pointermove", mv); grip.addEventListener("pointerup", up);
  });
  const relayout = () => requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));

  const head = el("div", "lnl-head");
  const title = el("b");
  const hClose = el("button", null, "✕"); hClose.title = "Thu gọn";
  head.append(title, hClose); pane.appendChild(head);
  const hist = el("div", "lnl-hist"); pane.appendChild(hist);
  const log = el("div", "lnl-log"); pane.appendChild(log);

  const inp = el("div", "lnl-in");
  const box = el("div", "lnl-box");
  const chips = el("div", "lnl-chips");
  const ta = el("textarea"); ta.rows = 2;
  const ctl = el("div", "lnl-ctl");
  const sAgent = el("select"), sModel = el("select"), sEffort = el("select"), sMode = el("select"), sTools = el("select");
  sTools.title = "Gọn: chỉ công cụ ComfyUI, tốn ít token và nhanh hơn. Đầy đủ: thêm mọi MCP, skill và hook của máy (Vira, Frames, Gmail…)";
  sAgent.title = "AI — chạy bằng tài khoản đăng nhập của máy"; sModel.title = "Model"; sEffort.title = "Mức độ suy nghĩ"; sMode.title = "Quyền thao tác";
  const bAttach = el("button", "ic", "📎"); bAttach.title = "Đính kèm ảnh (hoặc dán/kéo thả ảnh vào ô)";
  const bSel = el("button", "ic", "◎"); bSel.title = "Gửi kèm node đang chọn trên canvas";
  const go = el("button", "go", "Gửi");
  ctl.append(sAgent, sModel, sEffort, sMode, sTools, bAttach, bSel, go);
  box.append(chips, ta, ctl);
  const status = el("div", "lnl-status");
  inp.append(box, status); pane.appendChild(inp);
  const file = el("input"); file.type = "file"; file.accept = "image/*"; file.multiple = true; file.style.display = "none"; inp.appendChild(file);

  const opt = (s, list, val) => { s.innerHTML = ""; for (const [v, t] of list) { const o = el("option", null, t); o.value = v; s.appendChild(o); } s.value = [...s.options].some((o) => o.value === val) ? val : (s.options[0]?.value ?? ""); return s.value; };
  const fill = () => {
    opt(sAgent, AGENTS, state.agent);
    const list = MODELS[state.agent] || [];
    state.model[state.agent] = opt(sModel, list.map((m) => [m.id, m.name]), state.model[state.agent]);
    const m = list.find((x) => x.id === sModel.value) || list[0] || { efforts: [] };
    const efforts = m.efforts?.length ? m.efforts : (MODELS[state.agent]?.flatMap((x) => x.efforts || []) || []);
    const uniq = [...new Set(efforts)];
    state.effort[state.agent] = opt(sEffort, [["", "Mức độ: mặc định"], ...uniq.map((e) => [e, "Mức độ: " + (EFFORT_VI[e] || e)])], state.effort[state.agent]);
    opt(sMode, MODES, state.mode);
    state.tools = opt(sTools, TOOLS, state.tools); sTools.style.display = state.agent === "claude" ? "" : "none";
    ta.placeholder = `Hỏi ${state.agent === "codex" ? "Codex" : "Claude"}… (Enter gửi, Shift+Enter xuống dòng)`;
  };
  sAgent.onchange = () => { state.agent = sAgent.value; fill(); save(); };
  sModel.onchange = () => { state.model[state.agent] = sModel.value; fill(); save(); };
  sEffort.onchange = () => { state.effort[state.agent] = sEffort.value; save(); };
  sMode.onchange = () => { state.mode = sMode.value; save(); };
  sTools.onchange = () => { state.tools = sTools.value; save(); };
  fill();
  fetch(api.apiURL("/lnl-ai/models"), { headers: H }).then((r) => r.json()).then((j) => {
    if (j.claude?.length) MODELS.claude = j.claude;
    if (j.codex?.length) MODELS.codex = j.codex;
    if (j.have && !j.have.codex) AGENTS[1] = ["codex", "Codex (chưa cài)"];
    fill();
  }).catch(() => {});

  // Mở/đóng khung
  const setOpen = (v) => { state.open = v; dock.classList.toggle("closed", !v); bAI.classList.toggle("on", v); save(); relayout(); if (v) setTimeout(() => ta.focus(), 50); };
  bAI.onclick = () => setOpen(!state.open);
  hClose.onclick = () => setOpen(false);
  window.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); e.stopPropagation(); setOpen(!state.open || document.activeElement !== ta); } }, true);

  // Cuộc trò chuyện
  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const addMsg = (role, text) => {
    const m = el("div", "lnl-msg " + role);
    if (role === "ai") { m.innerHTML = md(text); addImages(m, text); m.dataset.raw = text; m.title = "Nhấp đúp để chép"; m.ondblclick = () => { navigator.clipboard?.writeText(m.dataset.raw || m.innerText); status.textContent = "Đã chép câu trả lời"; }; } else m.textContent = text;
    log.appendChild(m); scroll(); return m;
  };
  const toolCard = (name, input, result, ok) => {
    const d = el("details", "lnl-tool"); const s = el("summary");
    const arg = input ? (input.command || input.file_path || input.path || input.pattern || input.url || input.description || JSON.stringify(input)) : "";
    s.append(el("span", "n", name), el("span", "a", String(arg).slice(0, 160)), el("span", "s", ok == null ? "…" : ok ? "✓" : "✗"));
    d.appendChild(s);
    const pre = el("pre"); pre.textContent = JSON.stringify(input, null, 1) + (result ? "\n──\n" + result : ""); d.appendChild(pre);
    log.appendChild(d); scroll(); return d;
  };
  const show = () => {
    const c = conv(); log.innerHTML = "";
    title.textContent = c.title || "Cuộc trò chuyện mới";
    for (const h of c.history) {
      if (h.role === "tool") { const d = toolCard(h.name || "công cụ", h.input || h.text, h.result, h.ok ?? true); if (h.imgs) { const b = el("div", "lnl-imgs"); addImages(b, h.imgs); log.insertBefore(b, d.nextSibling); } }
      else addMsg(h.role, h.text);
    }
    if (!c.history.length) log.appendChild(el("div", "lnl-hint", "Ra lệnh như Claude trong Cursor: tạo ảnh, dựng/sửa workflow trên canvas, cài model, sửa code… Dán hoặc kéo ảnh vào ô để gửi kèm; bấm ◎ để gửi kèm node đang chọn. Ctrl+L mở/đóng khung."));
    status.textContent = c.sessions[state.agent] ? "Đang tiếp tục phiên trước" + ctxText(c) : c.carry ? "Phiên mới, mang theo bản tóm tắt" : "";
    scroll();
  };
  const ctxText = (c) => {
    if (!c.ctx) return "";
    const k = Math.round(c.ctx / 1000);
    return ` · ngữ cảnh ${k}k token` + (c.ctx > 120000 ? " (dài — bấm 🗜 để tóm gọn)" : "");
  };
  const renderHist = () => {
    hist.innerHTML = "";
    for (const c of state.convs) {
      const r = el("div", c.id === state.cur ? "cur" : "");
      const del = el("button", null, "🗑"); del.title = "Xoá";
      r.append(el("span", null, c.title || "Cuộc trò chuyện mới"), el("small", null, new Date(c.at).toLocaleDateString("vi-VN")), del);
      r.onclick = () => { if (running) return; state.cur = c.id; save(); hist.classList.remove("show"); show(); };
      del.onclick = (e) => { e.stopPropagation(); if (running && c.id === state.cur) return; state.convs = state.convs.filter((x) => x !== c); if (!state.convs.length) state.convs.push(newConv(state.agent)); if (!state.convs.some((x) => x.id === state.cur)) state.cur = state.convs[0].id; save(); renderHist(); show(); };
      hist.appendChild(r);
    }
  };
  bHist.onclick = () => { if (!state.open) setOpen(true); renderHist(); hist.classList.toggle("show"); };
  bNew.onclick = () => { if (running) return; if (!state.open) setOpen(true); const c = conv(); if (c.history.length) { const n = newConv(state.agent); state.convs.unshift(n); state.cur = n.id; } save(); hist.classList.remove("show"); show(); ta.focus(); };

  // Ảnh đính kèm + node đang chọn
  let attached = [], withSel = false;
  const drawChips = () => {
    chips.innerHTML = "";
    for (const a of attached) {
      const c = el("div", "lnl-chip"); const im = el("img"); im.src = a.url; const x = el("button", null, "✕");
      x.onclick = () => { attached = attached.filter((y) => y !== a); drawChips(); };
      c.append(im, el("span", null, a.name.split("/").pop().slice(-18)), x); chips.appendChild(c);
    }
    if (withSel) {
      const n = selectedNodes(); const c = el("div", "lnl-chip"); const x = el("button", null, "✕");
      x.onclick = () => { withSel = false; bSel.style.color = ""; drawChips(); };
      c.append(el("span", null, n.length ? "◎ " + n.map((x) => x.title).join(", ").slice(0, 60) : "◎ (chưa chọn node nào)"), x); chips.appendChild(c);
    }
  };
  const upload = async (files) => {
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      const fd = new FormData(); fd.append("file", f, f.name || "anh-dan.png");
      status.textContent = "Đang tải ảnh lên…";
      try {
        const r = await fetch(api.apiURL("/lnl-ai/upload"), { method: "POST", headers: { "X-LNL-AI": "1" }, body: fd });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
        attached.push({ path: j.path, name: j.name, url: URL.createObjectURL(f) }); status.textContent = "";
      } catch (e) { status.textContent = "Không tải được ảnh: " + (e.message || e); }
    }
    drawChips();
  };
  bAttach.onclick = () => file.click();
  file.onchange = () => { upload([...file.files]); file.value = ""; };
  ta.addEventListener("paste", (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); upload(fs); } });
  box.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); e.stopPropagation(); box.classList.add("drop"); } });
  box.addEventListener("dragleave", () => box.classList.remove("drop"));
  box.addEventListener("drop", (e) => { box.classList.remove("drop"); const fs = [...(e.dataTransfer?.files || [])]; if (fs.length) { e.preventDefault(); e.stopPropagation(); upload(fs); } });
  bSel.onclick = () => { withSel = !withSel; bSel.style.color = withSel ? "#ffd166" : ""; drawChips(); };

  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(240, ta.scrollHeight) + "px"; };
  ta.addEventListener("input", grow);
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); run(); }
    else if (e.key === "Escape" && running) { e.preventDefault(); run(); }
  });
  for (const t of ["keyup", "keypress"]) ta.addEventListener(t, (e) => e.stopPropagation());

  // Gửi / nhận
  let running = null;
  async function run(opts = {}) {
    if (running) { status.textContent = "Đang dừng…"; await fetch(api.apiURL("/lnl-ai/stop"), { method: "POST", headers: H, body: JSON.stringify({ run_id: running }) }).catch(() => {}); return; }
    const compact = !!opts.compact;
    const text = compact ? COMPACT_PROMPT : ta.value.trim(); if (!text && !attached.length) return;
    const c = conv(); const agent = state.agent; const who = agent === "codex" ? "Codex" : "Claude";
    if (compact && !c.sessions[agent]) { status.textContent = "Chưa có gì để tóm gọn"; return; }
    askNotify();
    if (!c.history.length) { log.innerHTML = ""; c.title = (text || "Ảnh").slice(0, 60); title.textContent = c.title; }
    c.agent = agent; c.at = Date.now();
    state.convs = [c, ...state.convs.filter((x) => x !== c)];
    let message = text || "Xem ảnh đính kèm.";
    const carry = !compact && !c.sessions[agent] && c.carry ? c.carry : "";
    if (carry) message = "[Bản tóm tắt cuộc trò chuyện trước — tiếp tục từ đây]\n" + carry + "\n\n" + message;
    const sel = withSel ? selectedNodes() : [];
    if (sel.length) message += "\n\n[Node đang chọn trên canvas: " + sel.map((n) => `#${n.id} ${n.title} (${n.type})`).join("; ") + "]";
    const images = attached.map((a) => a.path);
    const shown = (compact ? "🗜 Tóm gọn cuộc trò chuyện" : text) + (attached.length ? `\n📎 ${attached.length} ảnh` : "") + (sel.length ? `\n◎ ${sel.length} node` : "");
    addMsg("user", shown); c.history.push({ role: "user", text: shown });
    if (!compact) { ta.value = ""; grow(); } attached = []; withSel = false; bSel.style.color = ""; drawChips(); save();
    await syncCanvas();
    go.textContent = "Dừng"; go.classList.add("stop"); running = "pending";
    let finished = false; const t0 = Date.now(); const tick = setInterval(() => { if (running && !finished) status.textContent = `${who} đang làm… ${Math.round((Date.now() - t0) / 1000)}s`; }, 1000);
    status.textContent = who + " đang làm…";
    let cur = null, curText = "", lastAI = "", ok = false; const cards = new Map();
    const flush = () => { if (cur && curText) { lastAI = curText; c.history.push({ role: "ai", text: curText }); cur.dataset.raw = curText; cur.innerHTML = md(curText); addImages(cur, curText); } cur = null; curText = ""; };
    let paint = 0;
    try {
      const res = await fetch(api.apiURL("/lnl-ai/chat"), { method: "POST", headers: H, body: JSON.stringify({
        agent, message, session_id: c.sessions[agent], mode: state.mode,
        model: state.model[agent] || undefined, effort: state.effort[agent] || undefined, tools: state.tools, images }) });
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
          else if (ev.type === "system" && ev.session_id) { c.sessions[agent] = ev.session_id; save(); }
          else if (ev.type === "stream_event") {
            const d = ev.event;
            if (d?.type === "content_block_delta" && d.delta?.type === "text_delta") {
              if (!cur) cur = addMsg("ai", "");
              curText += d.delta.text;
              const now = Date.now(); if (now - paint > 80) { paint = now; cur.innerHTML = md(curText); scroll(); }
            } else if (d?.type === "message_stop") flush();
          } else if (ev.type === "assistant") {
            const mu = ev.message?.usage;
            if (mu && !ev.parent_tool_use_id) { const n = (mu.input_tokens || 0) + (mu.cache_creation_input_tokens || 0) + (mu.cache_read_input_tokens || 0); if (n) c.ctx = n; }
            for (const b of ev.message?.content || []) {
              if (b.type === "tool_use") {
                flush();
                const h = { role: "tool", name: b.name, input: b.input, ok: null };
                c.history.push(h); cards.set(b.id, { card: toolCard(b.name, b.input, "", null), h });
              } else if (b.type === "text" && b.text && !cur && !curText && !c.history.some((x) => x.text === b.text)) {
                // Codex / không có stream từng chữ: hiện cả đoạn
                cur = addMsg("ai", b.text); curText = b.text; flush();
              }
            }
          } else if (ev.type === "user") {
            for (const b of ev.message?.content || []) {
              if (b.type !== "tool_result") continue;
              const txt = typeof b.content === "string" ? b.content : (b.content || []).map((x) => x.text || "").join("\n");
              const it = cards.get(b.tool_use_id);
              if (it) {
                it.h.ok = !b.is_error; it.h.result = txt.slice(0, 4000);
                it.card.querySelector(".s").textContent = b.is_error ? "✗" : "✓";
                it.card.querySelector("pre").textContent = JSON.stringify(it.h.input, null, 1) + "\n──\n" + it.h.result;
                const imgs = el("div", "lnl-imgs"); addImages(imgs, txt);
                if (imgs.children.length) { it.h.imgs = txt.slice(0, 4000); log.insertBefore(imgs, it.card.nextSibling); scroll(); }
              }
            }
          } else if (ev.type === "result") {
            flush(); finished = true;
            if (ev.session_id) c.sessions[agent] = ev.session_id;
            const u = ev.usage || {}; const tok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
            const model = Object.keys(ev.modelUsage || {})[0];
            status.textContent = `Xong · ${Math.round((ev.duration_ms || 0) / 1000)}s` + (ev.num_turns ? ` · ${ev.num_turns} lượt` : "") + (tok ? ` · ${Math.round(tok / 1000)}k token vào, ${u.output_tokens || 0} ra` : "") + (model ? ` · ${model}` : "") + ctxText(c);
            ok = !ev.is_error;
            if (ev.is_error && ev.result) { addMsg("err", ev.result); c.history.push({ role: "err", text: ev.result }); }
          } else if (ev.type === "lnl_error") { flush(); addMsg("err", ev.text); c.history.push({ role: "err", text: ev.text }); status.textContent = "Lỗi"; }
        }
      }
    } catch (err) { flush(); addMsg("err", String(err.message || err)); status.textContent = "Lỗi"; }
    clearInterval(tick); flush();
    for (const { h } of cards.values()) if (h.ok == null) h.ok = false;
    if (ok && carry) delete c.carry;
    if (ok && compact && lastAI) {
      // Phiên mới gọn nhẹ: bỏ phiên cũ, tin sau mang theo bản tóm tắt.
      const note = "— Đã tóm gọn. Tin tiếp theo bắt đầu phiên mới, mang theo bản tóm tắt ở trên. —";
      c.carry = lastAI.slice(0, 8000); c.sessions = {}; c.ctx = 0;
      c.history.push({ role: "ai", text: note }); addMsg("ai", note);
      status.textContent = "Đã tóm gọn — tin sau tốn ít token hơn";
    }
    save(); running = null; go.textContent = "Gửi"; go.classList.remove("stop");
    if (/đang làm|Đang dừng/.test(status.textContent)) status.textContent = "Đã dừng";
    else notify(ok ? who + " đã xong" : who + " dừng vì lỗi", (lastAI || status.textContent).replace(/[#*`>]/g, "").slice(0, 160));
  }
  go.onclick = () => run();
  bCompact.onclick = () => { if (!state.open) setOpen(true); if (!running) run({ compact: true }); };
  bBell.onclick = () => { state.notify = state.notify === false; bBell.classList.toggle("on", state.notify); if (state.notify) askNotify(); save(); status.textContent = state.notify ? "Sẽ báo khi xong (khi bạn ở cửa sổ khác)" : "Đã tắt báo khi xong"; };
  // Workflow ComfyUI chạy xong / lỗi cũng báo
  api.addEventListener("execution_success", () => notify("ComfyUI đã tạo xong", "Workflow vừa chạy xong — mở để xem kết quả."));
  api.addEventListener("execution_error", (e) => notify("ComfyUI bị lỗi", String(e?.detail?.exception_message || "Workflow dừng vì lỗi").slice(0, 160)));

  show(); grow(); relayout();
  if (state.open) setTimeout(() => ta.focus(), 300);
  return true;
}

app.registerExtension({
  name: "LNL.AIPanel",
  async setup() {
    await Promise.race([loadDisk(), new Promise((r) => setTimeout(r, 3000))]);
    setInterval(syncCanvas, 3000);
    // Không chặn khởi động: chờ vùng bên phải của ComfyUI xuất hiện rồi gắn khung.
    let tries = 0;
    const t = setInterval(() => { if (build() || ++tries > 240) clearInterval(t); }, 250);
  },
});
