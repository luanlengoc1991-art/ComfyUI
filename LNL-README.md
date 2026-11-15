# ComfyUI — bản của luanlengoc1991-art

Fork từ [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI), thêm:

- `ComfyUI.exe` (nguồn `launcher/ComfyUILauncher.cs`): mở ComfyUI như app — chạy server ẩn, mở cửa sổ riêng, icon khay hệ thống (Thoát = tắt server).
  Cờ: `--port 8188 --windows-standalone-build --disable-auto-launch --enable-manager --disable-fast-disk`
  (`--disable-fast-disk` tránh lỗi `hostbuf_file_reader_read failed` khi nạp model).
- `mcp/comfyui-mcp.mjs`: MCP server (stdio, không cần thư viện) để Claude Code / Codex ra lệnh:
  `comfyui_generate_image`, `comfyui_run_workflow`, `comfyui_list_models`, `comfyui_status`.
- `CHAY-COMFYUI.bat`: chạy dạng cửa sổ dòng lệnh.

## Cài trên máy mới (Windows, GPU NVIDIA)

```powershell
py -3.13 -m venv venv
venv\Scripts\pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
venv\Scripts\pip install -r requirements.txt -r manager_requirements.txt
```

Model ảnh chân thực (đặt vào `models\checkpoints`):
`Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors` — https://huggingface.co/RunDiffusion/Juggernaut-XL-v9

## Build lại ComfyUI.exe

```powershell
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /codepage:65001 /optimize `
  /win32icon:launcher\comfyui.ico /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  /out:ComfyUI.exe launcher\ComfyUILauncher.cs
```

## Gắn MCP

```powershell
claude mcp add comfyui --scope user -- node "<thư mục>\mcp\comfyui-mcp.mjs"
```

Codex (`%USERPROFILE%\.codex\config.toml`):

```toml
[mcp_servers.comfyui]
command = 'C:\Program Files\nodejs\node.exe'
args = ['<thư mục>\mcp\comfyui-mcp.mjs']
startup_timeout_sec = 30
tool_timeout_sec = 900
```

## Cập nhật từ bản gốc

```powershell
git fetch upstream; git merge upstream/master; git push
```

## Khung "AI" trong ComfyUI (ra lệnh Claude Code ngay trong app)
- Custom node `custom_nodes/ComfyUI-LNL-AI-Panel`: tab **AI** (biểu tượng ✨) ở thanh bên trái.
- Chạy Claude Code CLI bằng tài khoản Claude của máy (cùng skill, MCP, quy tắc như trong Cursor), thư mục làm việc là ComfyUI.
- Chọn chế độ quyền (Tự động / Tự sửa file / Toàn quyền / Chỉ lập kế hoạch) và model; "+ Mới" để bắt đầu phiên mới, phiên cũ được nhớ.
- Canvas đang mở được chia sẻ cho AI qua MCP `comfyui_get_canvas`; AI đưa workflow lên canvas bằng `comfyui_load_canvas`.
- Yêu cầu: đã cài Claude Code (`claude`) và đăng ký MCP `comfyui` (mục ở trên).
