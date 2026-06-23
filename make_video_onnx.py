#!/usr/bin/env python3
"""
make_video_onnx.py — Cutout video using onnxruntime directly (no rembg dependency chain)
Downloads u2net.onnx (~175MB) once, caches it, then processes all images.
"""

# /// script
# requires-python = ">=3.9"
# dependencies = [
#   "onnxruntime",
#   "pillow",
#   "numpy",
#   "requests",
# ]
# ///

import os, sys, shutil, subprocess, random
from pathlib import Path
from io import BytesIO

try:
    import numpy as np
    from PIL import Image, ImageFilter
    import onnxruntime as ort
    import requests
except ImportError:
    print("Missing deps — run via: uv run make_video_onnx.py")
    sys.exit(1)

# ── Config ──────────────────────────────────────────────────────────────────
IMG_DIR   = Path(__file__).parent / "images"
OUT_VIDEO = Path(__file__).parent / "collage_output.mp4"
FRAMES    = Path(__file__).parent / "frames_tmp"
MODEL_DIR = Path.home() / ".cache" / "u2net"
MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx"

W, H      = 1080, 1920
FPS       = 30
SLIDE_DUR = 1.5
BG_COLOR  = (15, 15, 20)
EXTS      = {'.jpg', '.jpeg', '.png', '.webp'}

# ── U2Net inference ──────────────────────────────────────────────────────────

def download_model():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model_path = MODEL_DIR / "u2net.onnx"
    if model_path.exists():
        print(f"  Model cached at {model_path} ✓")
        return model_path
    print(f"  Downloading u2net.onnx (~175MB) to {model_path} …")
    r = requests.get(MODEL_URL, stream=True)
    r.raise_for_status()
    total = int(r.headers.get('content-length', 0))
    downloaded = 0
    with open(model_path, 'wb') as f:
        for chunk in r.iter_content(chunk_size=65536):
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded / total * 100
                bar = '█' * int(pct / 5) + '░' * (20 - int(pct / 5))
                print(f"  [{bar}] {pct:.0f}%", end='\r', flush=True)
    print(f"\n  Downloaded ✓")
    return model_path


def preprocess(img: Image.Image, size=320):
    """Resize and normalise image for u2net input."""
    img = img.convert('RGB').resize((size, size), Image.BILINEAR)
    arr = np.array(img, dtype=np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406])
    std  = np.array([0.229, 0.224, 0.225])
    arr  = (arr - mean) / std
    return arr.transpose(2, 0, 1)[np.newaxis].astype(np.float32)


def sigmoid(x):
    return 1 / (1 + np.exp(-x))


def remove_background(img: Image.Image, session: ort.InferenceSession) -> Image.Image:
    """Run u2net inference and return RGBA image with transparent background."""
    orig_w, orig_h = img.size
    inp_name = session.get_inputs()[0].name

    tensor = preprocess(img)
    outputs = session.run(None, {inp_name: tensor})

    # u2net returns multiple side outputs; first is the final prediction
    pred = sigmoid(outputs[0][0, 0])  # shape: (320, 320)

    # Normalise mask to 0-1
    pred = (pred - pred.min()) / (pred.max() - pred.min() + 1e-8)

    # Upsample mask to original size with smooth interpolation
    mask_img = Image.fromarray((pred * 255).astype(np.uint8), mode='L')
    mask_img = mask_img.resize((orig_w, orig_h), Image.BICUBIC)

    # Apply a slight blur to soften jagged edges
    mask_img = mask_img.filter(ImageFilter.GaussianBlur(radius=1.5))

    # Compose RGBA
    rgba = img.convert('RGBA')
    rgba.putalpha(mask_img)
    return rgba


# ── Canvas helpers ───────────────────────────────────────────────────────────

def fit_to_canvas(img: Image.Image, cover=True, rotate_deg=0):
    iw, ih = img.size
    if cover:
        scale = max(W / iw, H / ih)
    else:
        scale = min(W / iw, H / ih) * 0.9

    nw, nh = int(iw * scale), int(ih * scale)
    img = img.resize((nw, nh), Image.LANCZOS)

    if rotate_deg != 0 and not cover:
        img = img.rotate(rotate_deg, expand=True, resample=Image.BICUBIC)
        nw, nh = img.size

    canvas = Image.new(img.mode, (W, H), (0, 0, 0, 0) if 'A' in img.mode else (0, 0, 0))
    ox = (W - nw) // 2
    oy = (H - nh) // 2
    canvas.paste(img, (ox, oy), img if 'A' in img.mode else None)
    return canvas


