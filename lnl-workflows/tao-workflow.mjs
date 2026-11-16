// Tạo bộ workflow tiếng Việt (định dạng API) cho ComfyUI và chạy thử từng cái.
import fs from 'node:fs';
const ROOT = 'D:/CLAUDE CURSO WEBSITE LUAN/ComfyUI/';
const OUT = ROOT + 'lnl-workflows/';
fs.mkdirSync(OUT, { recursive: true });
const CK = 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors';
const NEG = 'blurry, lowres, deformed, extra fingers, text, watermark, logo, plastic skin, cartoon';
const n = (t, cls, inputs) => ({ class_type: cls, inputs, _meta: { title: t } });
const IMG = 'lnl-mau-nhanvat.jpg';

const base = (pos) => ({
  ck: n('Model ảnh chân thực', 'CheckpointLoaderSimple', { ckpt_name: CK }),
  pos: n('Mô tả ảnh (tiếng Anh)', 'CLIPTextEncode', { text: pos, clip: ['ck', 1] }),
  neg: n('Không muốn có', 'CLIPTextEncode', { text: NEG, clip: ['ck', 1] }),
});
const sampler = (latent, pos = ['pos', 0], neg = ['neg', 0], seed = 7, denoise = 1) =>
  n('Tạo ảnh', 'KSampler', { seed, steps: 28, cfg: 5, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise, model: ['ck', 0], positive: pos, negative: neg, latent_image: latent });

