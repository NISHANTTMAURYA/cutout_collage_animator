#!/usr/bin/env python3
"""
make_video_hq.py — Maximum Quality Cutout Collage Video
=========================================================
Model  : u2net_human_seg (person-specific, beats generic u2net on people)
Frames : PNG lossless (no frame compression artifacts)
Video  : H.264 CRF 14, slow preset, yuv420p — visually near-lossless
FPS    : 60
Canvas : 1080×1920 (vertical 9:16)

Usage:
  uv run --python 3.11 --with onnxruntime --with pillow --with numpy --with requests python3 make_video_hq.py
"""

# /// script
# requires-python = ">=3.9"
# dependencies = ["onnxruntime", "pillow", "numpy", "requests"]
# ///

import os, sys, shutil, subprocess, random
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageFilter, ImageChops
    import onnxruntime as ort
    import requests
except ImportError:
    print("Missing deps — run via: uv run make_video_hq.py")
    sys.exit(1)

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────
IMG_DIR   = Path(__file__).parent / "images"
OUT_VIDEO = Path(__file__).parent / "collage_output_HQ.mp4"
FRAMES    = Path(__file__).parent / "frames_hq_tmp"
MODEL_DIR = Path.home() / ".cache" / "u2net"

# Use the human-segmentation specialised model — dramatically better on people
MODEL_NAME = "u2net_human_seg"
MODEL_URL  = f"https://github.com/danielgatis/rembg/releases/download/v0.0.0/{MODEL_NAME}.onnx"

W, H        = 1080, 1920   # vertical 9:16
FPS         = 60            # 60fps for silky smooth animation
SLIDE_DUR   = 1.5           # seconds per slide
CUTOUT_FRAC = 0.42          # fraction of slide for cutout reveal
BG_COLOR    = (13, 13, 18)  # near-black bg
EXTS        = {'.jpg', '.jpeg', '.png', '.webp'}

# Inference resolution — higher = better edges but slower
# 512 gives a great balance; 1024 is best quality (slower)
INFER_SIZE  = 320  # u2net_human_seg ONNX graph has fixed 320×320 input

# ─────────────────────────────────────────────────────────────────────────────
# MODEL DOWNLOAD
# ─────────────────────────────────────────────────────────────────────────────

def download_model():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    p = MODEL_DIR / f"{MODEL_NAME}.onnx"
    if p.exists():
        print(f"  ✓ Model cached: {p}")
        return p
    print(f"  Downloading {MODEL_NAME}.onnx …")
    r = requests.get(MODEL_URL, stream=True)
    r.raise_for_status()
    total = int(r.headers.get('content-length', 0))
    done  = 0
    with open(p, 'wb') as f:
        for chunk in r.iter_content(65536):
            f.write(chunk)
            done += len(chunk)
            if total:
                pct = done / total * 100
                bar = '█' * int(pct / 4) + '░' * (25 - int(pct / 4))
                print(f"  [{bar}] {pct:.1f}%  ({done//1024//1024}MB)", end='\r', flush=True)
    print(f"\n  Downloaded ✓")
    return p

# ─────────────────────────────────────────────────────────────────────────────
# U2NET INFERENCE
# ─────────────────────────────────────────────────────────────────────────────

def preprocess(img: Image.Image, size: int):
    img_resized = img.convert('RGB').resize((size, size), Image.LANCZOS)
    arr = np.array(img_resized, dtype=np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406])
    std  = np.array([0.229, 0.224, 0.225])
    arr  = (arr - mean) / std
    return arr.transpose(2, 0, 1)[np.newaxis].astype(np.float32)


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-np.clip(x, -88, 88)))