def add_shadow(cutout: Image.Image, blur=20, alpha=80):
    r, g, b, a = cutout.split()
    shadow_a = a.point(lambda x: int(x * alpha / 255))
    black = Image.new('RGBA', cutout.size, (0, 0, 0, 255))
    shadow = Image.new('RGBA', cutout.size, (0, 0, 0, 0))
    shadow.paste(black, mask=shadow_a)
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    # Offset shadow
    offset = Image.new('RGBA', cutout.size, (0, 0, 0, 0))
    offset.paste(shadow, (8, 12))
    result = Image.alpha_composite(offset, cutout)
    return result


def ease_out_cubic(t): return 1 - (1 - max(0, min(1, t))) ** 3
def ease_in_out(t): t = max(0, min(1, t)); return t * t * (3 - 2 * t)


def render_frame(bg_color, prev_full, curr_cutout, curr_full, cutout_t, full_t):
    frame = Image.new('RGBA', (W, H), (*bg_color, 255))

    if prev_full is not None:
        frame = Image.alpha_composite(frame, prev_full)

    if cutout_t > 0.001:
        c = add_shadow(curr_cutout)
        a = ease_out_cubic(cutout_t)
        r, g, b, ch_a = c.split()
        ch_a = ch_a.point(lambda x: int(x * a))
        c = Image.merge('RGBA', (r, g, b, ch_a))
        frame = Image.alpha_composite(frame, c)

    if full_t > 0.001:
        a = ease_in_out(full_t)
        r, g, b, ch_a = curr_full.split()
        ch_a = ch_a.point(lambda x: int(x * a))
        f = Image.merge('RGBA', (r, g, b, ch_a))
        frame = Image.alpha_composite(frame, f)

    return frame.convert('RGB')


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Cutout Collage Video Maker (onnxruntime / u2net)")
    print("=" * 60)

    # Load image paths
    paths = sorted([p for p in IMG_DIR.iterdir() if p.suffix.lower() in EXTS],
                   key=lambda p: int(''.join(filter(str.isdigit, p.stem)) or '0'))
    print(f"\nFound {len(paths)} images")
    if not paths:
        sys.exit("No images found in images/")

    # Download / load model
    print("\n[1/3] Loading u2net model…")
    model_path = download_model()
    session = ort.InferenceSession(str(model_path), providers=['CPUExecutionProvider'])
    print("  Model ready ✓")

    # Process images
    print(f"\n[2/3] Removing backgrounds…")
    FRAMES.mkdir(exist_ok=True)
    for f in FRAMES.glob('*.jpg'): f.unlink()

    slides = []
    rots   = [(random.random() - 0.5) * 8 for _ in paths]

    for i, p in enumerate(paths):
        print(f"  [{i+1:02}/{len(paths)}] {p.name} … ", end='', flush=True)
        orig = Image.open(p).convert('RGB')
        cutout_rgba = remove_background(orig, session)

        # Both full photo and cutout must have the exact same size, scale, and rotation
        full_canvas   = fit_to_canvas(orig.convert('RGBA'), cover=False, rotate_deg=rots[i])
        cutout_canvas = fit_to_canvas(cutout_rgba, cover=False, rotate_deg=rots[i])

        slides.append({'full': full_canvas, 'cutout': cutout_canvas})
        print("✓")

    # Render frames
    print(f"\n[3/3] Rendering frames…")
    fpslide = int(SLIDE_DUR * FPS)
    cut_f   = int(fpslide * 0.45)
    fill_f  = fpslide - cut_f

    fidx = 0
    for si, slide in enumerate(slides):
        prev = slides[si-1]['full'] if si > 0 else None
        for fi in range(fpslide):
            if fi < cut_f:
                ct, ft = fi / cut_f, 0.0
            else:
                ct, ft = 1.0, (fi - cut_f) / fill_f

            frame = render_frame(BG_COLOR, prev, slide['cutout'], slide['full'], ct, ft)
            frame.save(FRAMES / f"frame_{fidx:06d}.jpg", quality=92)
            fidx += 1

        pct = int((si+1)/len(slides)*100)
        print(f"  {'█'*(pct//5)}{'░'*(20-pct//5)} {pct}%  [{si+1}/{len(slides)}]", end='\r')

    print(f"\n  {fidx} frames written ✓")

    # Assemble with ffmpeg
    print("\nAssembling with ffmpeg…")
    cmd = ['ffmpeg', '-y', '-framerate', str(FPS),
           '-i', str(FRAMES / 'frame_%06d.jpg'),
           '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
           '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(OUT_VIDEO)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("ffmpeg error:", r.stderr[-800:])
        sys.exit(1)

    shutil.rmtree(FRAMES)
    mb = OUT_VIDEO.stat().st_size / 1024 / 1024
    print(f"\n{'='*60}")
    print(f"  ✅  Video saved: {OUT_VIDEO}")
    print(f"      {mb:.1f} MB  |  {len(slides)*SLIDE_DUR:.0f}s  |  {FPS}fps  |  {W}×{H}")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
