/**
 * AI-Powered Subject Detection Module
 *
 * Uses @imgly/background-removal loaded via dynamic ESM import from esm.sh.
 *
 * Pipeline:
 *  1. Load model dynamically
 *  2. Convert input image to Blob
 *  3. Call removeBackground() → returns a PNG Blob with transparent bg
 *  4. Convert to canvas → attach as ._cutoutCanvas on the returned mask
 */

let modelStatus = 'idle'; // 'idle' | 'loading' | 'ready' | 'error'
let onModelStatusChange = null;
let _cachedRemoveFn = null;

async function getRemoveFn() {
    if (_cachedRemoveFn) return _cachedRemoveFn;
    try {
        const mod = await import('https://esm.sh/@imgly/background-removal@1.5.2?bundle');
        _cachedRemoveFn = mod.removeBackground || mod.default?.removeBackground || mod.default;
        return _cachedRemoveFn;
    } catch (e) {
        console.error('[saliency] Failed to import @imgly/background-removal from esm.sh:', e);
        return null;
    }
}

/**
 * Register a callback to track model loading status.
 * @param {function} callback - Receives 'loading', 'ready', or 'error'
 */
export function setModelStatusCallback(callback) {
    onModelStatusChange = callback;
}

/**
 * Preloads the AI model by running a tiny 1×1 warm-up inference.
 * This kicks off the ONNX model download in the background so it's
 * warm before the user uploads their real photos.
 */
export async function loadModel() {
    if (modelStatus === 'ready') return;
    if (modelStatus === 'loading') return;

    modelStatus = 'loading';
    if (onModelStatusChange) onModelStatusChange('loading');

    const removeFn = await getRemoveFn();

    if (!removeFn) {
        modelStatus = 'error';
        console.error('[saliency] @imgly/background-removal did not load.');
        if (onModelStatusChange) onModelStatusChange('error');
        return;
    }

    // Do a tiny warm-up call so the ONNX model is downloaded & cached
    try {
        const warmup = createTinyBlob();
        await removeFn(warmup, {
            model: 'small',
            output: { format: 'image/png', quality: 1.0 },
        });
        modelStatus = 'ready';
        if (onModelStatusChange) onModelStatusChange('ready');
        console.info('[saliency] AI model ready ✓');
    } catch (e) {
        // Warm-up can fail on the tiny blob — still mark as ready, real images will work
        modelStatus = 'ready';
        if (onModelStatusChange) onModelStatusChange('ready');
        console.info('[saliency] AI model loaded (warm-up skipped):', e?.message);
    }
}

/**
 * Removes the background from an image.
 * Returns a MASK canvas (white = subject, alpha = soft edge) with
 * ._cutoutCanvas = the transparent-background cutout ready for drawing.
 *
 * @param {HTMLImageElement} imgElement
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function detectSubject(imgElement) {
    if (!imgElement || !imgElement.naturalWidth) {
        console.warn('[saliency] detectSubject called with no image, using fallback');
        return heuristicCutout(imgElement);
    }

    const removeFn = await getRemoveFn();

    if (!removeFn) {
        console.warn('[saliency] Library not available — using heuristic fallback');
        return heuristicCutout(imgElement);
    }

    try {
        console.info('[saliency] Running AI background removal on', imgElement.naturalWidth, 'x', imgElement.naturalHeight);

        // Convert the <img> to a Blob the library can consume
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width  = imgElement.naturalWidth;
        srcCanvas.height = imgElement.naturalHeight;
        const srcCtx = srcCanvas.getContext('2d');
        srcCtx.drawImage(imgElement, 0, 0);
        const inputBlob = await canvasToBlob(srcCanvas, 'image/png');

        // ── Run the AI model ──────────────────────────────────────────────
        const resultBlob = await removeFn(inputBlob, {
            model: 'medium',    // 'small' = faster, 'medium' = better quality
            output: {
                format: 'image/png',
                quality: 1.0,
            },
        });
        // ─────────────────────────────────────────────────────────────────

        console.info('[saliency] AI finished, result blob size:', resultBlob.size);

        // Draw result into a canvas
        const url    = URL.createObjectURL(resultBlob);
        const cutImg = await loadImage(url);
        URL.revokeObjectURL(url);

        const cutoutCanvas = document.createElement('canvas');
        cutoutCanvas.width  = imgElement.naturalWidth;
        cutoutCanvas.height = imgElement.naturalHeight;
        cutoutCanvas.getContext('2d').drawImage(cutImg, 0, 0, cutoutCanvas.width, cutoutCanvas.height);

        // Build mask (white + soft alpha) for editor compatibility
        const maskCanvas = alphaToMask(cutoutCanvas);
        maskCanvas._cutoutCanvas = cutoutCanvas; // piggyback the ready cutout

        return maskCanvas;

    } catch (err) {
        console.error('[saliency] AI background removal FAILED:', err);
        return heuristicCutout(imgElement);
    }
}

/**
 * Smooth-mask helper kept for manual editor brush strokes.
 */
export function smoothMask(maskCanvas, radius = 5) {
    const smoothCanvas = document.createElement('canvas');
    smoothCanvas.width  = maskCanvas.width;
    smoothCanvas.height = maskCanvas.height;
    const ctx = smoothCanvas.getContext('2d');

    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.filter = 'none';

    const imgData = ctx.getImageData(0, 0, smoothCanvas.width, smoothCanvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
        const v = d[i] > 50 ? 255 : 0;
        d[i] = d[i+1] = d[i+2] = d[i+3] = v;
    }
    ctx.putImageData(imgData, 0, 0);
    return smoothCanvas;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Polls window globals until the UMD library's removeBackground function
 * is found, or the timeout expires.
 */
// waitForLib removed (now using dynamic ESM imports directly)

/** Load a URL into an <img> element. */
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload  = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

/** canvas → Blob (promisified) */
function canvasToBlob(canvas, type = 'image/png') {
    return new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), type);
    });
}

