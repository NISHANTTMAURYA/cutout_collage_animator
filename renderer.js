/**
 * Canvas Animation & Styles Renderer
 */

export class CollageRenderer {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        
        this.slides = []; // Array of { img, mask, cutout, text }
        this.activeStyle = 'clean';
        this.borderType = 'none';
        this.bgPalette = 'dark';
        this.slideDuration = 1.5; // seconds
        this.cutoutHoldRatio = 0.35; // default 35% of slide duration
        this.beatSync = true;
        
        // Beat trigger pulse (decays over time)
        this.beatPulse = 0.0;
        
        // Procedural texture canvases
        this.textures = {
            paper: null,
            cork: null,
            grid: null
        };
        
        // Pre-render textures once
        this.initTextures();
    }

    initTextures() {
        const w = 540;
        const h = 960;
        
        // 1. Paper Texture
        const paper = document.createElement('canvas');
        paper.width = w;
        paper.height = h;
        const pCtx = paper.getContext('2d');
        pCtx.fillStyle = '#f8f9fa';
        pCtx.fillRect(0, 0, w, h);
        
        // Add fine noise
        const imgData = pCtx.getImageData(0, 0, w, h);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            const noise = (Math.random() - 0.5) * 15;
            data[i] = Math.max(0, Math.min(255, data[i] + noise));
            data[i+1] = Math.max(0, Math.min(255, data[i+1] + noise));
            data[i+2] = Math.max(0, Math.min(255, data[i+2] + noise));
        }
        pCtx.putImageData(imgData, 0, 0);
        this.textures.paper = paper;
        
        // 2. Corkboard Texture
        const cork = document.createElement('canvas');
        cork.width = w;
        cork.height = h;
        const cCtx = cork.getContext('2d');
        cCtx.fillStyle = '#b45309';
        cCtx.fillRect(0, 0, w, h);
        
        // Cork grain noise
        const cData = cCtx.getImageData(0, 0, w, h);
        const cd = cData.data;
        for (let i = 0; i < cd.length; i += 4) {
            const noise = (Math.random() - 0.5) * 45;
            const darkScale = Math.random() > 0.95 ? 0.7 : 1.0; // Speckles
            cd[i] = Math.max(0, Math.min(255, (cd[i] + noise) * darkScale));
            cd[i+1] = Math.max(0, Math.min(255, (cd[i+1] + noise - 10) * darkScale));
            cd[i+2] = Math.max(0, Math.min(255, (cd[i+2] + noise - 20) * darkScale));
        }
        cCtx.putImageData(cData, 0, 0);
        this.textures.cork = cork;
        
        // 3. Grid Texture
        const grid = document.createElement('canvas');
        grid.width = w;
        grid.height = h;
        const gCtx = grid.getContext('2d');
        gCtx.fillStyle = '#1e1e2f';
        gCtx.fillRect(0, 0, w, h);
        gCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        gCtx.lineWidth = 1;
        
        const gridSize = 25;
        for (let x = 0; x < w; x += gridSize) {
            gCtx.beginPath();
            gCtx.moveTo(x, 0);
            gCtx.lineTo(x, h);
            gCtx.stroke();
        }
        for (let y = 0; y < h; y += gridSize) {
            gCtx.beginPath();
            gCtx.moveTo(0, y);
            gCtx.lineTo(w, y);
            gCtx.stroke();
        }
        this.textures.grid = grid;
    }

    setSlides(uploadedSlides) {
        this.slides = uploadedSlides;
        // Pre-build cutout layers for efficiency
        this.slides.forEach(slide => {
            if (!slide.cutout && slide.mask) {
                slide.cutout = this.generateCutout(slide.img, slide.mask);
            }
        });
    }

    // Creates cutout layer by cropping original image with mask
    generateCutout(img, maskCanvas) {
        const cutoutCanvas = document.createElement('canvas');
        cutoutCanvas.width = img.naturalWidth;
        cutoutCanvas.height = img.naturalHeight;
        const ctx = cutoutCanvas.getContext('2d');
        
        // 1. Draw the original image first
        ctx.drawImage(img, 0, 0);
        
        // 2. Apply mask using destination-in: only pixels where mask is white are kept
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(maskCanvas, 0, 0, cutoutCanvas.width, cutoutCanvas.height);
        
        return cutoutCanvas;
    }

    // Decay the beat pulse in render tick
    update(dt) {
        if (this.beatPulse > 0.0) {
            this.beatPulse -= dt * 4.0; // Decay rate
            if (this.beatPulse < 0.0) this.beatPulse = 0.0;
        }
    }

    triggerBeatPulse() {
        this.beatPulse = 1.0;
    }

    getPaletteColors() {
        const palettes = {
            pastel: {
                bg: ['#f5ebe0', '#e3d5ca', '#d5bdaf', '#e9ecef'],
                primary: '#9d4edd',
                text: '#4a4e69',
                accent: '#e5989b'
            },
            dark: {
                bg: ['#1a1e29', '#14141e', '#0d0d12', '#22223b'],
                primary: '#c77dff',
                text: '#f8f9fa',
                accent: '#ff7096'
            },
            kraft: {
                bg: ['#e6ccb2', '#ddb892', '#b08968', '#7f5539'],
                primary: '#7f5539',
                text: '#220f06',
                accent: '#9c6644'
            },
            neon: {
                bg: ['#03071e', '#110c22', '#220033', '#001a2d'],
                primary: '#39ff14',
                text: '#ffffff',
                accent: '#ff007f'
            }
        };
        return palettes[this.bgPalette] || palettes.pastel;
    }

    // Main Draw Function (called at time t in seconds)
    draw(t) {
        if (this.slides.length === 0) {
            this.drawEmptyState();
            return;
        }

        const totalDuration = this.slides.length * this.slideDuration;
        const time = ((t % totalDuration) + totalDuration) % totalDuration;
        
        const slideIdx = Math.floor(time / this.slideDuration);
        const localTime = time % this.slideDuration;
        
        const slide = this.slides[slideIdx];
        const prevSlide = this.slides[(slideIdx - 1 + this.slides.length) % this.slides.length];
        
        // Guard: skip draw if slide image not ready
        if (!slide || !slide.img) return;
        
        this.ctx.save();
        this.drawCleanSlide(slide, prevSlide, localTime, slideIdx, t);
        this.ctx.restore();
    }

    drawEmptyState() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        this.ctx.fillStyle = '#0f0f15';
        this.ctx.fillRect(0, 0, w, h);
        
        this.ctx.fillStyle = 'rgba(255,255,255,0.03)';
        this.ctx.fillRect(20, 20, w - 40, h - 40);
        
        this.ctx.fillStyle = '#a5a5b5';
        this.ctx.font = '700 18px Outfit';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('✨ No Photos Uploaded Yet ✨', w / 2, h / 2 - 10);
        this.ctx.font = '400 13px Outfit';
        this.ctx.fillText('Upload 5-20 photos in Step 1 to begin', w / 2, h / 2 + 20);
    }

    drawCleanSlide(slide, prevSlide, localTime, slideIdx, t) {
        if (!slide || !slide.img) return; // Safety guard
        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        // Always clear to black (base)
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, w, h);

        // Current slide dimensions — contain-fit, no zoom, no movement
        const aspect = slide.img.naturalWidth / slide.img.naturalHeight;
        let destW = w;
        let destH = w / aspect;
        if (destH > h) { destH = h; destW = destH * aspect; }

        // ─── Animation timeline (fast & smooth) ─────────────────────────
        // 0.00s → 0.15s : Cutout fades in quickly on top of prev photo
        // 0.15s → 0.55s : Cutout fully visible (hold)
        // 0.55s → 0.95s : Full photo background fades in (0.4 s)
        // 0.95s → end   : Complete photo visible — hold until next slide
        // ────────────────────────────────────────────────────────────────
        const CUTOUT_FADE  = Math.min(0.15, this.slideDuration * 0.1); // seconds to fade cutout in
        const BG_START     = this.slideDuration * (this.cutoutHoldRatio || 0.35); // when background starts fading
        const BG_FADE      = Math.min(0.40, this.slideDuration * 0.25); // duration of background fade
        const BG_END       = BG_START + BG_FADE;

        // Ease helper — smooth-step curve for less mechanical feel
        const easeInOut = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;

        const cutoutAlpha = easeInOut(Math.min(1.0, localTime / CUTOUT_FADE));
        const bgAlpha = localTime >= BG_START
            ? easeInOut(Math.min(1.0, (localTime - BG_START) / BG_FADE))
            : 0.0;

        // Is this the very first slide on the first play-through?
        // If yes, there's no "previous complete photo" to show underneath.
        const isFirstPass = slideIdx === 0 && t < this.slideDuration;

        // ── LAYER 1: Previous slide's COMPLETE full photo ─────────────────
        // Shown as the base canvas for every slide except first-ever pass.
        if (this.slides.length > 1 && !isFirstPass && prevSlide && prevSlide.img) {
            const pa = prevSlide.img.naturalWidth / prevSlide.img.naturalHeight;
            let pw = w, ph = w / pa;
            if (ph > h) { ph = h; pw = ph * pa; }
            this.ctx.save();
            this.ctx.translate(cx, cy);
            this.ctx.rotate(prevSlide.rotation || 0);
            this.ctx.drawImage(prevSlide.img, -pw / 2, -ph / 2, pw, ph);
            this.ctx.restore();
        }

        // ── LAYER 2: Current slide CUTOUT — fades in quickly on top ───────
        // Stays visible until the background fully covers it (bgAlpha = 1).
        if (bgAlpha < 1.0 && cutoutAlpha > 0.0 && slide.cutout) {
            this.ctx.save();
            this.ctx.globalAlpha = cutoutAlpha;
            this.ctx.translate(cx, cy);
            this.ctx.rotate(slide.rotation || 0);
            this.ctx.drawImage(slide.cutout, -destW / 2, -destH / 2, destW, destH);
            this.ctx.restore();
        }

        // ── LAYER 3: Current slide FULL PHOTO — fades in on top of cutout ─
        // Once bgAlpha = 1 the photo completely covers both previous photo
        // and the cutout layer, completing the "fill-in" effect.
        if (bgAlpha > 0.0) {
            this.ctx.save();
            this.ctx.globalAlpha = bgAlpha;
            this.ctx.translate(cx, cy);
            this.ctx.rotate(slide.rotation || 0);
            this.ctx.drawImage(slide.img, -destW / 2, -destH / 2, destW, destH);
            this.ctx.restore();
        }

        // ── CAPTION ───────────────────────────────────────────────────────
        if (slide.text) {
            this.ctx.save();
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = '500 20px Outfit, sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            this.ctx.shadowBlur = 6;
            this.ctx.fillText(slide.text, w / 2, h - 80);
            this.ctx.restore();
        }
    }


    // Retained for backwards compatibility if referenced
    drawStyle(slide, localTime, index, colors, beatBounce) {
        const prevSlide = this.slides[(index - 1 + this.slides.length) % this.slides.length];
        this.drawCleanSlide(slide, prevSlide, localTime, index, localTime);
    }
}
