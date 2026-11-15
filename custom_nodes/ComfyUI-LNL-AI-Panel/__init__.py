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
Prompt ảnh viết tiếng Anh. Model/custom node mới cài vào thư mục ComfyUI tương ứng."""


def _claude_exe():
    exe = shutil.which("claude")
    if exe:
        return exe
    cand = os.path.join(os.path.expanduser("~"), ".local", "bin", "claude.exe")
    return cand if os.path.exists(cand) else None


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
    return web.json_response({"claude": _claude_exe(), "root": COMFY_ROOT, "running": len(RUNS)})


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
    exe = _claude_exe()
    if not exe:
        return web.json_response({"error": "Không tìm thấy Claude Code (claude.exe). Cài Claude Code rồi thử lại."}, status=500)

    mode = body.get("mode") if body.get("mode") in MODES else "auto"
    args = [exe, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
            "--permission-mode", mode, "--append-system-prompt", SYSTEM_PROMPT]
    sid = body.get("session_id")
    if isinstance(sid, str) and sid.replace("-", "").isalnum():
        args += ["--resume", sid]
    model = body.get("model")
    if isinstance(model, str) and model.replace("-", "").replace(".", "").isalnum():
        args += ["--model", model]

    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
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

    resp = web.StreamResponse(headers={"Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store"})
    await resp.prepare(request)
    try:
        await resp.write((json.dumps({"type": "lnl_run", "run_id": run_id}) + "\n").encode())
        while True:
            line = await q.get()
            if line is None:
                break
            await resp.write(line if line.endswith(b"\n") else line + b"\n")
        rc = await loop.run_in_executor(None, proc.wait)
        if rc != 0:
            tail = b"".join(err_chunks).decode("utf-8", "replace")[-2000:]
            await resp.write((json.dumps({"type": "lnl_error", "code": rc, "text": tail or f"Claude thoát với mã {rc}"}) + "\n").encode())
        await resp.write_eof()
    except (ConnectionResetError, asyncio.CancelledError):
        _kill(proc)
        raise
    finally:
        RUNS.pop(run_id, None)
    return resp