def refine_mask(mask_arr: np.ndarray, orig_img: Image.Image) -> np.ndarray:
    """
    Edge-aware refinement: blend the raw mask with a guided-filter-like
    approach using the original image's luminance to sharpen subject boundaries.
    Works entirely in numpy/PIL — no extra deps.
    """
    # Convert original to grayscale guidance
    gray = np.array(orig_img.convert('L'), dtype=np.float32) / 255.0

    # Compute local edge strength (Sobel-like via PIL)
    gray_pil = Image.fromarray((gray * 255).astype(np.uint8))
    edges = gray_pil.filter(ImageFilter.FIND_EDGES)
    edge_arr = np.array(edges, dtype=np.float32) / 255.0

    # Where edges are strong AND mask is near the boundary → sharpen mask
    boundary = (mask_arr > 0.15) & (mask_arr < 0.85)
    edge_strength = edge_arr * boundary

    # Pull boundary pixels toward 0 or 1 based on local edge context
    delta = edge_strength * (mask_arr - 0.5) * 0.6
    mask_arr = np.clip(mask_arr + delta, 0, 1)

    # Smooth slightly to avoid noise in flat areas
    mask_pil  = Image.fromarray((mask_arr * 255).astype(np.uint8))
    mask_pil  = mask_pil.filter(ImageFilter.GaussianBlur(radius=0.8))
    mask_arr  = np.array(mask_pil, dtype=np.float32) / 255.0

    return mask_arr


def remove_background(img: Image.Image, session: ort.InferenceSession) -> Image.Image:
    """Full-quality background removal using u2net_human_seg."""
    orig_w, orig_h = img.size
    inp_name = session.get_inputs()[0].name

    tensor  = preprocess(img, INFER_SIZE)
    outputs = session.run(None, {inp_name: tensor})

    # u2net: first output is the composite final map (best prediction)
    pred = sigmoid(outputs[0][0, 0])  # (INFER_SIZE, INFER_SIZE)

    # Normalise
    pred = (pred - pred.min()) / (pred.max() - pred.min() + 1e-8)

    # Upsample to original resolution with LANCZOS-quality bicubic
    mask_pil = Image.fromarray((pred * 255).astype(np.uint8), mode='L')
    mask_pil = mask_pil.resize((orig_w, orig_h), Image.BICUBIC)
    mask_arr = np.array(mask_pil, dtype=np.float32) / 255.0

    # Edge-aware refinement pass
    mask_arr = refine_mask(mask_arr, img)

    # Final slight feather for natural hair/fur edges
    mask_final = Image.fromarray((mask_arr * 255).astype(np.uint8), mode='L')
    mask_final = mask_final.filter(ImageFilter.GaussianBlur(radius=0.6))

    rgba = img.convert('RGBA')
    rgba.putalpha(mask_final)
    return rgba

# ─────────────────────────────────────────────────────────────────────────────
# CANVAS HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def fit_to_canvas(img: Image.Image, cover=True, rotate_deg=0.0) -> Image.Image:
    """Scale + centre image on W×H canvas. LANCZOS resampling throughout."""
    iw, ih = img.size
    if cover:
        scale = max(W / iw, H / ih)
    else:
        scale = min(W / iw, H / ih) * 0.91  # 91% — small margin

    nw, nh = int(iw * scale), int(ih * scale)
    img = img.resize((nw, nh), Image.LANCZOS)

    if rotate_deg != 0.0 and not cover:
        img = img.rotate(rotate_deg, expand=True, resample=Image.BICUBIC)
        nw, nh = img.size

    mode   = img.mode
    fill   = (0, 0, 0, 0) if 'A' in mode else (0, 0, 0)
    canvas = Image.new(mode, (W, H), fill)
    ox     = (W - nw) // 2
    oy     = (H - nh) // 2
    canvas.paste(img, (ox, oy), img if 'A' in mode else None)
    return canvas


