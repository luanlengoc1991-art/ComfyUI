"""LNL AI Panel — khung ra lệnh AI (Claude Code) ngay trong ComfyUI.

Chạy Claude Code CLI bằng tài khoản của người dùng (cùng skill, MCP, quy tắc như trong Cursor),
stream kết quả về tab "AI" ở thanh bên trái. Canvas đang mở được chia sẻ qua /lnl-ai/canvas
để MCP comfyui đọc/ghi.
"""
import asyncio
import json
import os
import shutil
import subprocess
import threading
import glob
import time
import uuid

from aiohttp import web
from server import PromptServer
import folder_paths

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"

COMFY_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(folder_paths.get_user_directory(), "lnl-ai")
CANVAS_FILE = os.path.join(DATA_DIR, "canvas.json")
MODES = {"auto", "acceptEdits", "bypassPermissions", "plan", "default", "dontAsk"}
RUNS: dict[str, subprocess.Popen] = {}

SYSTEM_PROMPT = f"""Bạn đang chạy trong khung "AI" bên trong app ComfyUI của người dùng (thư mục {COMFY_ROOT}, server http://127.0.0.1:8188).
Người dùng ra lệnh ở đây thay cho Cursor — làm việc y như Claude Code trong Cursor (đọc/sửa file, chạy lệnh, dùng skill và MCP).
Trả lời tiếng Việt, ngắn gọn. Với việc tạo ảnh/workflow dùng MCP "comfyui":
- comfyui_get_canvas: xem workflow đang mở trên canvas (định dạng UI + API).
- comfyui_load_canvas: đưa workflow lên canvas cho người dùng thấy và sửa tiếp.
- comfyui_generate_image / comfyui_run_workflow: chạy và lấy file kết quả (ảnh tự hiện trong khung chat).
- comfyui_list_models, comfyui_status.
- comfyui_download_model: tải model (link https, ví dụ Hugging Face …/resolve/main/<file>) vào đúng thư mục models/<loại>; comfyui_download_status xem tiến độ. Hỏi lại người dùng trước khi tải file trên 10 GB.
Prompt ảnh viết tiếng Anh. Model/custom node mới cài vào thư mục ComfyUI tương ứng."""


def _claude_exe():
    exe = shutil.which("claude")
    if exe:
        return exe
    cand = os.path.join(os.path.expanduser("~"), ".local", "bin", "claude.exe")
    return cand if os.path.exists(cand) else None


def _codex_exe():
    """Codex CLI (đăng nhập ChatGPT). Ưu tiên codex.exe gốc để tránh lỗi trích dẫn của .cmd."""
    roots = [os.path.join(os.environ.get("APPDATA", ""), "npm", "node_modules", "@openai")]
    for r in roots:
        hits = glob.glob(os.path.join(r, "**", "codex.exe"), recursive=True)
        if hits:
            return sorted(hits, key=len)[0]
    return shutil.which("codex")


def _lean_mcp_config():
    """Chế độ Gọn: chỉ nạp MCP comfyui (bỏ các MCP khác của máy) để mỗi câu hỏi tốn ít token hơn."""
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, "mcp-gon.json")
    node = shutil.which("node") or "node"
    cfg = {"mcpServers": {"comfyui": {"command": node, "args": [os.path.join(COMFY_ROOT, "mcp", "comfyui-mcp.mjs")]}}}
    text = json.dumps(cfg, ensure_ascii=False, indent=1)
    try:
        with open(path, encoding="utf-8") as f:
            if f.read() == text:
                return path
    except OSError:
        pass
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return path


