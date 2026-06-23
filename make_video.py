#!/usr/bin/env python3
"""
Cutout Collage Video Maker
==========================
Uses rembg (u2net ONNX model) to remove backgrounds from images,
then assembles a stacking-reveal video with ffmpeg.

Each slide:
  Phase 1 (0.0 – 0.4s): cutout appears (fade in) on previous full photo
  Phase 2 (0.4 – 0.8s): full photo fills in (fade in) completing the stack

Output: collage_output.mp4 (vertical 9:16, 1080×1920)
"""

import os
import sys
import glob
import math
import random
import shutil
import subprocess
import tempfile
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────────────────
IMG_DIR     = Path(__file__).parent / "images"
OUT_VIDEO   = Path(__file__).parent / "collage_output.mp4"
FRAMES_DIR  = Path(__file__).parent / "frames_tmp"

W, H        = 1080, 1920          # vertical 9:16
FPS         = 30
SLIDE_DUR   = 1.5                 # seconds per slide (total)
CUTOUT_FRAC = 0.45                # fraction of slide where cutout animates in
FILL_FRAC   = 0.55                # remaining fraction where full photo fills

BG_COLOR    = (15, 15, 20)       # near-black background
SHADOW_ALPHA = 80                 # subtle drop-shadow under cutouts

# Supported image extensions
EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.heic'}

# ── Imports (installed via uv inline) ───────────────────────────────────────
try:
    from PIL import Image, ImageDraw, ImageFilter, ImageChops
    import numpy as np
    from rembg import remove, new_session
except ImportError:
    print("ERROR: Missing dependencies. Run the install step first.")
    sys.exit(1)


def load_images():
    """Load and sort all images from IMG_DIR."""
    paths = sorted([
        p for p in IMG_DIR.iterdir()
        if p.suffix.lower() in EXTS
    ], key=lambda p: int(''.join(filter(str.isdigit, p.stem)) or 0))
    print(f"Found {len(paths)} images in {IMG_DIR}")
    return paths


def remove_background(img_path, session):
    """Use rembg (u2net) to remove background. Returns RGBA PIL Image."""
    with open(img_path, 'rb') as f:
        data = f.read()
    result = remove(data, session=session, post_process_mask=True)
    from io import BytesIO
    return Image.open(BytesIO(result)).convert('RGBA')


def fit_to_canvas(img: Image.Image, w=W, h=H, rotate_deg=0, cover=True):
    """Scale + centre image on W×H canvas. LANCZOS resampling throughout."""
    iw, ih = img.size
    if cover:
        scale = max(w / iw, h / ih)
    else:
        scale = min(w / iw, h / ih) * 0.92   # 92% of canvas for cutouts
    nw, nh = int(iw * scale), int(ih * scale)
    img = img.resize((nw, nh), Image.LANCZOS)

    if rotate_deg != 0:
        img = img.rotate(rotate_deg, expand=True, resample=Image.BICUBIC)
        nw, nh = img.size

    canvas = Image.new(img.mode, (w, h), (0, 0, 0, 0) if img.mode == 'RGBA' else (0, 0, 0))
    ox = (w - nw) // 2
    oy = (h - nh) // 2
    canvas.paste(img, (ox, oy), img if 'A' in img.mode else None)
    return canvas


def add_shadow(cutout: Image.Image, offset=(6, 8), blur=18, alpha=80):
    """Add a drop shadow beneath a cutout (RGBA image)."""
    shadow_layer = Image.new('RGBA', cutout.size, (0, 0, 0, 0))
    # Create solid black version using the alpha mask
    r, g, b, a = cutout.split()
    shadow_mask = a.point(lambda x: int(x * alpha / 255))
    black = Image.new('RGBA', cutout.size, (0, 0, 0, 255))
    shadow_layer.paste(black, mask=shadow_mask)
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(blur))

    # Composite: shadow behind cutout
    result = Image.new('RGBA', cutout.size, (0, 0, 0, 0))
    ox, oy = offset
    shadow_shifted = Image.new('RGBA', cutout.size, (0, 0, 0, 0))
    shadow_shifted.paste(shadow_layer, (ox, oy))
    result = Image.alpha_composite(shadow_shifted, cutout)
    return result


def lerp(a, b, t):
    return a + (b - a) * t


def ease_out_cubic(t):
    return 1 - (1 - t) ** 3


def ease_in_out(t):
    return t * t * (3 - 2 * t)


def blend_images(base: Image.Image, overlay: Image.Image, alpha: float):
    """Alpha-blend overlay onto base. alpha=1 → fully overlay."""
    alpha = max(0.0, min(1.0, alpha))
    if overlay.mode != 'RGBA':
        overlay = overlay.convert('RGBA')
    if base.mode != 'RGBA':
        base = base.convert('RGBA')

    r1, g1, b1, a1 = base.split()
    r2, g2, b2, a2 = overlay.split()

    a2_scaled = a2.point(lambda x: int(x * alpha))
    result = Image.new('RGBA', base.size)
    result.paste(base, mask=a1)
    result.paste(overlay, mask=a2_scaled)
    return result


