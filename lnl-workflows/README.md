# Bộ workflow tiếng Việt (LNL)

Kéo thả file `.json` vào cửa sổ ComfyUI (hoặc nhờ khung AI ✨ "mở workflow 03-doi-nen"). Tên các khối đã đặt tiếng Việt.
Đổi ảnh ở khối **LoadImage** (ảnh mẫu đặt trong `input/`), đổi mô tả ở khối **Mô tả ảnh (tiếng Anh)**.

| File | Việc làm | Model cần | Thời gian đo (RTX 3060 Ti 8 GB) |
|---|---|---|---|
| `01-tao-anh-chan-thuc.json` | Tạo ảnh chân thực 9:16 từ mô tả | Juggernaut XL v9 | ~32 s/ảnh (model đã nạp) |
| `02-xoa-nen.json` | Xoá nền, lưu PNG nền trong suốt | BiRefNet | ~16 s (ảnh 5504×3072) |
| `03-doi-nen.json` | Tách nhân vật, tạo nền mới bằng AI rồi ghép vào | Juggernaut + BiRefNet | ~2–3 phút |
| `04-phong-to-4x.json` | Phóng to 4 lần cho nét (ảnh vào tự giới hạn ~2 MP) | Real-ESRGAN x4plus | ~29 s |
| `05-tao-theo-bo-cuc.json` | Tạo ảnh mới giữ bố cục / tư thế của ảnh mẫu | Juggernaut + ControlNet Union SDXL | ~1–4 phút |

Ảnh ra nằm trong `output/lnl/`.

## Model (đặt trong `models/`)

- `checkpoints/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors` — https://huggingface.co/RunDiffusion/Juggernaut-XL-v9
- `background_removal/birefnet.safetensors` — https://huggingface.co/Comfy-Org/BiRefNet
- `upscale_models/RealESRGAN_x4plus.safetensors` — https://huggingface.co/Comfy-Org/Real-ESRGAN_repackaged
- `controlnet/controlnet-union-sdxl-promax.safetensors` — https://huggingface.co/xinsir/controlnet-union-sdxl-1.0 (file `diffusion_pytorch_model_promax.safetensors`)

Workflow 05 dùng kiểu điều khiển `canny/lineart` (bám viền). Đổi sang `depth` hoặc `openpose` ở khối **Kiểu điều khiển** khi đã có ảnh độ sâu / khung xương.