const WF = {
  '01-tao-anh-chan-thuc': {
    ...base('photo of a young asian woman in a modern cafe, natural light, realistic skin, 85mm, sharp focus, 4k'),
    lat: n('Khung ảnh 9:16', 'EmptyLatentImage', { width: 832, height: 1216, batch_size: 1 }),
    ks: sampler(['lat', 0]),
    dec: n('Giải mã ảnh', 'VAEDecode', { samples: ['ks', 0], vae: ['ck', 2] }),
    save: n('Lưu ảnh', 'SaveImage', { filename_prefix: 'lnl/tao-anh', images: ['dec', 0] }),
  },
  '02-xoa-nen': {
    img: n('Ảnh cần xoá nền', 'LoadImage', { image: IMG }),
    bgm: n('Model xoá nền (BiRefNet)', 'LoadBackgroundRemovalModel', { bg_removal_name: 'birefnet.safetensors' }),
    rm: n('Tách chủ thể', 'RemoveBackground', { bg_removal_model: ['bgm', 0], image: ['img', 0] }),
    inv: n('Đảo vùng chọn', 'InvertMask', { mask: ['rm', 0] }),
    join: n('Ghép nền trong suốt', 'JoinImageWithAlpha', { image: ['img', 0], alpha: ['inv', 0] }),
    save: n('Lưu PNG nền trong suốt', 'SaveImage', { filename_prefix: 'lnl/xoa-nen', images: ['join', 0] }),
  },
  '03-doi-nen': {
    ...base('luxury apartment living room, warm evening light, realistic interior photo, depth of field, 4k'),
    img: n('Ảnh nhân vật', 'LoadImage', { image: IMG }),
    size: n('Kích thước ảnh gốc', 'GetImageSize', { image: ['img', 0] }),
    lat: n('Khung nền mới', 'EmptyLatentImage', { width: 832, height: 1216, batch_size: 1 }),
    ks: sampler(['lat', 0]),
    dec: n('Nền mới', 'VAEDecode', { samples: ['ks', 0], vae: ['ck', 2] }),
    fit: n('Khớp cỡ nền với ảnh gốc', 'ImageScale', { image: ['dec', 0], upscale_method: 'bicubic', width: ['size', 0], height: ['size', 1], crop: 'center' }),
    bgm: n('Model xoá nền (BiRefNet)', 'LoadBackgroundRemovalModel', { bg_removal_name: 'birefnet.safetensors' }),
    rm: n('Tách nhân vật', 'RemoveBackground', { bg_removal_model: ['bgm', 0], image: ['img', 0] }),
    comp: n('Đặt nhân vật lên nền mới', 'ImageCompositeMasked', { destination: ['fit', 0], source: ['img', 0], x: 0, y: 0, resize_source: false, mask: ['rm', 0] }),
    save: n('Lưu ảnh đổi nền', 'SaveImage', { filename_prefix: 'lnl/doi-nen', images: ['comp', 0] }),
  },
  '04-phong-to-4x': {
    img: n('Ảnh cần phóng to', 'LoadImage', { image: IMG }),
    um: n('Model phóng to 4x (Real-ESRGAN)', 'UpscaleModelLoader', { model_name: 'RealESRGAN_x4plus.safetensors' }),
    cap: n('Giới hạn ảnh vào ~2MP (ảnh quá to sẽ rất chậm)', 'ImageScaleToTotalPixels', { image: ['img', 0], upscale_method: 'lanczos', megapixels: 2, resolution_steps: 1 }),
    up: n('Phóng to 4 lần', 'ImageUpscaleWithModel', { upscale_model: ['um', 0], image: ['cap', 0] }),
    save: n('Lưu ảnh nét', 'SaveImage', { filename_prefix: 'lnl/phong-to', images: ['up', 0] }),
  },
  '05-tao-theo-bo-cuc': {
    ...base('photo of a young asian woman in elegant white dress, sunny garden, realistic skin, 4k'),
    img: n('Ảnh mẫu bố cục / tư thế', 'LoadImage', { image: IMG }),
    sm: n('Thu nhỏ ảnh mẫu', 'ImageScale', { image: ['img', 0], upscale_method: 'bicubic', width: 832, height: 1216, crop: 'center' }),
    edge: n('Lấy nét viền', 'Canny', { image: ['sm', 0], low_threshold: 0.3, high_threshold: 0.7 }),
    cn: n('ControlNet Union SDXL', 'ControlNetLoader', { control_net_name: 'controlnet-union-sdxl-promax.safetensors' }),
    cnt: n('Kiểu điều khiển', 'SetUnionControlNetType', { control_net: ['cn', 0], type: 'canny/lineart/anime_lineart/mlsd' }),
    apply: n('Bám bố cục ảnh mẫu', 'ControlNetApplyAdvanced', { positive: ['pos', 0], negative: ['neg', 0], control_net: ['cnt', 0], image: ['edge', 0], strength: 0.6, start_percent: 0, end_percent: 0.8 }),
    lat: n('Khung ảnh 9:16', 'EmptyLatentImage', { width: 832, height: 1216, batch_size: 1 }),
    ks: sampler(['lat', 0], ['apply', 0], ['apply', 1]),
    dec: n('Giải mã ảnh', 'VAEDecode', { samples: ['ks', 0], vae: ['ck', 2] }),
    save: n('Lưu ảnh', 'SaveImage', { filename_prefix: 'lnl/theo-bo-cuc', images: ['dec', 0] }),
  },
};

// Chạy: node lnl-workflows/tao-workflow.mjs [none|01|02…] (server ComfyUI ở 127.0.0.1:8188)
const only = process.argv[2];
for (const [name, wf] of Object.entries(WF)) {
  fs.writeFileSync(OUT + name + '.json', JSON.stringify(wf, null, 2) + '\n');
  if (only && !name.startsWith(only)) continue;
  if (only === 'none') continue;
  const t = Date.now();
  const r = await (await fetch('http://127.0.0.1:8188/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: wf }) })).json();
  if (!r.prompt_id) { console.log(name, 'LỖI', JSON.stringify(r).slice(0, 600)); continue; }
  for (;;) {
    await new Promise((s) => setTimeout(s, 1500));
    const e = (await (await fetch('http://127.0.0.1:8188/history/' + r.prompt_id)).json())[r.prompt_id];
    if (!e) continue;
    const imgs = Object.values(e.outputs).flatMap((o) => o.images || []);
    const err = e.status.messages.find((m) => m[0] === 'execution_error');
    console.log(name, e.status.status_str, ((Date.now() - t) / 1000).toFixed(1) + 's', imgs.map((i) => `${i.subfolder}/${i.filename} ${i.metadata?.width || ''}x${i.metadata?.height || ''}`).join(', '), err ? JSON.stringify(err[1].exception_message).slice(0, 300) : '');
    break;
  }
}