def generate_frame(
    bg_color,
    prev_full,      # PIL RGBA — previous slide full photo (or None)
    curr_cutout,    # PIL RGBA — current slide cutout (transparent bg)
    curr_full,      # PIL RGBA — current slide full photo
    cutout_alpha,   # 0..1 — how visible is cutout
    full_alpha,     # 0..1 — how visible is full photo on top
    rotation_deg,
):
    """Render a single frame as PIL RGBA."""
    frame = Image.new('RGBA', (W, H), (*bg_color, 255))

    # Layer 1: previous slide full photo (static base)
    if prev_full is not None:
        frame = Image.alpha_composite(frame, prev_full)

    # Layer 2: current cutout fades in (with drop shadow)
    if cutout_alpha > 0.001:
        cutout_with_shadow = add_shadow(curr_cutout, offset=(8, 10), blur=20, alpha=SHADOW_ALPHA)
        a = ease_out_cubic(cutout_alpha)
        cutout_a = cutout_with_shadow.copy()
        # Modulate alpha
        r, g, b, ch_a = cutout_a.split()
        ch_a = ch_a.point(lambda x: int(x * a))
        cutout_a = Image.merge('RGBA', (r, g, b, ch_a))
        frame = Image.alpha_composite(frame, cutout_a)

    # Layer 3: current full photo fades in (completes the stack)
    if full_alpha > 0.001:
        a = ease_in_out(full_alpha)
        full_a = curr_full.copy()
        r, g, b, ch_a = full_a.split()
        ch_a = ch_a.point(lambda x: int(x * a))
        full_a = Image.merge('RGBA', (r, g, b, ch_a))
        frame = Image.alpha_composite(frame, full_a)

    return frame.convert('RGB')


def main():
    print("=" * 60)
    print("  Cutout Collage Video Maker")
    print("=" * 60)

    paths = load_images()
    if not paths:
        print(f"No images found in {IMG_DIR}")
        sys.exit(1)

    # ── Setup ──
    FRAMES_DIR.mkdir(exist_ok=True)
    # Clear old frames
    for f in FRAMES_DIR.glob('*.jpg'):
        f.unlink()

    # ── Load rembg model ──
    print("\n[1/3] Loading rembg (u2net) model…")
    print("      (First run downloads ~175MB model — cached after that)")
    session = new_session('u2net')
    print("      Model ready ✓")

    # ── Process images ──
    print(f"\n[2/3] Processing {len(paths)} images…")
    slides = []
    rotations = [(random.random() - 0.5) * 8 for _ in paths]  # -4..+4 degrees

    for i, p in enumerate(paths):
        print(f"  [{i+1}/{len(paths)}] {p.name} …", end=' ', flush=True)

        # Both full photo and cutout must have the exact same size, scale, and rotation
        full_rgba = Image.open(p).convert('RGBA')
        full_canvas = fit_to_canvas(full_rgba.copy(), cover=False, rotate_deg=rotations[i])

        # Cutout (background removed, fitted to canvas)
        cutout_rgba = remove_background(p, session)
        cutout_canvas = fit_to_canvas(cutout_rgba, cover=False, rotate_deg=rotations[i])

        slides.append({
            'full':    full_canvas,
            'cutout':  cutout_canvas,
            'rotation': rotations[i],
            'name':    p.name,
        })
        print("✓")

    print(f"\n  All {len(slides)} slides processed!")

    # ── Render frames ──
    print(f"\n[3/3] Rendering frames at {FPS}fps…")
    frames_per_slide = int(SLIDE_DUR * FPS)
    cutout_frames    = int(frames_per_slide * CUTOUT_FRAC)
    fill_frames      = frames_per_slide - cutout_frames

    frame_idx = 0
    total_frames = frames_per_slide * len(slides)

    for si, slide in enumerate(slides):
        prev_full = slides[si - 1]['full'] if si > 0 else None
        curr_full   = slide['full']
        curr_cutout = slide['cutout']

        for fi in range(frames_per_slide):
            if fi < cutout_frames:
                # Cutout phase
                t_cutout = fi / cutout_frames
                t_full   = 0.0
            else:
                # Fill phase
                t_cutout = 1.0
                t_full   = (fi - cutout_frames) / fill_frames

            frame = generate_frame(
                bg_color    = BG_COLOR,
                prev_full   = prev_full,
                curr_cutout = curr_cutout,
                curr_full   = curr_full,
                cutout_alpha = t_cutout,
                full_alpha   = t_full,
                rotation_deg = slide['rotation'],
            )

            frame_path = FRAMES_DIR / f"frame_{frame_idx:06d}.jpg"
            frame.save(frame_path, 'JPEG', quality=92)
            frame_idx += 1

        pct = int((si + 1) / len(slides) * 100)
        bar = '█' * (pct // 5) + '░' * (20 - pct // 5)
        print(f"  [{bar}] {pct}%  slide {si+1}/{len(slides)}", end='\r', flush=True)

    print(f"\n  {frame_idx} frames rendered ✓")

    # ── Assemble video with ffmpeg ──
    print(f"\nAssembling video with ffmpeg…")
    ffmpeg_cmd = [
        'ffmpeg', '-y',
        '-framerate', str(FPS),
        '-i', str(FRAMES_DIR / 'frame_%06d.jpg'),
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        str(OUT_VIDEO)
    ]
    result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print("ffmpeg error:", result.stderr[-1000:])
        sys.exit(1)

    # ── Cleanup temp frames ──
    shutil.rmtree(FRAMES_DIR)

    size_mb = OUT_VIDEO.stat().st_size / 1024 / 1024
    print(f"\n{'='*60}")
    print(f"  ✅ Done! Video saved to:")
    print(f"     {OUT_VIDEO}")
    print(f"     Size: {size_mb:.1f} MB")
    print(f"     Duration: {len(slides) * SLIDE_DUR:.1f}s  |  {total_frames} frames  |  {FPS}fps")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
