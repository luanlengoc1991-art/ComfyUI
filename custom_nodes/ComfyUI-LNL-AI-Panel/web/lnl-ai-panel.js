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
  s = Object.assign({ agent: "claude", mode: "auto", tools: "lean", model: { claude: "", codex: "" }, effort: { claude: "", codex: "" }, convs: [], cur: "", open: true, width: 420, tabMap: {}, curByTab: {} }, s);
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
// ---------- Mỗi tab workflow một cuộc trò chuyện riêng: AI chỉ đọc/sửa đúng tab đã ra lệnh ----------
let curTab = "";
const wfStore = () => app.extensionManager?.workflow;
const newTabId = () => "t" + Math.random().toString(36).slice(2, 12);
// Mã tab gắn vào chính tab đó (giữ khi đổi tên/lưu); sau khi tải lại trang thì nhận lại theo đường dẫn.
const tabOf = (wf) => {
  if (!wf) return "";
  if (!wf.__lnlTab) wf.__lnlTab = state.tabMap[wf.path] || newTabId();
  if (state.tabMap[wf.path] !== wf.__lnlTab) {
    for (const [p, id] of Object.entries(state.tabMap)) if (id === wf.__lnlTab) delete state.tabMap[p];
    state.tabMap[wf.path] = wf.__lnlTab;
  }
  return wf.__lnlTab;
};
const tabName = (wf) => wf?.filename || "Workflow";
const findTab = (id) => (wfStore()?.openWorkflows || []).find((w) => tabOf(w) === id);
const conv = () => {
  let c = state.convs.find((x) => x.id === state.curByTab[curTab] && x.tab === curTab);
  if (!c) c = state.convs.find((x) => x.tab === curTab);
  // Bản cũ (chưa chia theo tab): cuộc trò chuyện đang mở thuộc về tab đầu tiên gặp.
  if (!c) { c = state.convs.find((x) => !x.tab && x.id === state.cur); if (c) c.tab = curTab; }
  if (!c) { c = newConv(state.agent); c.tab = curTab; state.convs.unshift(c); }
  state.curByTab[curTab] = c.id;
  return c;
};
let diskTimer = 0;
const toDisk = () => fetch(api.apiURL("/lnl-ai/state"), { method: "POST", headers: H, body: JSON.stringify(state), keepalive: true }).catch(() => {});
const save = () => {
  for (const c of state.convs) c.history = c.history.slice(-120);
  const live = new Set(Object.values(state.curByTab));
  state.convs = state.convs.filter((c) => c.history.length || live.has(c.id)).slice(0, MAX_CONVS);
  for (const [t, id] of Object.entries(state.curByTab)) if (!state.convs.some((c) => c.id === id)) delete state.curByTab[t];
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
      state.tabMap = state.tabMap || {}; state.curByTab = state.curByTab || {};
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
.lnl-dock{display:flex;height:100%;max-height:100%;min-height:0;overflow:hidden;font-size:13px;color:var(--fg-color,#ddd);background:var(--comfy-menu-bg,#171717)}
.lnl-bar{width:44px;flex:0 0 44px;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 0;border-left:1px solid var(--border-color,#2c2c2c);background:#141821}
.lnl-bar button{width:34px;height:34px;border-radius:8px;border:none;background:transparent;color:#aab;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}
.lnl-bar button:hover{background:#262c3a;color:#fff}
.lnl-bar button.on{background:#2b3d63;color:#ffd166}
.lnl-bar .sp{flex:1}
.lnl-pane{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;border-left:1px solid var(--border-color,#2c2c2c);background:#181818}
.lnl-dock.closed .lnl-pane{display:none}
.lnl-grip{position:absolute;left:-3px;top:0;bottom:0;width:6px;cursor:ew-resize;z-index:3}
.lnl-grip:hover,.lnl-grip.drag{background:#3b6fe0}
.lnl-head{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #2a2a2a}
.lnl-head b{flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lnl-head button{background:none;border:none;color:#aaa;cursor:pointer;font-size:14px;padding:2px 6px;border-radius:5px}
.lnl-head button:hover{background:#2a2a2a;color:#fff}
.lnl-log{flex:1 1 auto;min-height:0;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:10px}
.lnl-view{display:flex;flex-direction:column;gap:10px}
.lnl-hist p{margin:8px 4px 4px;font-size:11px;opacity:.55;text-transform:uppercase;letter-spacing:.04em}
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
.lnl-msg img,.lnl-imgs img{max-width:100%;max-height:420px;object-fit:contain;border-radius:6px;margin-top:6px;cursor:pointer;display:block}
.lnl-tool{border:1px solid #2c2c2c;border-radius:7px;background:#1d1d1d;font-size:12px}
.lnl-tool summary{cursor:pointer;padding:5px 8px;list-style:none;display:flex;gap:6px;align-items:center;color:#bbb;white-space:nowrap;overflow:hidden}
.lnl-tool summary::-webkit-details-marker{display:none}
.lnl-tool summary .n{color:#8fb4ff;font-weight:600}
.lnl-tool summary .a{opacity:.6;overflow:hidden;text-overflow:ellipsis}
.lnl-tool summary .s{margin-left:auto;opacity:.8}
.lnl-tool pre{margin:0;padding:6px 8px;border-top:1px solid #2c2c2c;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:11px;opacity:.85}
.lnl-think{font-size:12px;opacity:.6;font-style:italic}
.lnl-in{flex:0 0 auto;padding:10px 12px 12px;background:#181818;box-shadow:0 -10px 18px -12px rgba(0,0,0,.7);position:relative;z-index:2}
.lnl-box{position:relative;border:1px solid #3a3f4b;border-radius:14px;background:#1f2128;padding:8px 8px 6px;transition:border-color .15s,box-shadow .15s}
.lnl-box:focus-within{border-color:#e0457b;box-shadow:0 0 0 3px rgba(224,69,123,.18)}
.lnl-box.drop{border-color:#ffd166;background:#2a2618}
.lnl-chips{display:flex;flex-wrap:wrap;gap:4px}
.lnl-chips:not(:empty){margin-bottom:6px}
.lnl-chip{display:flex;align-items:center;gap:4px;background:#2b2e36;border-radius:8px;padding:2px 6px;font-size:11px;max-width:100%}
.lnl-chip img{width:22px;height:22px;object-fit:cover;border-radius:4px}
.lnl-chip button{background:none;border:none;color:#999;cursor:pointer;padding:0 2px}
.lnl-box textarea{display:block;width:100%;box-sizing:border-box;min-height:42px;max-height:240px;resize:none;background:transparent;color:#e8e8e8;border:none;outline:none;padding:2px 4px 6px;font:inherit;font-size:13.5px;line-height:1.5}
.lnl-box textarea::placeholder{color:#7d828e}
.lnl-ctl{display:flex;flex-wrap:wrap;gap:4px 3px;min-width:0;padding-right:38px;align-items:center;padding-top:6px;border-top:1px solid #2c2f37}
.lnl-ctl select{appearance:none;-webkit-appearance:none;background:#2a2d35;color:#cfd3dc;border:1px solid transparent;border-radius:999px;padding:3px 9px;font-size:11px;flex:0 1 auto;min-width:0;max-width:118px;cursor:pointer;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.lnl-ctl select:hover{border-color:#454a57;color:#fff}
.lnl-ctl select.lite{background:transparent;color:#9aa0ab;padding:3px 6px}
.lnl-ctl .ic{flex:0 0 26px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:none;border:1px solid transparent;color:#a9adb7;cursor:pointer;font-size:14px;padding:0;border-radius:8px}
.lnl-ctl .ic:hover{background:#2e313a;color:#fff;border-color:#3a3e48}
.lnl-ctl .sp{display:none}
.lnl-ctl .go{position:absolute;right:8px;bottom:7px;width:30px;height:30px;flex:0 0 30px;display:flex;align-items:center;justify-content:center;background:#e0457b;color:#fff;border:none;border-radius:9px;cursor:pointer;font-size:16px;font-weight:700;line-height:1;padding:0}
.lnl-ctl .go:hover{filter:brightness(1.12)}
.lnl-ctl .go.stop{background:#3a3e48;font-size:12px}
.lnl-status{font-size:11px;opacity:.65;margin-top:6px;padding:0 4px;min-height:14px;display:flex;gap:8px}
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

// ---------- Canvas từng tab → server (MCP comfyui chỉ đọc/ghi đúng tab đã ra lệnh) ----------
const lastCanvas = new Map();
const pendingLoad = new Map(); // tab đang ẩn: workflow AI gửi tới sẽ hiện khi bạn mở lại tab đó
async function syncCanvas() {
  try {
    const ws = wfStore(); if (!app.graph) return;
    const active = ws?.activeWorkflow;
    const list = ws?.openWorkflows?.length ? ws.openWorkflows : [null];
    for (const w of list) {
      const isActive = !w || w === active;
      const ui = isActive ? app.graph.serialize() : w.changeTracker?.activeState;
      if (!ui) continue;
      const tab = w ? tabOf(w) : "";
      const s = (isActive ? "*" : "") + JSON.stringify(ui);
      if (lastCanvas.get(tab) === s) continue;
      let prompt = null;
      if (isActive && !ws?.isBusy) { try { prompt = (await app.graphToPrompt()).output; } catch {} }
      const r = await fetch(api.apiURL("/lnl-ai/canvas"), { method: "POST", headers: H,
        body: JSON.stringify({ tab: tab || undefined, name: w ? tabName(w) : undefined, active: isActive, ui, api: prompt, at: Date.now() }) });
      if (r.ok) lastCanvas.set(tab, s);
    }
  } catch {}
}
async function loadInto(wf, d, target) {
  if (Array.isArray(wf.nodes)) await app.loadGraphData(wf, true, true, target || d.name);
  else await app.loadApiJson(wf, target || d.name);
}
api.addEventListener("lnl-ai.load", async (e) => {
  const d = e.detail || {}; const wf = d.workflow; if (!wf) return;
  try {
    const ws = wfStore(); const tab = d.tab || "";
    const target = tab ? findTab(tab) : null;
    if (target && target !== ws?.activeWorkflow) {
      pendingLoad.set(tab, d);
      const ui = Array.isArray(wf.nodes);
      fetch(api.apiURL("/lnl-ai/canvas"), { method: "POST", headers: H, body: JSON.stringify({ tab, name: tabName(target), active: false, ui: ui ? wf : null, api: ui ? null : wf, pending: true, at: Date.now() }) }).catch(() => {});
      return;
    }
    // Tab đúng đang mở → nạp vào chính tab đó (không mở tab mới). Tab đã bị đóng → mở tab mới, giữ cuộc trò chuyện.
    await loadInto(wf, d, target);
    if (tab && !target) { const a = wfStore()?.activeWorkflow; if (a) { a.__lnlTab = tab; tabOf(a); } }
    lastCanvas.clear(); setTimeout(syncCanvas, 500);
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
  // Hàng lưới của ComfyUI cao theo nội dung: tự giữ khung bằng đúng phần màn hình còn lại,
  // để tin nhắn dài/ảnh lớn chỉ cuộn bên trong, ô nhập luôn nằm ở đáy.
  const fitDock = () => {
    const body = document.getElementById("comfyui-body") || host.parentElement;
    const top = Math.max(0, host.getBoundingClientRect().top - (body?.getBoundingClientRect().top || 0));
    const h = Math.max(240, (body?.clientHeight || innerHeight) - top);
    dock.style.height = h + "px"; host.style.maxHeight = h + "px"; host.style.overflow = "hidden";
  };
  addEventListener("resize", fitDock);
  const fitBody = document.getElementById("comfyui-body");
  if (fitBody && window.ResizeObserver) new ResizeObserver(fitDock).observe(fitBody);
  requestAnimationFrame(fitDock);
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
  const bAttach = el("button", "ic", "＋"); bAttach.title = "Đính kèm ảnh (hoặc dán/kéo thả ảnh vào ô)";
  const bSel = el("button", "ic", "◎"); bSel.title = "Gửi kèm node đang chọn trên canvas";
  const go = el("button", "go", "↑"); go.title = "Gửi (Enter)"; sMode.classList.add("lite"); sTools.classList.add("lite");
  ctl.append(bAttach, bSel, sAgent, sModel, sEffort, el("div", "sp"), sMode, sTools, go);
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
  // Mỗi cuộc trò chuyện có khung riêng: đổi tab không làm mất lượt AI đang chạy ở tab kia.
  const views = new Map(), runs = new Map(), stat = new Map();
  const isShown = (c) => !!c && log.firstChild === views.get(c.id);
  const setStatus = (c, t) => { stat.set(c.id, t); if (isShown(c)) status.textContent = t; };
  const scroll = (c) => { if (!c || isShown(c)) log.scrollTop = log.scrollHeight; };
  const syncGo = () => { const r = runs.has(conv().id); go.textContent = r ? "■" : "↑"; go.title = r ? "Dừng" : "Gửi (Enter)"; go.classList.toggle("stop", r); };
  const addMsg = (c, role, text) => {
    const m = el("div", "lnl-msg " + role);
    if (role === "ai") { m.innerHTML = md(text); addImages(m, text); m.dataset.raw = text; m.title = "Nhấp đúp để chép"; m.ondblclick = () => { navigator.clipboard?.writeText(m.dataset.raw || m.innerText); setStatus(c, "Đã chép câu trả lời"); }; } else m.textContent = text;
    viewOf(c).appendChild(m); scroll(c); return m;
  };
  const toolCard = (c, name, input, result, ok) => {
    const d = el("details", "lnl-tool"); const s = el("summary");
    const arg = input ? (input.command || input.file_path || input.path || input.pattern || input.url || input.description || JSON.stringify(input)) : "";
    s.append(el("span", "n", name), el("span", "a", String(arg).slice(0, 160)), el("span", "s", ok == null ? "…" : ok ? "✓" : "✗"));
    d.appendChild(s);
    const pre = el("pre"); pre.textContent = JSON.stringify(input, null, 1) + (result ? "\n──\n" + result : ""); d.appendChild(pre);
    viewOf(c).appendChild(d); scroll(c); return d;
  };
  function viewOf(c) {
    let v = views.get(c.id); if (v) return v;
    v = el("div", "lnl-view"); views.set(c.id, v);
    for (const h of c.history) {
      if (h.role === "tool") { const d = toolCard(c, h.name || "công cụ", h.input || h.text, h.result, h.ok ?? true); if (h.imgs) { const b = el("div", "lnl-imgs"); addImages(b, h.imgs); v.insertBefore(b, d.nextSibling); } }
      else addMsg(c, h.role, h.text);
    }
    if (!c.history.length) v.appendChild(el("div", "lnl-hint", "Mỗi tab workflow có cuộc trò chuyện riêng — AI chỉ đọc và sửa đúng tab này. Ra lệnh như Claude trong Cursor: tạo ảnh, dựng/sửa workflow, cài model… Dán hoặc kéo ảnh vào ô để gửi kèm; bấm ◎ để gửi kèm node đang chọn. Ctrl+L mở/đóng khung."));
    return v;
  }
  const show = () => {
    const c = conv(); const v = viewOf(c);
    if (log.firstChild !== v) log.replaceChildren(v);
    const w = findTab(curTab);
    title.textContent = (w ? "📑 " + tabName(w) + " · " : "") + (c.title || "Cuộc trò chuyện mới");
    title.title = title.textContent;
    status.textContent = stat.get(c.id) ?? (c.sessions[state.agent] ? "Đang tiếp tục phiên trước" + ctxText(c) : c.carry ? "Phiên mới, mang theo bản tóm tắt" : "");
    syncGo(); scroll(c);
  };
  const ctxText = (c) => {
    if (!c.ctx) return "";
    const k = Math.round(c.ctx / 1000);
    return ` · ngữ cảnh ${k}k token` + (c.ctx > 120000 ? " (dài — bấm 🗜 để tóm gọn)" : "");
  };
  const renderHist = () => {
    hist.innerHTML = "";
    const cur = conv();
    const row = (c) => {
      const r = el("div", c.id === cur.id ? "cur" : "");
      const del = el("button", null, "🗑"); del.title = "Xoá";
      r.append(el("span", null, (runs.has(c.id) ? "⏳ " : "") + (c.title || "Cuộc trò chuyện mới")), el("small", null, new Date(c.at).toLocaleDateString("vi-VN")), del);
      r.onclick = () => {
        if (c.tab !== curTab) { if (runs.has(c.id)) return; c.tab = curTab; } // chuyển cuộc trò chuyện cũ sang tab này
        state.curByTab[curTab] = c.id; save(); hist.classList.remove("show"); show();
      };
      del.onclick = (e) => { e.stopPropagation(); if (runs.has(c.id)) return; state.convs = state.convs.filter((x) => x !== c); views.delete(c.id); stat.delete(c.id); save(); renderHist(); show(); };
      hist.appendChild(r);
    };
    hist.appendChild(el("p", null, "Tab này"));
    state.convs.filter((c) => c.tab === curTab).forEach(row);
    const other = state.convs.filter((c) => c.tab !== curTab && c.history.length);
    if (other.length) { hist.appendChild(el("p", null, "Tab khác / đã đóng — bấm để chuyển sang tab này")); other.forEach(row); }
  };
  bHist.onclick = () => { if (!state.open) setOpen(true); renderHist(); hist.classList.toggle("show"); };
  bNew.onclick = () => { if (!state.open) setOpen(true); const c = conv(); if (c.history.length) { const n = newConv(state.agent); n.tab = curTab; state.convs.unshift(n); state.curByTab[curTab] = n.id; } save(); hist.classList.remove("show"); show(); ta.focus(); };

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
    else if (e.key === "Escape" && runs.has(conv().id)) { e.preventDefault(); run(); }
  });
  for (const t of ["keyup", "keypress"]) ta.addEventListener(t, (e) => e.stopPropagation());

  // Gửi / nhận
  async function run(opts = {}) {
    const c = conv();
    if (runs.has(c.id)) {
      const id = runs.get(c.id); setStatus(c, "Đang dừng…");
      if (id !== "pending") await fetch(api.apiURL("/lnl-ai/stop"), { method: "POST", headers: H, body: JSON.stringify({ run_id: id }) }).catch(() => {});
      return;
    }
    const compact = !!opts.compact;
    const text = compact ? COMPACT_PROMPT : ta.value.trim(); if (!text && !attached.length) return;
    const agent = state.agent; const who = agent === "codex" ? "Codex" : "Claude";
    if (compact && !c.sessions[agent]) { setStatus(c, "Chưa có gì để tóm gọn"); return; }
    askNotify();
    if (!c.history.length) { viewOf(c).querySelector(".lnl-hint")?.remove(); c.title = (text || "Ảnh").slice(0, 60); show(); }
    c.agent = agent; c.at = Date.now();
    state.convs = [c, ...state.convs.filter((x) => x !== c)];
    let message = text || "Xem ảnh đính kèm.";
    const carry = !compact && !c.sessions[agent] && c.carry ? c.carry : "";
    if (carry) message = "[Bản tóm tắt cuộc trò chuyện trước — tiếp tục từ đây]\n" + carry + "\n\n" + message;
    const sel = withSel ? selectedNodes() : [];
    if (sel.length) message += "\n\n[Node đang chọn trên canvas: " + sel.map((n) => `#${n.id} ${n.title} (${n.type})`).join("; ") + "]";
    const images = attached.map((a) => a.path);
    const shown = (compact ? "🗜 Tóm gọn cuộc trò chuyện" : text) + (attached.length ? `\n📎 ${attached.length} ảnh` : "") + (sel.length ? `\n◎ ${sel.length} node` : "");
    addMsg(c, "user", shown); c.history.push({ role: "user", text: shown });
    if (!compact) { ta.value = ""; grow(); } attached = []; withSel = false; bSel.style.color = ""; drawChips(); save();
    runs.set(c.id, "pending"); syncGo();
    await syncCanvas();
    const tabW = findTab(c.tab);
    let finished = false; const t0 = Date.now(); const tick = setInterval(() => { if (runs.has(c.id) && !finished) setStatus(c, `${who} đang làm… ${Math.round((Date.now() - t0) / 1000)}s`); }, 1000);
    setStatus(c, who + " đang làm…");
    let cur = null, curText = "", lastAI = "", ok = false; const cards = new Map();
    const flush = () => { if (cur && curText) { lastAI = curText; c.history.push({ role: "ai", text: curText }); cur.dataset.raw = curText; cur.innerHTML = md(curText); addImages(cur, curText); } cur = null; curText = ""; };
    let paint = 0;
    try {
      const res = await fetch(api.apiURL("/lnl-ai/chat"), { method: "POST", headers: H, body: JSON.stringify({
        agent, message, session_id: c.sessions[agent], mode: state.mode,
        model: state.model[agent] || undefined, effort: state.effort[agent] || undefined, tools: state.tools, images, tab: c.tab || undefined, tab_name: tabW ? tabName(tabW) : undefined }) });
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
          if (ev.type === "lnl_run") runs.set(c.id, ev.run_id);
          else if (ev.type === "system" && ev.session_id) { c.sessions[agent] = ev.session_id; save(); }
          else if (ev.type === "stream_event") {
            const d = ev.event;
            if (d?.type === "content_block_delta" && d.delta?.type === "text_delta") {
              if (!cur) cur = addMsg(c, "ai", "");
              curText += d.delta.text;
              const now = Date.now(); if (now - paint > 80) { paint = now; cur.innerHTML = md(curText); scroll(c); }
            } else if (d?.type === "message_stop") flush();
          } else if (ev.type === "assistant") {
            const mu = ev.message?.usage;
            if (mu && !ev.parent_tool_use_id) { const n = (mu.input_tokens || 0) + (mu.cache_creation_input_tokens || 0) + (mu.cache_read_input_tokens || 0); if (n) c.ctx = n; }
            for (const b of ev.message?.content || []) {
              if (b.type === "tool_use") {
                flush();
                const h = { role: "tool", name: b.name, input: b.input, ok: null };
                c.history.push(h); cards.set(b.id, { card: toolCard(c, b.name, b.input, "", null), h });
              } else if (b.type === "text" && b.text && !cur && !curText && !c.history.some((x) => x.text === b.text)) {
                // Codex / không có stream từng chữ: hiện cả đoạn
                cur = addMsg(c, "ai", b.text); curText = b.text; flush();
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
                if (imgs.children.length) { it.h.imgs = txt.slice(0, 4000); it.card.parentNode.insertBefore(imgs, it.card.nextSibling); scroll(c); }
              }
            }
          } else if (ev.type === "result") {
            flush(); finished = true;
            if (ev.session_id) c.sessions[agent] = ev.session_id;
            const u = ev.usage || {}; const tok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
            const model = Object.keys(ev.modelUsage || {})[0];
            setStatus(c, `Xong · ${Math.round((ev.duration_ms || 0) / 1000)}s` + (ev.num_turns ? ` · ${ev.num_turns} lượt` : "") + (tok ? ` · ${Math.round(tok / 1000)}k token vào, ${u.output_tokens || 0} ra` : "") + (model ? ` · ${model}` : "") + ctxText(c));
            ok = !ev.is_error;
            if (ev.is_error && ev.result) { addMsg(c, "err", ev.result); c.history.push({ role: "err", text: ev.result }); }
          } else if (ev.type === "lnl_error") { flush(); addMsg(c, "err", ev.text); c.history.push({ role: "err", text: ev.text }); setStatus(c, "Lỗi"); }
        }
      }
    } catch (err) { flush(); addMsg(c, "err", String(err.message || err)); setStatus(c, "Lỗi"); }
    clearInterval(tick); flush();
    for (const { h } of cards.values()) if (h.ok == null) h.ok = false;
    if (ok && carry) delete c.carry;
    if (ok && compact && lastAI) {
      // Phiên mới gọn nhẹ: bỏ phiên cũ, tin sau mang theo bản tóm tắt.
      const note = "— Đã tóm gọn. Tin tiếp theo bắt đầu phiên mới, mang theo bản tóm tắt ở trên. —";
      c.carry = lastAI.slice(0, 8000); c.sessions = {}; c.ctx = 0;
      c.history.push({ role: "ai", text: note }); addMsg(c, "ai", note);
      setStatus(c, "Đã tóm gọn — tin sau tốn ít token hơn");
    }
    save(); runs.delete(c.id); syncGo();
    const st = stat.get(c.id) || "";
    const where = tabW ? " · tab " + tabName(tabW) : "";
    if (/đang làm|Đang dừng/.test(st)) setStatus(c, "Đã dừng");
    else notify((ok ? who + " đã xong" : who + " dừng vì lỗi") + where, (lastAI || st).replace(/[#*`>]/g, "").slice(0, 160));
  }
  go.onclick = () => run();
  bCompact.onclick = () => { if (!state.open) setOpen(true); if (!runs.has(conv().id)) run({ compact: true }); };
  bBell.onclick = () => { state.notify = state.notify === false; bBell.classList.toggle("on", state.notify); if (state.notify) askNotify(); save(); status.textContent = state.notify ? "Sẽ báo khi xong (khi bạn ở cửa sổ khác)" : "Đã tắt báo khi xong"; };
  // Workflow ComfyUI chạy xong / lỗi cũng báo
  api.addEventListener("execution_success", () => notify("ComfyUI đã tạo xong", "Workflow vừa chạy xong — mở để xem kết quả."));
  api.addEventListener("execution_error", (e) => notify("ComfyUI bị lỗi", String(e?.detail?.exception_message || "Workflow dừng vì lỗi").slice(0, 160)));

  // Đổi tab workflow → đổi sang cuộc trò chuyện của tab đó (lượt AI ở tab cũ vẫn chạy tiếp).
  const watchTab = async () => {
    const a = wfStore()?.activeWorkflow; const t = a ? tabOf(a) : "";
    if (t === curTab) return;
    curTab = t; hist.classList.remove("show"); show();
    const d = pendingLoad.get(t);
    if (d && a) { pendingLoad.delete(t); try { await loadInto(d.workflow, d, a); lastCanvas.clear(); setTimeout(syncCanvas, 500); setStatus(conv(), "Đã nạp workflow AI sửa khi bạn ở tab khác"); } catch (err) { console.error("[LNL AI] load", err); } }
  };
  setInterval(watchTab, 400);
  { const a = wfStore()?.activeWorkflow; curTab = a ? tabOf(a) : ""; }
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