def _account_env():
    """Chỉ dùng tài khoản đăng nhập của máy (hạn mức tháng Claude / ChatGPT), không dùng API key tính tiền theo token."""
    env = dict(os.environ)
    for k in ("PYTHONPATH", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY"):
        env.pop(k, None)
    return env


def _codex_to_claude(ev: dict, started: float):
    """Đổi sự kiện `codex exec --json` sang dạng sự kiện Claude mà giao diện đã hiểu."""
    t = ev.get("type")
    if t == "thread.started":
        return [{"type": "system", "session_id": ev.get("thread_id")}]
    item = ev.get("item") or {}
    it = item.get("type")
    if t == "item.started" and it == "command_execution":
        return [{"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "shell", "input": {"command": item.get("command")}}]}}]
    if t == "item.started" and it == "mcp_tool_call":
        return [{"type": "assistant", "message": {"content": [{"type": "tool_use", "name": f"{item.get('server')}.{item.get('tool')}", "input": item.get("arguments") or {}}]}}]
    if t == "item.started" and it == "file_change":
        return [{"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "edit", "input": {"files": [c.get("path") for c in item.get("changes") or []]}}]}}]
    if t == "item.completed" and it == "mcp_tool_call":
        res = item.get("result") or {}
        text = "\n".join(c.get("text", "") for c in res.get("content") or [] if isinstance(c, dict))
        return [{"type": "user", "message": {"content": [{"type": "tool_result", "content": text}]}}]
    if t == "item.completed" and it == "agent_message":
        return [{"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": item.get("text", "")}}},
                {"type": "stream_event", "event": {"type": "message_stop"}}]
    if t == "turn.completed":
        return [{"type": "result", "duration_ms": int((time.time() - started) * 1000), "usage": ev.get("usage")}]
    if t in ("turn.failed", "error"):
        msg = (ev.get("error") or {}).get("message") if t == "turn.failed" else ev.get("message")
        return [{"type": "lnl_error", "text": msg or "Codex lỗi"}]
    return []


def _guard(request: web.Request):
    # Header riêng buộc trình duyệt preflight → trang web lạ không gọi được (không có CORS).
    if request.headers.get("X-LNL-AI") != "1":
        raise web.HTTPForbidden(text="forbidden")


def _kill(proc: subprocess.Popen):
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            proc.kill()
    except Exception:
        pass


routes = PromptServer.instance.routes


@routes.get("/lnl-ai/info")
async def info(request):
    _guard(request)
    return web.json_response({"claude": _claude_exe(), "codex": _codex_exe(), "root": COMFY_ROOT, "running": len(RUNS)})


CLAUDE_MODELS = [
    {"id": "", "name": "Mặc định của Claude Code"},
    {"id": "claude-fable-5-2", "name": "Claude Fable 5.2"},
    {"id": "claude-opus-5-5", "name": "Claude Opus 5.5"},
    {"id": "claude-sonnet-5-5", "name": "Claude Sonnet 5.5"},
    {"id": "claude-haiku-5-5", "name": "Claude Haiku 5.5"},
]
CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"]
EFFORTS = {"minimal", "low", "medium", "high", "xhigh", "max", "ultra"}
UPLOAD_DIR = os.path.join(COMFY_ROOT, "input", "lnl-ai")
IMG_EXT = {"png", "jpg", "jpeg", "webp", "gif"}


def _codex_models():
    """Danh sách model Codex lấy từ bộ nhớ đệm của Codex CLI (~/.codex/models_cache.json)."""
    path = os.path.join(os.path.expanduser("~"), ".codex", "models_cache.json")
    out = [{"id": "", "name": "Mặc định của Codex", "efforts": []}]
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for m in data.get("models", []):
            if m.get("visibility") != "list" or not m.get("slug"):
                continue
            efforts = [e.get("effort") for e in m.get("supported_reasoning_levels", []) if e.get("effort")]
            out.append({"id": m["slug"], "name": m.get("display_name") or m["slug"], "efforts": efforts,
                        "default_effort": m.get("default_reasoning_level")})
    except (OSError, ValueError):
        pass
    return out


@routes.get("/lnl-ai/models")
async def models(request):
    _guard(request)
    claude = [dict(m, efforts=CLAUDE_EFFORTS) for m in CLAUDE_MODELS]
    return web.json_response({"claude": claude, "codex": _codex_models(),
                              "have": {"claude": bool(_claude_exe()), "codex": bool(_codex_exe())}})


@routes.post("/lnl-ai/upload")
async def upload(request):
    """Ảnh dán/kéo vào khung chat: lưu vào input/lnl-ai để AI đọc được và node LoadImage dùng được."""
    _guard(request)
    reader = await request.multipart()
    part = await reader.next()
    if part is None or part.name != "file":
        return web.json_response({"error": "Thiếu file"}, status=400)
    name = os.path.basename(part.filename or "anh.png")
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "png"
    if ext not in IMG_EXT:
        return web.json_response({"error": "Chỉ nhận ảnh png/jpg/webp/gif"}, status=400)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    fname = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6] + "." + ext
    full = os.path.join(UPLOAD_DIR, fname)
    size = 0
    with open(full, "wb") as f:
        while True:
            chunk = await part.read_chunk(1 << 16)
            if not chunk:
                break
            size += len(chunk)
            if size > 30 * 1024 * 1024:
                f.close()
                os.remove(full)
                return web.json_response({"error": "Ảnh quá lớn (tối đa 30 MB)"}, status=413)
            f.write(chunk)
    return web.json_response({"path": full, "name": "lnl-ai/" + fname})


STATE_FILE = os.path.join(DATA_DIR, "state.json")
STATE_LOCK = threading.Lock()


@routes.get("/lnl-ai/state")
async def get_state(request):
    """Lịch sử trò chuyện và lựa chọn của khung AI, lưu trên ổ đĩa (không mất khi xoá dữ liệu trình duyệt)."""
    _guard(request)
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return web.json_response(json.load(f))
    except (OSError, ValueError):
        return web.json_response({})


@routes.post("/lnl-ai/state")
async def put_state(request):
    _guard(request)
    data = await request.json()
    if not isinstance(data, dict) or not isinstance(data.get("convs"), list):
        return web.json_response({"error": "Sai dữ liệu"}, status=400)
    text = json.dumps(data, ensure_ascii=False)
    if len(text) > 20 * 1024 * 1024:
        return web.json_response({"error": "Lịch sử quá lớn"}, status=413)
    os.makedirs(DATA_DIR, exist_ok=True)
    with STATE_LOCK:
        tmp = STATE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, STATE_FILE)
    return web.json_response({"ok": True})


# ---------- Tải model (AI hoặc người dùng ra lệnh) ----------
MODEL_FOLDERS = {"checkpoints", "loras", "vae", "controlnet", "upscale_models", "clip", "clip_vision", "text_encoders",
                 "diffusion_models", "unet", "embeddings", "background_removal", "ipadapter", "style_models"}
DOWNLOADS: dict[str, dict] = {}


def _download_worker(job: dict):
    import urllib.request
    tmp = job["path"] + ".part"
    try:
        req = urllib.request.Request(job["url"], headers={"User-Agent": "LNL-ComfyUI"})
        with urllib.request.urlopen(req, timeout=60) as res, open(tmp, "wb") as out:
            job["total"] = int(res.headers.get("Content-Length") or 0)
            while True:
                if job.get("cancel"):
                    raise RuntimeError("Đã huỷ")
                chunk = res.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
                job["done"] += len(chunk)
        os.replace(tmp, job["path"])
        job["state"] = "done"
    except Exception as e:  # noqa: BLE001 — báo lỗi cho người dùng, không làm sập server
        job["state"] = "error"
        job["error"] = str(e)
        try:
            os.remove(tmp)
        except OSError:
            pass


@routes.post("/lnl-ai/download")
async def download_model(request):
    _guard(request)
    data = await request.json()
    url = str(data.get("url") or "")
    folder = str(data.get("folder") or "")
    if not url.startswith("https://"):
        return web.json_response({"error": "Chỉ nhận link https"}, status=400)
    if folder not in MODEL_FOLDERS:
        return web.json_response({"error": "Thư mục model không hợp lệ", "folders": sorted(MODEL_FOLDERS)}, status=400)
    name = os.path.basename(str(data.get("filename") or url.split("?")[0].rstrip("/").split("/")[-1]))
    if not name or name.startswith(".") or not name.lower().endswith((".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf", ".onnx")):
        return web.json_response({"error": "Tên file model không hợp lệ (cần .safetensors/.ckpt/.pt/.pth/.bin/.gguf/.onnx)"}, status=400)
    base = os.path.join(COMFY_ROOT, "models", folder)
    os.makedirs(base, exist_ok=True)
    path = os.path.join(base, name)
    if os.path.exists(path):
        return web.json_response({"ok": True, "exists": True, "path": path})
    for j in DOWNLOADS.values():
        if j["path"] == path and j["state"] == "running":
            return web.json_response({"ok": True, "id": j["id"], "running": True})
    jid = uuid.uuid4().hex[:10]
    job = {"id": jid, "url": url, "folder": folder, "name": name, "path": path, "done": 0, "total": 0,
           "state": "running", "error": "", "at": time.time()}
    DOWNLOADS[jid] = job
    threading.Thread(target=_download_worker, args=(job,), daemon=True).start()
    return web.json_response({"ok": True, "id": jid})


@routes.get("/lnl-ai/downloads")
async def list_downloads(request):
    _guard(request)
    return web.json_response([{k: v for k, v in j.items() if k != "cancel"} for j in DOWNLOADS.values()])


@routes.post("/lnl-ai/download/cancel")
async def cancel_download(request):
    _guard(request)
    data = await request.json()
    job = DOWNLOADS.get(str(data.get("id") or ""))
    if job:
        job["cancel"] = True
    return web.json_response({"ok": bool(job)})


@routes.post("/lnl-ai/canvas")
async def save_canvas(request):
    _guard(request)
    data = await request.json()
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CANVAS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return web.json_response({"ok": True})


@routes.get("/lnl-ai/canvas")
async def get_canvas(request):
    _guard(request)
    if not os.path.exists(CANVAS_FILE):
        return web.json_response({"error": "Chưa có canvas (mở ComfyUI trong trình duyệt/app trước)"}, status=404)
    with open(CANVAS_FILE, encoding="utf-8") as f:
        return web.json_response(json.load(f))


@routes.post("/lnl-ai/canvas/load")
async def load_canvas(request):
    _guard(request)
    data = await request.json()
    wf = data.get("workflow")
    if not isinstance(wf, dict):
        return web.json_response({"error": "Thiếu workflow (object)"}, status=400)
    PromptServer.instance.send_sync("lnl-ai.load", {"workflow": wf, "name": data.get("name") or "AI workflow"})
    return web.json_response({"ok": True, "clients": len(PromptServer.instance.sockets)})


@routes.post("/lnl-ai/stop")
async def stop(request):
    _guard(request)
    data = await request.json()
    proc = RUNS.get(data.get("run_id", ""))
    if proc:
        _kill(proc)
    return web.json_response({"ok": bool(proc)})


@routes.post("/lnl-ai/chat")
async def chat(request):
    _guard(request)
    body = await request.json()
    message = (body.get("message") or "").strip()
    if not message:
        return web.json_response({"error": "Thiếu nội dung"}, status=400)
    agent = "codex" if body.get("agent") == "codex" else "claude"
    sid = body.get("session_id")
    sid = sid if isinstance(sid, str) and sid.replace("-", "").isalnum() else None
    model = body.get("model")
    model = model if isinstance(model, str) and model.replace("-", "").replace(".", "").isalnum() else None
    mode = body.get("mode") if body.get("mode") in MODES else "auto"
    effort = body.get("effort") if body.get("effort") in EFFORTS else None
    lean = body.get("tools") != "full"
    images = [p for p in (body.get("images") or []) if isinstance(p, str)
              and os.path.abspath(p).startswith(os.path.abspath(UPLOAD_DIR) + os.sep) and os.path.isfile(p)][:8]
    if images:
        message += "\n\n[Ảnh đính kèm — đọc bằng công cụ Read:]\n" + "\n".join(images)

    if agent == "claude":
        exe = _claude_exe()
        if not exe:
            return web.json_response({"error": "Không tìm thấy Claude Code (claude.exe). Cài Claude Code rồi thử lại."}, status=500)
        args = [exe, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
                "--permission-mode", mode, "--append-system-prompt", SYSTEM_PROMPT,
                "--exclude-dynamic-system-prompt-sections"]  # phần đầu giống nhau giữa các phiên → đọc lại từ cache
        if lean:
            # Gọn: chỉ MCP comfyui, bỏ hook/plugin/skill của máy (~80k → ~50k token mỗi câu, nhanh gấp đôi).
            args += ["--strict-mcp-config", "--mcp-config", _lean_mcp_config(), "--setting-sources", "project,local"]
        if sid:
            args += ["--resume", sid]
        if model:
            args += ["--model", model]
        if effort in CLAUDE_EFFORTS:
            args += ["--effort", effort]
    else:
        exe = _codex_exe()
        if not exe:
            return web.json_response({"error": "Chưa cài Codex CLI. Chạy: npm i -g @openai/codex (đăng nhập ChatGPT đã có sẵn trong ~/.codex)."}, status=500)
        args = [exe, "exec", "--json", "--skip-git-repo-check", "-C", COMFY_ROOT]
        if mode == "bypassPermissions":
            args += ["--dangerously-bypass-approvals-and-sandbox"]
        elif mode == "plan":
            args += ["--sandbox", "read-only"]
        else:
            args += ["--sandbox", "workspace-write"]  # Codex 0.169 bỏ --full-auto
        if model:
            args += ["-m", model]
        if effort:
            args += ["-c", f"model_reasoning_effort={effort}"]
        for p in images:
            args += [f"--image={p}"]  # dạng "=" để "-" (stdin) phía sau không bị coi là ảnh
        if sid:
            args += ["resume", sid]
        else:
            message = SYSTEM_PROMPT.replace("Claude Code", "Codex") + "\n\n---\n" + message
        args += ["-"]

    env = _account_env()
    proc = subprocess.Popen(args, cwd=COMFY_ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, env=env,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    run_id = uuid.uuid4().hex
    RUNS[run_id] = proc
    proc.stdin.write(message.encode("utf-8"))
    proc.stdin.close()

    loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue()
    err_chunks: list[bytes] = []

    def pump_out():
        for line in proc.stdout:
            loop.call_soon_threadsafe(q.put_nowait, line)
        loop.call_soon_threadsafe(q.put_nowait, None)

    def pump_err():
        for line in proc.stderr:
            err_chunks.append(line)

    threading.Thread(target=pump_out, daemon=True).start()
    threading.Thread(target=pump_err, daemon=True).start()

    started = time.time()
    codex_sid = sid
    resp = web.StreamResponse(headers={"Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store"})
    await resp.prepare(request)
    try:
        await resp.write((json.dumps({"type": "lnl_run", "run_id": run_id}) + "\n").encode())
        while True:
            line = await q.get()
            if line is None:
                break
            if agent == "codex":
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                for out in _codex_to_claude(ev, started):
                    if out["type"] == "system":
                        codex_sid = out.get("session_id") or codex_sid
                    elif out["type"] == "result":
                        out["session_id"] = codex_sid
                    await resp.write((json.dumps(out, ensure_ascii=False) + "\n").encode("utf-8"))
                continue
            await resp.write(line if line.endswith(b"\n") else line + b"\n")
        rc = await loop.run_in_executor(None, proc.wait)
        if rc != 0:
            tail = b"".join(err_chunks).decode("utf-8", "replace")[-2000:]
            await resp.write((json.dumps({"type": "lnl_error", "code": rc, "text": tail or f"{agent} thoát với mã {rc}"}) + "\n").encode())
        await resp.write_eof()
    except (ConnectionResetError, asyncio.CancelledError):
        _kill(proc)
        raise
    finally:
        RUNS.pop(run_id, None)
    return resp