/**
 * Convert the alpha channel of a cutout canvas into a white mask canvas
 * that preserves soft edges (smooth alpha). Used by the editor overlay.
 */
function alphaToMask(srcCanvas) {
    const mask = document.createElement('canvas');
    mask.width  = srcCanvas.width;
    mask.height = srcCanvas.height;
    const ctx   = mask.getContext('2d');
    ctx.drawImage(srcCanvas, 0, 0);

    const imgData = ctx.getImageData(0, 0, mask.width, mask.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];            // original alpha from AI model
        d[i] = d[i+1] = d[i+2] = 255; // white fill for mask overlay
        d[i + 3] = a;                  // preserve soft feathered edges
    }
    ctx.putImageData(imgData, 0, 0);
    return mask;
}

/**
 * Creates a 1×1 transparent PNG blob for model warm-up.
 */
function createTinyBlob() {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return new Promise(r => c.toBlob(r, 'image/png'));
}

/**
 * Heuristic fallback — only runs when the AI library completely fails to load.
 * Much worse quality but better than nothing.
 */
function heuristicCutout(imgElement) {
    return new Promise((resolve) => {
        if (!imgElement || !imgElement.naturalWidth) {
            const empty = document.createElement('canvas');
            empty.width = empty.height = 1;
            resolve(empty);
            return;
        }

        const SIZE = 128;
        const work = document.createElement('canvas');
        work.width = work.height = SIZE;
        const wCtx = work.getContext('2d');
        wCtx.drawImage(imgElement, 0, 0, SIZE, SIZE);
        const { data } = wCtx.getImageData(0, 0, SIZE, SIZE);

        // Sample border pixels as background colour estimate
        let bgR = 0, bgG = 0, bgB = 0, n = 0;
        for (let y = 0; y < SIZE; y++) {
            for (let x = 0; x < SIZE; x++) {
                if (x > 3 && x < SIZE - 4 && y > 3 && y < SIZE - 4) continue;
                const i = (y * SIZE + x) * 4;
                bgR += data[i]; bgG += data[i+1]; bgB += data[i+2]; n++;
            }
        }
        bgR /= n; bgG /= n; bgB /= n;

        const cx = SIZE / 2, cy = SIZE / 2, sigma = SIZE * 0.35;
        const sal = new Float32Array(SIZE * SIZE);
        let maxS = 0;

        for (let y = 0; y < SIZE; y++) {
            for (let x = 0; x < SIZE; x++) {
                const i = (y * SIZE + x) * 4;
                const dist = Math.hypot(data[i]-bgR, data[i+1]-bgG, data[i+2]-bgB);
                const bias = Math.exp(-((x-cx)**2 + (y-cy)**2) / (2*sigma*sigma));
                const s = dist * bias;
                sal[y * SIZE + x] = s;
                if (s > maxS) maxS = s;
            }
        }

        const thr = maxS * 0.5;
        const bin = sal.map(s => s >= thr ? 1 : 0);

        // BFS from centre
        const clean   = new Uint8Array(SIZE * SIZE);
        const visited = new Uint8Array(SIZE * SIZE);
        const q = [];
        for (let r = 0; r <= SIZE * 0.2; r++) {
            let seeded = false;
            for (let dy = -r; dy <= r && !seeded; dy++) {
                for (let dx = -r; dx <= r && !seeded; dx++) {
                    const sx = Math.round(cx) + dx, sy = Math.round(cy) + dy;
                    if (sx < 0 || sx >= SIZE || sy < 0 || sy >= SIZE) continue;
                    if (bin[sy * SIZE + sx]) {
                        q.push(sx, sy); visited[sy * SIZE + sx] = 1; seeded = true;
                    }
                }
            }
            if (q.length) break;
        }

        while (q.length) {
            const px = q.shift(), py = q.shift();
            clean[py * SIZE + px] = 1;
            for (const [nx, ny] of [[px+1,py],[px-1,py],[px,py+1],[px,py-1]]) {
                if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue;
                const ni = ny * SIZE + nx;
                if (!visited[ni] && bin[ni]) { visited[ni] = 1; q.push(nx, ny); }
            }
        }

        const low = document.createElement('canvas');
        low.width = low.height = SIZE;
        const lCtx = low.getContext('2d');
        const ld = lCtx.createImageData(SIZE, SIZE);
        for (let i = 0; i < clean.length; i++) {
            const v = clean[i] ? 255 : 0;
            ld.data[i*4] = ld.data[i*4+1] = ld.data[i*4+2] = ld.data[i*4+3] = v;
        }
        lCtx.putImageData(ld, 0, 0);

        const out = document.createElement('canvas');
        out.width  = imgElement.naturalWidth;
        out.height = imgElement.naturalHeight;
        const oCtx = out.getContext('2d');
        oCtx.imageSmoothingEnabled = true;
        oCtx.imageSmoothingQuality = 'high';
        oCtx.drawImage(low, 0, 0, out.width, out.height);

        const od = oCtx.getImageData(0, 0, out.width, out.height);
        for (let i = 0; i < od.data.length; i += 4) {
            const v = Math.round(Math.pow(od.data[i] / 255, 0.7) * 255);
            od.data[i] = od.data[i+1] = od.data[i+2] = od.data[i+3] = v;
        }
        oCtx.putImageData(od, 0, 0);
        resolve(out);
    });
}
