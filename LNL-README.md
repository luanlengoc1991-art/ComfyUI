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

## Tự mở cùng Windows
- Chuột phải biểu tượng ComfyUI dưới khay → **Tự mở cùng Windows (chạy ngầm)** (mặc định tắt). Khi bật, Windows chạy `ComfyUI.exe --tray`: chỉ bật server, không mở cửa sổ; bấm biểu tượng để mở.

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
- Custom node `custom_nodes/ComfyUI-LNL-AI-Panel`: khung AI ở **bên phải** (như Claude trong Cursor), có thanh dọc riêng: ✨ mở/đóng (**Ctrl+L**), ＋ trò chuyện mới, 🕘 lịch sử. Kéo mép trái để đổi độ rộng; cửa sổ hẹp dưới 900 px thì khung nổi đè lên canvas.
- Chạy Claude Code CLI bằng tài khoản Claude của máy (cùng skill, MCP, quy tắc như trong Cursor), thư mục làm việc là ComfyUI.
- Chọn chế độ quyền (Tự động / Tự sửa file / Toàn quyền / Chỉ lập kế hoạch) và model; "+ Mới" để bắt đầu phiên mới, phiên cũ được nhớ.
- Canvas đang mở được chia sẻ cho AI qua MCP `comfyui_get_canvas`; AI đưa workflow lên canvas bằng `comfyui_load_canvas`.
- Ô trên cùng chọn AI: **Claude Code (tài khoản Claude)** hoặc **Codex (tài khoản ChatGPT)**. Cả hai chỉ chạy bằng đăng nhập của máy (hạn mức gói tháng); khung tự bỏ `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` để không tính tiền theo token. Mỗi AI nhớ phiên riêng; tiếp tục phiên giúp tận dụng cache, tốn ít token hơn.
- Trong ô nhập: chọn AI, **model** (Claude Fable 5.2 / Opus 5.5 / Sonnet 5.5 / Haiku 5.5; Codex lấy từ `~/.codex/models_cache.json`), **mức độ** suy nghĩ, quyền thao tác, và **Gọn/Đầy đủ**. Gọn (mặc định) chỉ nạp MCP comfyui, bỏ hook/skill của máy: một câu hỏi đo được 137k → 68k token vào. Đầy đủ dùng mọi MCP/skill (Vira, Frames, Gmail…). Dán/kéo/📎 ảnh để gửi kèm, ◎ gửi kèm node đang chọn, nhấp đúp câu trả lời để chép, Esc để dừng.
- Lịch sử trò chuyện lưu trên ổ đĩa (`user/lnl-ai/state.json`), không chỉ trong trình duyệt: xoá dữ liệu Edge hay đổi trình duyệt vẫn còn.
- 🗜 **Tóm gọn**: AI tóm tắt cuộc trò chuyện dài, tin sau bắt đầu phiên mới mang theo bản tóm tắt (đo được 102k → 34k token vào). Dòng trạng thái hiện **ngữ cảnh đã dùng**, quá 120k thì nhắc tóm gọn.
- 🔔 **Báo khi xong**: khi bạn đang ở cửa sổ khác, AI làm xong hoặc ComfyUI tạo ảnh xong/lỗi thì có thông báo Windows + tiếng chuông.
- **Tải model bằng lời**: nói "tải model … về loras" → AI dùng tool `comfyui_download_model` (chỉ link https, chỉ thư mục model, đuôi .safetensors/.ckpt/.pt/.pth/.bin/.gguf/.onnx; hỏi trước file > 10 GB), xem tiến độ bằng `comfyui_download_status`.
- Codex CLI 0.169: dùng `--sandbox workspace-write` (bản mới bỏ `--full-auto`) và cho phép sẵn tool MCP comfyui (trừ chế độ Chỉ lập kế hoạch).
- Yêu cầu: đã cài Claude Code (`claude`), với Codex thì `npm i -g @openai/codex` (đăng nhập ChatGPT trong `~/.codex`), và đăng ký MCP `comfyui` (mục ở trên).

## Bộ workflow tiếng Việt
- 5 workflow có sẵn trong menu **Templates** của ComfyUI (nhóm ComfyUI-LNL-AI-Panel): bấm là mở.
- `lnl-workflows/`: tạo ảnh chân thực, xoá nền, đổi nền, phóng to 4x, tạo theo bố cục (ControlNet). Xem `lnl-workflows/README.md`.
- Model nằm ở `C:\LNL-AI-Models\ComfyUI-models` (SSD), `models` là junction trỏ tới đó: lần nạp đầu 343 s → 51 s.