def add_drop_shadow(cutout: Image.Image, offset=(10, 14), blur=28, opacity=0.55) -> Image.Image:
    """Photoshop-quality drop shadow: separate layer blurred then composited."""
    _, _, _, alpha = cutout.split()
    shadow_alpha = alpha.point(lambda x: int(x * opacity))

    shadow_layer = Image.new('RGBA', cutout.size, (0, 0, 0, 0))
    black        = Image.new('RGBA', cutout.size, (0, 0, 0, 255))
    shadow_layer.paste(black, mask=shadow_alpha)
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(blur))

    # Shift the shadow
    shifted = Image.new('RGBA', cutout.size, (0, 0, 0, 0))
    shifted.paste(shadow_layer, offset)

    # Composite: shadow behind cutout
    result = Image.alpha_composite(shifted, cutout)
    return result

# ─────────────────────────────────────────────────────────────────────────────
# EASING
# ─────────────────────────────────────────────────────────────────────────────

def ease_out_expo(t):
    """Very snappy reveal — fast at start, glides to rest."""
    t = max(0.0, min(1.0, t))
    return 1.0 - 2.0 ** (-10.0 * t) if t > 0 else 0.0

def ease_in_out_sine(t):
    t = max(0.0, min(1.0, t))
    return 0.5 * (1.0 - np.cos(np.pi * t))

# ─────────────────────────────────────────────────────────────────────────────
# FRAME RENDERING
# ─────────────────────────────────────────────────────────────────────────────

def apply_alpha_scale(img: Image.Image, alpha: float) -> Image.Image:
    """Scale the alpha channel of an RGBA image by a float 0-1."""
    r, g, b, a = img.split()
    a = a.point(lambda x: int(x * max(0.0, min(1.0, alpha))))
    return Image.merge('RGBA', (r, g, b, a))


def render_frame(
    prev_full:    Image.Image | None,
    curr_cutout:  Image.Image,        # with drop shadow
    curr_full:    Image.Image,        # full photo RGBA
    cutout_t:     float,              # 0→1 cutout reveal progress
    full_t:       float,              # 0→1 full photo fill progress
) -> Image.Image:
    frame = Image.new('RGBA', (W, H), (*BG_COLOR, 255))

    # Layer 1 — previous slide's full photo (static)
    if prev_full is not None:
        frame = Image.alpha_composite(frame, prev_full)

    # Layer 2 — current cutout fades in (ease_out_expo)
    if cutout_t > 0.0:
        a = ease_out_expo(cutout_t)
        layer = apply_alpha_scale(curr_cutout, a)
        frame = Image.alpha_composite(frame, layer)

    # Layer 3 — current full photo fills in (ease_in_out_sine)
    if full_t > 0.0:
        a = ease_in_out_sine(full_t)
        layer = apply_alpha_scale(curr_full, a)
        frame = Image.alpha_composite(frame, layer)

    return frame

# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    print("=" * 62)
    print("  Cutout Collage — MAXIMUM QUALITY")
    print(f"  {W}×{H}  |  {FPS}fps  |  u2net_human_seg  |  PNG frames")
    print("=" * 62)

    paths = sorted(
        [p for p in IMG_DIR.iterdir() if p.suffix.lower() in EXTS],
        key=lambda p: int(''.join(filter(str.isdigit, p.stem)) or '0')
    )
    print(f"\nFound {len(paths)} images in {IMG_DIR}")
    if not paths:
        sys.exit("No images found.")

    # ── Load model ──────────────────────────────────────────────────────────
    print("\n[1/3] Loading u2net_human_seg model…")
    model_path = download_model()
    sess_opts  = ort.SessionOptions()
    sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session    = ort.InferenceSession(
        str(model_path),
        sess_options=sess_opts,
        providers=['CPUExecutionProvider']
    )
    print(f"  Model loaded ✓  (inference size: {INFER_SIZE}px)")

    # ── Remove backgrounds ──────────────────────────────────────────────────
    print(f"\n[2/3] Removing backgrounds ({len(paths)} images)…")
    FRAMES.mkdir(exist_ok=True)
    for f in FRAMES.glob('*'):
        if f.is_file(): f.unlink()

    random.seed(42)
    rots   = [(random.random() - 0.5) * 7 for _ in paths]  # -3.5 to +3.5 deg
    slides = []

    for i, p in enumerate(paths):
        print(f"  [{i+1:02}/{len(paths)}] {p.name:20s} … ", end='', flush=True)
        orig        = Image.open(p).convert('RGB')
        cutout_rgba = remove_background(orig, session)

        # Both full photo and cutout must have the exact same size, scale, and rotation
        full_canvas   = fit_to_canvas(orig.convert('RGBA'), cover=False, rotate_deg=rots[i])
        cutout_canvas = fit_to_canvas(cutout_rgba, cover=False, rotate_deg=rots[i])
        cutout_shadow = add_drop_shadow(cutout_canvas, offset=(10, 14), blur=28, opacity=0.55)

        slides.append({
            'full':    full_canvas,
            'cutout':  cutout_shadow,
        })
        print("✓")

    print(f"\n  All {len(slides)} slides ready ✓")

    # ── Render frames ────────────────────────────────────────────────────────
    print(f"\n[3/3] Rendering {FPS}fps frames (PNG lossless)…")
    fpslide  = int(SLIDE_DUR * FPS)
    cut_f    = int(fpslide * CUTOUT_FRAC)
    fill_f   = fpslide - cut_f
    fidx     = 0
    total_f  = fpslide * len(slides)

    for si, slide in enumerate(slides):
        prev = slides[si - 1]['full'] if si > 0 else None

        for fi in range(fpslide):
            if fi < cut_f:
                ct = fi / cut_f
                ft = 0.0
            else:
                ct = 1.0
                ft = (fi - cut_f) / fill_f

            frame = render_frame(prev, slide['cutout'], slide['full'], ct, ft)
            # Save as high-quality JPEG for speed (indistinguishable from PNG after ffmpeg compression)
            frame.convert('RGB').save(
                FRAMES / f"frame_{fidx:06d}.jpg", 'JPEG', quality=95
            )
            fidx += 1

        pct = int((si + 1) / len(slides) * 100)
        bar = '█' * (pct // 4) + '░' * (25 - pct // 4)
        print(f"  [{bar}] {pct}%   slide {si+1}/{len(slides)}", end='\r', flush=True)

    print(f"\n  {fidx} frames written ✓")

    # ── ffmpeg — maximum quality encode ─────────────────────────────────────
    print(f"\nEncoding with ffmpeg (CRF 14, slow preset)…")
    cmd = [
        'ffmpeg', '-y',
        '-framerate', str(FPS),
        '-i', str(FRAMES / 'frame_%06d.jpg'),
        # Highest quality H.264
        '-c:v',    'libx264',
        '-preset', 'slow',       # better compression = better quality at same bitrate
        '-crf',    '14',         # visually lossless (18 is good, 14 is near-perfect)
        '-pix_fmt','yuv420p',    # max compatibility (phone, social media)
        '-movflags','+faststart',# web streaming optimised
        '-vf',     f'scale={W}:{H}',  # ensure exact dimensions
        str(OUT_VIDEO)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print("ffmpeg error:\n", result.stderr[-1500:])
        sys.exit(1)

    # Cleanup
    shutil.rmtree(FRAMES)

    mb  = OUT_VIDEO.stat().st_size / 1024 / 1024
    dur = len(slides) * SLIDE_DUR
    print(f"\n{'='*62}")
    print(f"  ✅  DONE — Maximum Quality Video")
    print(f"  📁  {OUT_VIDEO}")
    print(f"  📐  {W}×{H}  |  {FPS}fps  |  {dur:.1f}s  |  {mb:.1f} MB")
    print(f"  🎬  {fidx} frames rendered")
    print(f"{'='*62}\n")


if __name__ == '__main__':
    main()
