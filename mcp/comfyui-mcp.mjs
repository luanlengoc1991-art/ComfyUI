#!/usr/bin/env node
// ComfyUI MCP server (stdio, không cần thư viện ngoài) — cho Claude Code / Codex ra lệnh tạo ảnh.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.COMFYUI_ROOT || path.resolve(HERE, '..');
const URL_BASE = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const EXE = path.join(ROOT, 'ComfyUI.exe');
const OUT = path.join(ROOT, 'output');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, init) {
  const res = await fetch(URL_BASE + p, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`ComfyUI ${p} → ${res.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : null;
}

async function isUp() {
  try { await api('/system_stats', { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; }
}

async function ensureUp() {
  if (await isUp()) return;
  if (!existsSync(EXE)) throw new Error(`ComfyUI chưa chạy và không thấy ${EXE}`);
  spawn(EXE, [], { detached: true, stdio: 'ignore', cwd: ROOT }).unref();
  for (let i = 0; i < 180; i++) { await sleep(1000); if (await isUp()) return; }
  throw new Error('ComfyUI không khởi động được trong 3 phút (xem ComfyUI\\user\\comfyui-launcher.log)');
}

async function listModels(kind) {
  try { return await api(`/models/${kind}`); } catch { return []; }
}

async function pickCheckpoint(name) {
  const ckpts = await listModels('checkpoints');
  if (!ckpts.length) throw new Error('Chưa có model nào trong ComfyUI\\models\\checkpoints');
  if (!name) return ckpts.find((c) => /juggernaut/i.test(c)) || ckpts[0];
  const hit = ckpts.find((c) => c === name) || ckpts.find((c) => c.toLowerCase().includes(name.toLowerCase()));
  if (!hit) throw new Error(`Không có checkpoint "${name}". Có: ${ckpts.join(', ')}`);
  return hit;
}

async function runPrompt(workflow, timeoutSec = 900) {
  const { prompt_id, node_errors } = await api('/prompt', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: 'comfyui-mcp' }),
  });
  if (node_errors && Object.keys(node_errors).length) throw new Error('Workflow lỗi: ' + JSON.stringify(node_errors).slice(0, 1500));
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutSec * 1000) {
    await sleep(1000);
    const h = await api(`/history/${prompt_id}`);
    const item = h?.[prompt_id];
    if (!item) continue;
    if (item.status?.status_str === 'error') {
      const msgs = item.status.messages || [];
      const err = msgs.find((m) => m[0] === 'execution_error');
      if (err) throw new Error(`ComfyUI lỗi: ${err[1].node_type}: ${err[1].exception_message}`);
      if (msgs.some((m) => m[0] === 'execution_interrupted')) { const e = new Error('ComfyUI: lượt chạy bị ngắt (có người bấm Cancel/Interrupt trong giao diện)'); e.interrupted = true; throw e; }
      throw new Error('ComfyUI lỗi: không rõ');
    }
    const files = [];
    for (const out of Object.values(item.outputs || {})) {
      for (const k of ['images', 'gifs', 'videos', 'audio']) {
        for (const f of out[k] || []) {
          if (f.type !== 'output') continue;
          files.push(path.join(OUT, f.subfolder || '', f.filename));
        }
      }
    }
    return { prompt_id, seconds: Math.round((Date.now() - t0) / 1000), files };
  }
  throw new Error(`Quá ${timeoutSec}s chưa xong (prompt_id ${prompt_id}); xem lại bằng comfyui_status`);
}

function txt2imgWorkflow(a, ckpt) {
  const seed = Number.isInteger(a.seed) ? a.seed : Math.floor(Math.random() * 2 ** 48);
  const wf = {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: a.width ?? 1024, height: a.height ?? 1024, batch_size: Math.min(Math.max(a.count ?? 1, 1), 4) } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: a.prompt, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: a.negative_prompt ?? 'blurry, deformed, lowres, bad anatomy, extra fingers, watermark, text, logo', clip: ['4', 1] } },
    3: { class_type: 'KSampler', inputs: { seed, steps: a.steps ?? 30, cfg: a.cfg ?? 4.5, sampler_name: a.sampler ?? 'dpmpp_2m', scheduler: a.scheduler ?? 'karras', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: a.filename_prefix ?? 'mcp', images: ['8', 0] } },
  };
  let model = ['4', 0], clip = ['4', 1];
  (a.loras || []).forEach((l, i) => {
    const id = String(100 + i);
    wf[id] = { class_type: 'LoraLoader', inputs: { lora_name: l.name, strength_model: l.strength ?? 0.8, strength_clip: l.strength ?? 0.8, model, clip } };
    model = [id, 0]; clip = [id, 1];
  });
  wf[3].inputs.model = model; wf[6].inputs.clip = clip; wf[7].inputs.clip = clip;
  return { wf, seed };
}

function imageContent(file) {
  try {
    const buf = readFileSync(file);
    if (buf.length > 4 * 1024 * 1024) return null;
    return { type: 'image', data: buf.toString('base64'), mimeType: 'image/png' };
  } catch { return null; }
}

const TOOLS = [
  {
    name: 'comfyui_generate_image',
    description: 'Tạo ảnh bằng ComfyUI trên máy (GPU RTX 3060 Ti). Prompt nên viết tiếng Anh. Mặc định model Juggernaut XL (ảnh chân thực), 1024x1024, 30 bước, CFG 4.5. Tự mở ComfyUI nếu chưa chạy. Trả về đường dẫn file PNG trong ComfyUI\\output.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Mô tả ảnh (tiếng Anh)' },
        negative_prompt: { type: 'string' },
        width: { type: 'integer', default: 1024 }, height: { type: 'integer', default: 1024 },
        steps: { type: 'integer', default: 30 }, cfg: { type: 'number', default: 4.5 },
        seed: { type: 'integer' }, count: { type: 'integer', default: 1, description: '1–4 ảnh' },
        checkpoint: { type: 'string', description: 'Tên (hoặc một phần tên) checkpoint; bỏ trống = Juggernaut' },
        sampler: { type: 'string', default: 'dpmpp_2m' }, scheduler: { type: 'string', default: 'karras' },
        loras: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, strength: { type: 'number' } }, required: ['name'] } },
        filename_prefix: { type: 'string', default: 'mcp' },
        return_image: { type: 'boolean', default: true, description: 'Gửi kèm ảnh để AI xem' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'comfyui_run_workflow',
    description: 'Chạy một workflow ComfyUI dạng API (JSON "Export (API)") và chờ kết quả. Trả về các file đầu ra.',
    inputSchema: { type: 'object', properties: { workflow: { type: 'object', description: 'Workflow API format: {"<node id>": {"class_type": ..., "inputs": {...}}}' }, timeout_sec: { type: 'integer', default: 900 } }, required: ['workflow'] },
  },
  {
    name: 'comfyui_list_models',
    description: 'Liệt kê model đã cài (checkpoints, loras, vae, upscale_models, controlnet...).',
    inputSchema: { type: 'object', properties: { kind: { type: 'string', description: 'Bỏ trống để xem các loại chính' } } },
  },
  {
    name: 'comfyui_status',
    description: 'Trạng thái ComfyUI: đang chạy chưa, GPU/VRAM, hàng đợi.',
    inputSchema: { type: 'object', properties: { start: { type: 'boolean', description: 'Mở ComfyUI nếu chưa chạy' } } },
  },
];

async function callTool(name, a = {}) {
  if (name === 'comfyui_status') {
    if (a.start) await ensureUp();
    if (!(await isUp())) return { text: 'ComfyUI chưa chạy. Gọi lại với start=true hoặc mở ComfyUI.exe.' };
    const [s, q] = await Promise.all([api('/system_stats'), api('/queue')]);
    const d = s.devices?.[0];
    return { text: JSON.stringify({ running: true, version: s.system?.comfyui_version, gpu: d?.name, vram_free_gb: d && +(d.vram_free / 2 ** 30).toFixed(2), vram_total_gb: d && +(d.vram_total / 2 ** 30).toFixed(2), queue_running: q.queue_running?.length, queue_pending: q.queue_pending?.length, root: ROOT }, null, 2) };
  }
  await ensureUp();
  if (name === 'comfyui_list_models') {
    const kinds = a.kind ? [a.kind] : ['checkpoints', 'loras', 'vae', 'upscale_models', 'controlnet', 'diffusion_models', 'text_encoders'];
    const out = {};
    for (const k of kinds) out[k] = await listModels(k);
    return { text: JSON.stringify(out, null, 2) };
  }
  if (name === 'comfyui_generate_image') {
    if (!a.prompt) throw new Error('Thiếu prompt');
    const ckpt = await pickCheckpoint(a.checkpoint);
    const { wf, seed } = txt2imgWorkflow(a, ckpt);
    let r;
    try { r = await runPrompt(wf); } catch (e) { if (!e.interrupted) throw e; r = await runPrompt(wf); }
    const extra = a.return_image === false ? [] : r.files.slice(0, 2).map(imageContent).filter(Boolean);
    return { text: JSON.stringify({ files: r.files, seconds: r.seconds, seed, checkpoint: ckpt }, null, 2), extra };
  }
  if (name === 'comfyui_run_workflow') {
    const r = await runPrompt(a.workflow, a.timeout_sec ?? 900);
    return { text: JSON.stringify(r, null, 2) };
  }
  throw new Error(`Không có tool ${name}`);
}

// --- JSON-RPC over stdio ---
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notification
  try {
    if (method === 'initialize') {
      return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'comfyui', version: '1.0.0' }, instructions: 'ComfyUI chạy trên máy người dùng (D:\\CLAUDE CURSO WEBSITE LUAN\\ComfyUI). Dùng comfyui_generate_image để tạo ảnh; prompt tiếng Anh; ảnh lưu ở ComfyUI\\output.' } });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      try {
        const r = await callTool(params.name, params.arguments || {});
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.text }, ...(r.extra || [])] } });
      } catch (e) {
        return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: String(e?.message || e) }] } });
      }
    }
    if (method === 'resources/list') return send({ jsonrpc: '2.0', id, result: { resources: [] } });
    if (method === 'prompts/list') return send({ jsonrpc: '2.0', id, result: { prompts: [] } });
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e?.message || e) } });
  }
});
