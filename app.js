import { detectSubject, smoothMask, setModelStatusCallback, loadModel } from './saliency.js?v=16';
import { AudioEngine } from './audio.js?v=16';
import { CollageRenderer } from './renderer.js?v=16';
import {
    openDb,
    getProjects,
    saveProject,
    getProject,
    deleteProject,
    getSlides,
    saveSlides
} from './db.js?v=16';

// Application State
const state = {
    activeProjectId: null,
    isSaving: false,
    isLoadingProject: false,
    slides: [],         // Array of { id, img, mask, cutout, text }
    activeSlideIdx: 0,
    currentStep: 1,
    isPlaying: false,
    playTime: 0,
    isRecording: false,
    
    // Customize Settings
    style: 'clean',
    borderType: 'none',
    bgPalette: 'dark',
    slideDuration: 1.5,
    beatSync: true,
    musicTheme: 'desi_boyz',
    captionFont: 'playfair',
    
    // Editor State
    editorTool: 'brush', // 'brush', 'eraser', 'lasso'
    brushSize: 30,
    featherRadius: 4,
    autoSensitivity: 40,
    isDrawing: false,
    
    // Lasso (N-point polygon) state
    lassoPoints: [],         // [{x, y}] in canvas display coords
    lassoActive: false,      // lasso session in progress
    lassoMousePos: null,     // current mouse pos for live preview
    
    // Recording
    recorder: null,
    recordedChunks: [],
    
    // Image Preview Modal State
    previewActiveIdx: null,
    previewTab: 'orig',
    prevEditorTool: 'brush', // 'brush', 'eraser'
    prevBrushSize: 30,
    prevIsDrawing: false,
    prevLastX: undefined,
    prevLastY: undefined,
    
    // Preview Crop State
    cropRatio: 'free', // 'free', '1-1', '9-16', '16-9', '4-5'
    cropScale: 0.8,
    cropPercentX: 0.5, // Center X of crop box (0 to 1)
    cropPercentY: 0.5, // Center Y of crop box (0 to 1)
    isDraggingCrop: false,
    cropDragStartMouse: null,
    cropDragStartCenter: null,

    // Timing Settings
    cutoutHoldRatio: 0.35,

    // Custom Audio Settings
    customAudioStart: 0.0,
    customAudioEnd: null,
    musicVolume: 0.8,
    customAudioFileBlob: null,  // Uint8Array — the raw audio bytes stored in IndexedDB
    customAudioFilename: '',
    speedMode: 'manual',
    videoRatio: '9-16',
    
    // Thumbnail Designer State
    thumbnailMode: 'auto',        // 'auto' or 'manual'
    thumbnailCaption: '',         // Text overlay
    thumbnailFont: 'Dela Gothic One', 
    thumbnailFontSize: 60,
    thumbnailTextColor: '#ffffff',
    thumbnailStrokeColor: '#000000',
    thumbnailStrokeWidth: 6,
    thumbnailTextX: 50,           // Percent (0-100)
    thumbnailTextY: 80,           // Percent (0-100)
    thumbnailBgType: 'gradient',  // 'solid', 'gradient', 'blur', 'transparent'
    thumbnailBgColor: '#1e1e2e',
    thumbnailBgGradStart: '#ff4b8b',
    thumbnailBgGradEnd: '#2b1055',
    thumbnailBgBlurIdx: 0,        // Slide index for blurred photo bg
    thumbnailCutouts: [],         // Array of { slideId, x, y, scale, rotation, zIndex, visible }
    thumbnailDataUrl: null,        // Rendered PNG cover Data URL
    thumbnailTextFillType: 'solid', // 'solid' or 'gradient'
    thumbnailGradEnd: '#FFD700',    // Gradient end color for text
    thumbnailShadowStyle: 'retro3d' // 'none','deep','glow','retro3d','soft'
};

// Instantiate Modules
const audio = new AudioEngine();
let renderer = null;

// HTML Elements
const DOM = {
    // Nav steps
    stepBtns: document.querySelectorAll('.step-btn'),
    stepPanels: document.querySelectorAll('.step-panel'),
    
    // Step 1: Upload
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    uploadedSection: document.getElementById('uploaded-section'),
    photoGrid: document.getElementById('photo-grid'),
    photoCount: document.getElementById('photo-count'),
    clearAll: document.getElementById('clear-all-photos'),
    toStep2: document.getElementById('to-step-2'),
    
    // Step 2: Cutout Editor
    editorPhotoSelect: document.getElementById('editor-photo-select'),
    editorCanvas: document.getElementById('editor-canvas'),
    editorLoader: document.getElementById('editor-loader'),
    toolBrush: document.getElementById('tool-brush'),
    toolEraser: document.getElementById('tool-eraser'),
    toolMagic: document.getElementById('tool-magic'),
    toolClear: document.getElementById('tool-clear'),
    brushSizeSlider: document.getElementById('brush-size'),
    brushSizeVal: document.getElementById('brush-size-val'),
    autoSensSlider: document.getElementById('auto-sens'),
    autoSensVal: document.getElementById('auto-sens-val'),
    toStep3: document.getElementById('to-step-3'),
    backTo1: document.getElementById('back-to-1'),
    
    // Step 3: Customize
    styleCards: document.querySelectorAll('.style-card'),
    musicSelect: document.getElementById('music-track-select'),
    customAudioInput: document.getElementById('custom-audio-input'),
    beatSyncCheckbox: document.getElementById('beat-sync'),
    slideDurationSlider: document.getElementById('slide-duration'),
    slideDurVal: document.getElementById('slide-dur-val'),
    cutoutBorderSelect: document.getElementById('cutout-border-type'),
    bgStyleSelect: document.getElementById('bg-style'),
    captionFontSelect: document.getElementById('caption-font-select'),
    captionsContainer: document.getElementById('captions-container'),
    toStep4: document.getElementById('to-step-4'),
    backTo2: document.getElementById('back-to-2'),
    btnRotateRandom: document.getElementById('btn-rotate-random'),
    btnRotateReset: document.getElementById('btn-rotate-reset'),
    
    // Step 4: Export
    exportResolution: document.getElementById('export-resolution'),
    exportFormat: document.getElementById('export-format'),
    exportProgressArea: document.getElementById('export-progress-area'),
    exportProgressBar: document.getElementById('export-progress-bar'),
    exportStatusText: document.getElementById('export-status-text'),
    exportPercent: document.getElementById('export-percent'),
    btnStartExport: document.getElementById('btn-start-export'),
    btnCancelExport: document.getElementById('btn-cancel-export'),
    btnDownloadVideo: document.getElementById('btn-download-video'),
    backTo3: document.getElementById('back-to-3'),
    
    // AI Badge
    aiBadge: document.getElementById('ai-badge'),

    // Projects
    projectSelect: document.getElementById('project-select'),
    btnNewProject: document.getElementById('btn-new-project'),
    btnRenameProject: document.getElementById('btn-rename-project'),
    btnDeleteProject: document.getElementById('btn-delete-project'),

    // Preview Panel
    previewCanvas: document.getElementById('preview-canvas'),
    hudStyleTag: document.getElementById('hud-style-tag'),
    hudCounter: document.getElementById('hud-counter'),
    hudPlayBtn: document.getElementById('hud-play-btn'),
    hudProgressFill: document.getElementById('hud-progress-fill'),
    hudTimeVal: document.getElementById('hud-time-val'),
    musicIndicator: document.getElementById('music-indicator'),

    // Image Preview Modal
    previewModal: document.getElementById('preview-modal'),
    previewModalOverlay: document.getElementById('preview-modal-overlay'),
    previewModalClose: document.getElementById('preview-modal-close'),
    tabPreviewOrig: document.getElementById('tab-preview-orig'),
    tabPreviewCutout: document.getElementById('tab-preview-cutout'),
    tabPreviewCrop: document.getElementById('tab-preview-crop'),
    btnPreviewPrev: document.getElementById('btn-preview-prev'),
    btnPreviewNext: document.getElementById('btn-preview-next'),
    previewModalImgOrig: document.getElementById('preview-modal-img-orig'),
    previewModalCanvasCutout: document.getElementById('preview-modal-canvas-cutout'),
    previewModalCanvasCrop: document.getElementById('preview-modal-canvas-crop'),
    previewImageContainer: document.querySelector('.preview-image-container'),
    previewModalCounter: document.getElementById('preview-modal-counter'),
    previewModalCaption: document.getElementById('preview-modal-caption'),
    
    // Preview modal cutout editor selectors
    previewModalEditorControls: document.getElementById('preview-modal-editor-controls'),
    prevToolBrush: document.getElementById('prev-tool-brush'),
    prevToolEraser: document.getElementById('prev-tool-eraser'),
    prevToolMagic: document.getElementById('prev-tool-magic'),
    prevToolClear: document.getElementById('prev-tool-clear'),
    prevBrushSizeSlider: document.getElementById('prev-brush-size'),
    prevBrushSizeVal: document.getElementById('prev-brush-size-val'),
    prevBrushToolIndicator: document.getElementById('prev-brush-tool-indicator'),
    
    // Preview modal crop selectors
    previewModalCropControls: document.getElementById('preview-modal-crop-controls'),
    btnPrevCropApply: document.getElementById('btn-prev-crop-apply'),
    btnCropFree: document.getElementById('btn-crop-free'),
    btnCrop1_1: document.getElementById('btn-crop-1-1'),
    btnCrop9_16: document.getElementById('btn-crop-9-16'),
    btnCrop16_9: document.getElementById('btn-crop-16-9'),
    btnCrop4_5: document.getElementById('btn-crop-4-5'),
    cropScaleSlider: document.getElementById('crop-scale-slider'),
    cropScaleVal: document.getElementById('crop-scale-val'),
    
    // HUD Timeline seek controllers
    hudProgressBar: document.getElementById('hud-progress-bar'),
    hudRewindBtn: document.getElementById('hud-rewind-btn'),
    hudForwardBtn: document.getElementById('hud-forward-btn'),

    // Timing Settings
    cutoutHoldSlider: document.getElementById('cutout-hold'),
    cutoutHoldVal: document.getElementById('cutout-hold-val'),
    speedModeManual: document.getElementById('speed-mode-manual'),
    speedModeAuto: document.getElementById('speed-mode-auto'),

    // Custom Audio Editor
    btnUploadMusic: document.getElementById('btn-upload-music'),
    customAudioEditor: document.getElementById('custom-audio-editor'),
    audioFilenameBadge: document.getElementById('audio-filename-badge'),
    musicVolumeSlider: document.getElementById('music-volume-slider'),
    musicVolumeVal: document.getElementById('music-volume-val'),
    musicVolumeContainer: document.getElementById('music-volume-container'),
    audioStartSlider: document.getElementById('audio-start-slider'),
    audioStartVal: document.getElementById('audio-start-val'),
    audioEndSlider: document.getElementById('audio-end-slider'),
    audioEndVal: document.getElementById('audio-end-val'),

    // Timing Settings Info Banner & Triggers
    timingInfoBox: document.getElementById('timing-info-box'),
    timingInfoClose: document.getElementById('timing-info-close'),
    timingInfoTitle: document.getElementById('timing-info-title'),
    timingInfoDesc: document.getElementById('timing-info-desc'),
    infoBtnDuration: document.getElementById('info-btn-duration'),
    infoBtnHold: document.getElementById('info-btn-hold'),
    videoAspectRatio: document.getElementById('video-aspect-ratio'),
    
    // GPT Poster settings
    btnOpenGptModal: document.getElementById('btn-open-gpt-modal'),
    gptPromptModal: document.getElementById('gpt-prompt-modal'),
    gptPromptModalClose: document.getElementById('gpt-prompt-modal-close'),
    gptPromptModalOverlay: document.getElementById('gpt-prompt-modal-overlay'),
    gptCutoutList: document.getElementById('gpt-cutout-list'),
    gptCutoutCount: document.getElementById('gpt-cutout-count'),
    btnGptSelectAll: document.getElementById('btn-gpt-select-all'),
    btnGptDeselectAll: document.getElementById('btn-gpt-deselect-all'),
    gptCaptionInput: document.getElementById('gpt-caption-input'),
    gptFontStyleSelect: document.getElementById('gpt-font-style-select'),
    gptLayoutStyleSelect: document.getElementById('gpt-layout-style-select'),
    gptPromptOutput: document.getElementById('gpt-prompt-output'),
    btnGptDownloadImages: document.getElementById('btn-gpt-download-images'),
    btnGptCopyPrompt: document.getElementById('btn-gpt-copy-prompt'),
    posterUploadInput: document.getElementById('poster-upload-input'),
    btnUploadPoster: document.getElementById('btn-upload-poster'),
    posterPreviewImg: document.getElementById('poster-preview-img'),
    posterPreviewPlaceholder: document.getElementById('poster-preview-placeholder'),
    gptAutoDownloadZip: document.getElementById('gpt-auto-download-zip'),
    renderedVideoPreviewWrapper: document.getElementById('rendered-video-preview-wrapper'),
    renderedVideoPlayer: document.getElementById('rendered-video-player')
};

// Canvas context for manual cutout editor
let edCtx = null;
let edImage = null; // Currently editing Image object

// Page Load Initialization
window.addEventListener('DOMContentLoaded', () => {
    // Initialize Renderer
    renderer = new CollageRenderer(DOM.previewCanvas);
    edCtx = DOM.editorCanvas.getContext('2d');
    
    // Setup Accordions
    setupAccordions();
    
    // Setup Event Listeners
    setupEventListeners();
    
    // Hook up AI model status → badge updates
    setModelStatusCallback((status) => {
        const badge = DOM.aiBadge;
        badge.className = 'ai-badge';
        if (status === 'loading') {
            badge.classList.add('badge-loading');
            badge.textContent = 'AI Loading...';
        } else if (status === 'ready') {
            badge.classList.add('badge-ready');
            badge.textContent = '✓ AI Ready';
        } else if (status === 'error') {
            badge.classList.add('badge-error');
            badge.textContent = 'AI (Heuristic)';
            badge.title = 'Could not load AI model. Using fast heuristic fallback.';
        }
    });
    
    // Initialize local database and projects list
    initProjects().catch(err => console.error('[app] Initialization failed:', err));
    
    // Warm up the AI model on startup
    loadModel().catch(() => {});
    
    // Start Canvas animation tick
    requestAnimationFrame(animationTick);
    
    // Init Lucide icons — poll until lucide library is ready (CDN load timing)
    function initLucide() {
        if (window.lucide) {
            lucide.createIcons();
        } else {
            let tries = 0;
            const poll = setInterval(() => {
                if (window.lucide) {
                    clearInterval(poll);
                    lucide.createIcons();
                } else if (++tries > 30) {
                    clearInterval(poll);
                }
            }, 100);
        }
    }
    initLucide();
    
    // When beat detection finishes (after audio load), re-sync speed if in auto mode
    window.addEventListener('audio-beat-detected', (e) => {
        if (state.speedMode === 'auto') {
            syncSpeedToBeats();
        }
    });
});

// Setup simple Accordion toggle logic
function setupAccordions() {
    document.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const item = header.parentElement;
            const isExpanded = item.classList.contains('expanded');
            
            // Collapse all
            document.querySelectorAll('.accordion-item').forEach(i => i.classList.remove('expanded'));
            
            // Expand clicked if not already expanded
            if (!isExpanded) {
                item.classList.add('expanded');
            }
        });
    });
}

// Generate procedurally styled placeholder photos
function loadMockImages() {
    const mockTypes = ['mountain', 'pet', 'friend', 'cafe', 'sunflower'];
    const mockCaptions = ['Mountain Peak', 'My Buddy', 'Chill Vibes', 'Cozy Café', 'Summer Glow'];
    
    let loadedCount = 0;
    
    // Warm up the AI model in background while mock images are generated
    // so it's ready by the time users upload their own photos.
    loadModel().catch(() => {}); // Errors are handled internally with fallback

    mockTypes.forEach((type, idx) => {
        const mockCanvas = document.createElement('canvas');
        mockCanvas.width = 600;
        mockCanvas.height = 600;
        const ctx = mockCanvas.getContext('2d');
        
        // Background Gradient
        const grad = ctx.createLinearGradient(0, 0, 600, 600);
        if (type === 'mountain') {
            grad.addColorStop(0, '#ff7e5f');
            grad.addColorStop(1, '#feb47b');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 600, 600);
            
            // Silhouette: Mountain
            ctx.fillStyle = '#2c3e50';
            ctx.beginPath();
            ctx.moveTo(100, 480);
            ctx.lineTo(300, 160);
            ctx.lineTo(500, 480);
            ctx.closePath();
            ctx.fill();
        } 
        else if (type === 'pet') {
            grad.addColorStop(0, '#654ea3');
            grad.addColorStop(1, '#eaafc8');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 600, 600);
            
            // Silhouette: Cute Cat
            ctx.fillStyle = '#1e0b36';
            ctx.beginPath();
            // Cat body
            ctx.arc(300, 380, 120, 0, Math.PI * 2);
            ctx.fill();
            // Head
            ctx.beginPath();
            ctx.arc(300, 240, 80, 0, Math.PI * 2);
            ctx.fill();
            // Ears
            ctx.beginPath();
            ctx.moveTo(230, 200);
            ctx.lineTo(210, 110);
            ctx.lineTo(280, 180);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(370, 200);
            ctx.lineTo(390, 110);
            ctx.lineTo(320, 180);
            ctx.closePath();
            ctx.fill();
        } 
        else if (type === 'friend') {
            grad.addColorStop(0, '#11998e');
            grad.addColorStop(1, '#38ef7d');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 600, 600);
            
            // Silhouette: Person jumping
            ctx.fillStyle = '#0b4f3b';
            ctx.beginPath();
            // Head
            ctx.arc(300, 200, 35, 0, Math.PI * 2);
            // Body
            ctx.moveTo(300, 235);
            ctx.lineTo(300, 380);
            // Arms
            ctx.moveTo(300, 260);
            ctx.lineTo(210, 180);
            ctx.moveTo(300, 260);
            ctx.lineTo(390, 180);
            // Legs
            ctx.moveTo(300, 380);
            ctx.lineTo(240, 480);
            ctx.moveTo(300, 380);
            ctx.lineTo(360, 480);
            ctx.lineWidth = 24;
            ctx.lineCap = 'round';
            ctx.stroke();
        } 
        else if (type === 'cafe') {
            grad.addColorStop(0, '#e65c00');
            grad.addColorStop(1, '#F9D423');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 600, 600);
            
            // Silhouette: Coffee Cup
            ctx.fillStyle = '#4a2306';
            ctx.beginPath();
            ctx.roundRect(200, 280, 200, 160, [0, 0, 80, 80]);
            ctx.fill();
            // Handle
            ctx.strokeStyle = '#4a2306';
            ctx.lineWidth = 20;
            ctx.beginPath();
            ctx.arc(400, 350, 40, -Math.PI/2, Math.PI/2);
            ctx.stroke();
            // Steam
            ctx.beginPath();
            ctx.moveTo(250, 250);
            ctx.bezierCurveTo(240, 200, 270, 200, 260, 150);
            ctx.moveTo(300, 250);
            ctx.bezierCurveTo(290, 200, 320, 200, 310, 150);
            ctx.lineWidth = 8;
            ctx.lineCap = 'round';
            ctx.stroke();
        } 
        else if (type === 'sunflower') {
            grad.addColorStop(0, '#833ab4');
            grad.addColorStop(1, '#fd1d1d');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 600, 600);
            
            // Silhouette: Sunflower
            ctx.fillStyle = '#fdbb2d';
            const numPetals = 12;
            ctx.save();
            ctx.translate(300, 300);
            for (let i = 0; i < numPetals; i++) {
                ctx.rotate(Math.PI * 2 / numPetals);
                ctx.beginPath();
                ctx.ellipse(120, 0, 60, 25, 0, 0, Math.PI*2);
                ctx.fill();
            }
            // Flower Center
            ctx.fillStyle = '#3e1700';
            ctx.beginPath();
            ctx.arc(0, 0, 75, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        
        const dataUrl = mockCanvas.toDataURL();
        const img = new Image();
        img.onload = () => {
            detectSubject(img, 0.4).then(mask => {
                state.slides.push({
                    id: 'mock-' + type,
                    img: img,
                    mask: mask,
                    cutout: null, // will be generated by renderer
                    text: mockCaptions[idx],
                    rotation: (Math.random() - 0.5) * 8 * Math.PI / 180, // Random -4 to +4 degrees
                    isMock: true // demo placeholder — skip ratio badge
                });
                
                loadedCount++;
                if (loadedCount === mockTypes.length) {
                    onPhotosUpdated();
                    enableNextSteps();
                }
            });
        };
        img.src = dataUrl;
    });
}

// ─── UI Utilities ─────────────────────────────────────────────────────────────

/**
 * Show a brief toast notification at the bottom of the screen.
 */
function showToast(message, duration = 3000) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove('visible'), duration);
}

// ─── Database Helpers & Project Serialization ──────────────────────────────────

function canvasFromImage(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
}

function canvasToBlob(canvas, type = 'image/png') {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), type);
    });
}

function imageToBlob(img) {
    return new Promise((resolve) => {
        const c = canvasFromImage(img);
        c.toBlob((blob) => resolve(blob), 'image/png');
    });
}

function blobToImage(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = url;
    });
}

async function blobToCanvas(blob) {
    const img = await blobToImage(blob);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return canvas;
}

let autosaveTimeout = null;
function triggerAutosave() {
    if (state.isLoadingProject || !state.activeProjectId) return;
    if (autosaveTimeout) clearTimeout(autosaveTimeout);
    autosaveTimeout = setTimeout(async () => {
        await saveCurrentProjectToDb();
    }, 1000); // debounce by 1 second
}

/**
 * Saves ONLY project settings + audio metadata (no slides).
 * Fast and safe — used immediately after audio upload so audio is never lost on refresh.
 */
async function saveProjectSettingsOnly() {
    if (!state.activeProjectId) {
        console.warn('[app] saveProjectSettingsOnly: no activeProjectId');
        return;
    }
    try {
        const projectRecord = {
            id: state.activeProjectId,
            name: DOM.projectSelect.options[DOM.projectSelect.selectedIndex]?.text || 'Untitled Project',
            audioBlob: state.customAudioFileBlob || null,
            audioFilename: state.customAudioFilename || '',
            settings: {
                style: state.style,
                borderType: state.borderType,
                bgPalette: state.bgPalette,
                slideDuration: state.slideDuration,
                beatSync: state.beatSync,
                musicTheme: state.musicTheme,
                cutoutHoldRatio: state.cutoutHoldRatio,
                customAudioStart: state.customAudioStart,
                customAudioEnd: state.customAudioEnd,
                musicVolume: state.musicVolume,
                speedMode: state.speedMode,
                videoRatio: state.videoRatio,
                captionFont: state.captionFont,
                thumbnailMode: state.thumbnailMode,
                thumbnailCaption: state.thumbnailCaption,
                thumbnailFont: state.thumbnailFont,
                thumbnailFontSize: state.thumbnailFontSize,
                thumbnailTextColor: state.thumbnailTextColor,
                thumbnailStrokeColor: state.thumbnailStrokeColor,
                thumbnailStrokeWidth: state.thumbnailStrokeWidth,
                thumbnailTextX: state.thumbnailTextX,
                thumbnailTextY: state.thumbnailTextY,
                thumbnailBgType: state.thumbnailBgType,
                thumbnailBgColor: state.thumbnailBgColor,
                thumbnailBgGradStart: state.thumbnailBgGradStart,
                thumbnailBgGradEnd: state.thumbnailBgGradEnd,
                thumbnailBgBlurIdx: state.thumbnailBgBlurIdx,
                thumbnailCutouts: state.thumbnailCutouts,
                thumbnailDataUrl: state.thumbnailDataUrl,
                thumbnailTextFillType: state.thumbnailTextFillType,
                thumbnailGradEnd: state.thumbnailGradEnd,
                thumbnailShadowStyle: state.thumbnailShadowStyle
            }
        };
        await saveProject(projectRecord);
        console.info('[app] Project settings + audio saved ✓', {
            audioBytes: state.customAudioFileBlob?.byteLength || state.customAudioFileBlob?.size || 0,
            theme: state.musicTheme
        });
    } catch (e) {
        console.error('[app] saveProjectSettingsOnly failed:', e);
    }
}

async function saveCurrentProjectToDb() {
    if (!state.activeProjectId) return;
    state.isSaving = true;

    try {
        const projectRecord = {
            id: state.activeProjectId,
            name: DOM.projectSelect.options[DOM.projectSelect.selectedIndex]?.text || 'Untitled Project',
            audioBlob: state.customAudioFileBlob || null,
            audioFilename: state.customAudioFilename || '',
            settings: {
                style: state.style,
                borderType: state.borderType,
                bgPalette: state.bgPalette,
                slideDuration: state.slideDuration,
                beatSync: state.beatSync,
                musicTheme: state.musicTheme,
                cutoutHoldRatio: state.cutoutHoldRatio,
                customAudioStart: state.customAudioStart,
                customAudioEnd: state.customAudioEnd,
                musicVolume: state.musicVolume,
                speedMode: state.speedMode,
                videoRatio: state.videoRatio,
                captionFont: state.captionFont,
                thumbnailMode: state.thumbnailMode,
                thumbnailCaption: state.thumbnailCaption,
                thumbnailFont: state.thumbnailFont,
                thumbnailFontSize: state.thumbnailFontSize,
                thumbnailTextColor: state.thumbnailTextColor,
                thumbnailStrokeColor: state.thumbnailStrokeColor,
                thumbnailStrokeWidth: state.thumbnailStrokeWidth,
                thumbnailTextX: state.thumbnailTextX,
                thumbnailTextY: state.thumbnailTextY,
                thumbnailBgType: state.thumbnailBgType,
                thumbnailBgColor: state.thumbnailBgColor,
                thumbnailBgGradStart: state.thumbnailBgGradStart,
                thumbnailBgGradEnd: state.thumbnailBgGradEnd,
                thumbnailBgBlurIdx: state.thumbnailBgBlurIdx,
                thumbnailCutouts: state.thumbnailCutouts,
                thumbnailDataUrl: state.thumbnailDataUrl,
                thumbnailTextFillType: state.thumbnailTextFillType,
                thumbnailGradEnd: state.thumbnailGradEnd,
                thumbnailShadowStyle: state.thumbnailShadowStyle
            }
        };
        await saveProject(projectRecord);

        const serializedSlides = [];
        for (const slide of state.slides) {
            let imgBlob;
            if (slide.img.src.startsWith('blob:') || slide.img.src.startsWith('data:')) {
                const resp = await fetch(slide.img.src);
                imgBlob = await resp.blob();
            } else {
                imgBlob = await imageToBlob(slide.img);
            }

            const maskBlob = await canvasToBlob(slide.mask);

            serializedSlides.push({
                id: slide.id,
                imgBlob,
                maskBlob,
                text: slide.text,
                rotation: slide.rotation
            });
        }

        await saveSlides(state.activeProjectId, serializedSlides);
        console.info('[app] Project autosaved ✓');
    } catch (e) {
        console.error('[app] Autosave failed:', e);
    } finally {
        state.isSaving = false;
    }
}

async function loadProject(projectId) {
    if (typeof closePreviewModal === 'function' && state.previewActiveIdx !== null) {
        closePreviewModal();
    }
    state.isLoadingProject = true;
    const project = await getProject(projectId);
    if (!project) {
        state.isLoadingProject = false;
        return;
    }

    state.activeProjectId = projectId;
    state.isPlaying = false;
    state.playTime = 0;
    if (renderer) {
        renderer.isPlaying = false;
    }

    if (project.settings) {
        state.style = project.settings.style || 'clean';
        state.borderType = project.settings.borderType || 'none';
        state.bgPalette = project.settings.bgPalette || 'dark';
        state.slideDuration = project.settings.slideDuration || 1.5;
        state.beatSync = project.settings.beatSync !== false;
        state.musicTheme = project.settings.musicTheme || 'lofi';
        state.cutoutHoldRatio = project.settings.cutoutHoldRatio || 0.35;
        state.customAudioStart = project.settings.customAudioStart || 0.0;
        state.customAudioEnd = project.settings.customAudioEnd || null;
        state.musicVolume = project.settings.musicVolume !== undefined ? project.settings.musicVolume : 0.8;
        state.speedMode = project.settings.speedMode || 'manual';
        state.videoRatio = project.settings.videoRatio || '9-16';
        state.captionFont = project.settings.captionFont || 'playfair';

        // Restore GPT Poster designer settings
        state.gptPosterCaption = project.settings.gptPosterCaption || '';
        state.gptFontStyle = project.settings.gptFontStyle || 'aesthetic bold & chunky font, with thick hand-drawn borders';
        state.gptLayoutStyle = project.settings.gptLayoutStyle || 'overlapping layered scrapbook layout, with retro polaroid photo frames and warm indie vibes';
        state.gptSelectedCutouts = project.settings.gptSelectedCutouts || [];
        state.thumbnailDataUrl = project.settings.thumbnailDataUrl || null;

        if (DOM.gptCaptionInput) DOM.gptCaptionInput.value = state.gptPosterCaption;
        if (DOM.gptFontStyleSelect) DOM.gptFontStyleSelect.value = state.gptFontStyle;
        if (DOM.gptLayoutStyleSelect) DOM.gptLayoutStyleSelect.value = state.gptLayoutStyle;
        updatePosterPreviewUI();

        // Apply volume to AudioEngine immediately on project load (tracks volume state internally)
        audio.setVolume(state.musicVolume);

        if (DOM.slideDurationSlider) {
            DOM.slideDurationSlider.value = state.slideDuration;
            DOM.slideDurVal.textContent = state.slideDuration + 's';
        }
        if (DOM.cutoutHoldSlider) {
            DOM.cutoutHoldSlider.value = Math.round(state.cutoutHoldRatio * 100);
            DOM.cutoutHoldVal.textContent = Math.round(state.cutoutHoldRatio * 100) + '%';
        }
        if (DOM.musicSelect) {
            DOM.musicSelect.value = state.musicTheme;
        }
        if (DOM.btnUploadMusic) {
            DOM.btnUploadMusic.style.display = state.musicTheme === 'custom' ? 'flex' : 'none';
            if (state.musicTheme === 'custom' && !project.audioBlob) {
                DOM.btnUploadMusic.classList.add('pulse-highlight');
            } else {
                DOM.btnUploadMusic.classList.remove('pulse-highlight');
            }
        }
        if (DOM.musicVolumeSlider) {
            DOM.musicVolumeSlider.value = Math.round(state.musicVolume * 100);
            DOM.musicVolumeVal.textContent = Math.round(state.musicVolume * 100) + '%';
        }
        if (DOM.musicVolumeContainer) {
            DOM.musicVolumeContainer.style.display = state.musicTheme === 'none' ? 'none' : 'block';
        }
        if (DOM.beatSyncCheckbox) {
            DOM.beatSyncCheckbox.checked = state.beatSync;
        }
        if (DOM.cutoutBorderSelect) {
            DOM.cutoutBorderSelect.value = state.borderType;
        }
        if (DOM.bgStyleSelect) {
            DOM.bgStyleSelect.value = state.bgPalette;
        }
        if (DOM.videoAspectRatio) {
            DOM.videoAspectRatio.value = state.videoRatio;
        }
        if (DOM.captionFontSelect) {
            DOM.captionFontSelect.value = state.captionFont;
        }

        updateSpeedModeUI();
        updateVideoAspectRatio();

        if (renderer) {
            renderer.slideDuration = state.slideDuration;
            renderer.cutoutHoldRatio = state.cutoutHoldRatio;
            renderer.beatSync = state.beatSync;
            renderer.bgPalette = state.bgPalette;
            renderer.borderType = state.borderType;
            renderer.captionFont = state.captionFont;
        }
    }

    const dbSlides = await getSlides(projectId);
    const loadedSlides = [];

    if (DOM.editorLoader) {
        DOM.editorLoader.style.display = 'flex';
        DOM.editorLoader.querySelector('p').textContent = 'Loading project data…';
    }

    try {
        for (const dbSlide of dbSlides) {
            const img = await blobToImage(dbSlide.imgBlob);
            const mask = await blobToCanvas(dbSlide.maskBlob);

            loadedSlides.push({
                id: dbSlide.id,
                img: img,
                mask: mask,
                cutout: null,
                text: dbSlide.text === 'Memory Moment' ? '' : dbSlide.text,
                rotation: dbSlide.rotation
            });
        }

        state.slides = loadedSlides;
        state.activeSlideIdx = 0;

        if (renderer) {
            renderer.setSlides(state.slides);
        }

        onPhotosUpdated();
        enableNextSteps();

        if (state.currentStep === 2) {
            loadSlideIntoEditor();
        }

        generateCaptionsEditor();

        // Restore custom audio if it exists in the loaded project
        // Restore custom audio — project.audioBlob is stored as Uint8Array in IndexedDB
        let storedAudio = project.audioBlob || null;
        // Normalize: IndexedDB may return an ArrayBuffer or Uint8Array depending on browser
        if (storedAudio instanceof ArrayBuffer) {
            storedAudio = new Uint8Array(storedAudio);
        }
        state.customAudioFileBlob = storedAudio;
        state.customAudioFilename = project.audioFilename || '';
        
        if (state.musicTheme === 'desi_boyz') {
            loadPredefinedSong();
        } else if (state.musicTheme === 'custom' && state.customAudioFileBlob) {
            const audioBytes = state.customAudioFileBlob?.byteLength || state.customAudioFileBlob?.size || 0;
            console.log('[app] Restoring audio from IndexedDB:', audioBytes, 'bytes, filename:', state.customAudioFilename);
            // Restore audio using the raw bytes
            audio.loadCustomAudioFile(state.customAudioFileBlob).then((decodedBuffer) => {
                audio.customAudioStart = state.customAudioStart;
                audio.customAudioEnd = state.customAudioEnd !== null ? state.customAudioEnd : decodedBuffer.duration;
                audio.setVolume(state.musicVolume);
                configureAudioEditorSliders(decodedBuffer.duration);
                // Update upload button state
                if (DOM.btnUploadMusic) DOM.btnUploadMusic.classList.remove('pulse-highlight');
                showToast(`🎵 Audio restored: ${state.customAudioFilename || 'Custom Audio'}`);
            }).catch(err => {
                console.error('[app] Failed to restore audio from IndexedDB:', err);
                if (DOM.customAudioEditor) DOM.customAudioEditor.style.display = 'none';
                // Mark audio as needing re-upload
                state.customAudioFileBlob = null;
                if (DOM.btnUploadMusic) DOM.btnUploadMusic.classList.add('pulse-highlight');
                showToast('⚠️ Could not restore audio — please re-upload your music file.');
            });
        } else {
            if (DOM.customAudioEditor) DOM.customAudioEditor.style.display = 'none';
            if (state.musicTheme === 'custom') {
                console.warn('[app] Theme is custom but no audioBlob found in DB.');
            }
        }
    } catch (e) {
        console.error('[app] Failed to deserialize project slides:', e);
    } finally {
        state.isLoadingProject = false;
        if (DOM.editorLoader) {
            DOM.editorLoader.style.display = 'none';
        }
        updateTimelineDisplay();
    }
}

async function createNewProject() {
    const name = prompt('Enter a name for the new project:', 'New Project');
    if (!name) return;

    const newId = Math.random().toString(36).substr(2, 9);
    const newProject = {
        id: newId,
        name: name.trim(),
        settings: {
            style: 'clean',
            borderType: 'none',
            bgPalette: 'dark',
            slideDuration: 1.5,
            beatSync: true,
            musicTheme: 'desi_boyz',
            musicVolume: 0.8,
            cutoutHoldRatio: 0.35,
            customAudioStart: 0.0,
            customAudioEnd: null,
            speedMode: 'manual',
            videoRatio: '9-16',
            captionFont: 'playfair'
        }
    };
    await saveProject(newProject);
    state.activeProjectId = newId;

    state.slides = [];
    state.customAudioFileBlob = null;
    state.customAudioFilename = '';
    state.customAudioStart = 0.0;
    state.customAudioEnd = null;
    state.speedMode = 'manual';
    state.videoRatio = '9-16';
    state.captionFont = 'playfair';
    state.musicTheme = 'desi_boyz';
    
    if (DOM.musicSelect) {
        DOM.musicSelect.value = 'desi_boyz';
    }
    
    if (renderer) renderer.setSlides([]);
    onPhotosUpdated();

    loadMockImages();
    loadPredefinedSong();

    await refreshProjectList();
    goToStep(1);
}

async function renameActiveProject() {
    if (!state.activeProjectId) return;
    const currentName = DOM.projectSelect.options[DOM.projectSelect.selectedIndex]?.text || '';
    const newName = prompt('Rename project:', currentName);
    if (!newName || newName.trim() === '' || newName.trim() === currentName) return;

    const project = await getProject(state.activeProjectId);
    if (project) {
        project.name = newName.trim();
        await saveProject(project);
        await refreshProjectList();
    }
}

async function deleteActiveProject() {
    if (!state.activeProjectId) return;

    const projects = await getProjects();
    if (projects.length <= 1) {
        alert('You must keep at least one project.');
        return;
    }

    const currentName = DOM.projectSelect.options[DOM.projectSelect.selectedIndex]?.text || '';
    if (!confirm(`Are you sure you want to delete "${currentName}"? This will delete all its images and edits forever.`)) {
        return;
    }

    await deleteProject(state.activeProjectId);

    const remaining = await getProjects();
    state.activeProjectId = remaining[0].id;

    await refreshProjectList();
    await loadProject(state.activeProjectId);
    goToStep(1);
}

async function refreshProjectList() {
    const projects = await getProjects();
    DOM.projectSelect.innerHTML = '';
    projects.forEach((proj) => {
        const opt = document.createElement('option');
        opt.value = proj.id;
        opt.textContent = proj.name;
        if (proj.id === state.activeProjectId) {
            opt.selected = true;
        }
        DOM.projectSelect.appendChild(opt);
    });
}

async function initProjects() {
    await openDb();
    const projects = await getProjects();

    if (projects.length === 0) {
        const defaultId = Math.random().toString(36).substr(2, 9);
        const defaultProject = {
            id: defaultId,
            name: 'My First Project',
            settings: {
                style: 'clean',
                borderType: 'none',
                bgPalette: 'dark',
                slideDuration: 1.5,
                beatSync: true,
                musicTheme: 'desi_boyz',
                captionFont: 'playfair'
            }
        };
        await saveProject(defaultProject);
        state.activeProjectId = defaultId;
        loadMockImages();
        
        // Fetch and load default song Subha Hone Na De
        loadPredefinedSong();
    } else {
        state.activeProjectId = projects[0].id;
        await loadProject(state.activeProjectId);
        if (state.slides.length === 0) {
            loadMockImages();
        }
    }

    await refreshProjectList();
}

// Triggered when file list changes
function onPhotosUpdated() {
    DOM.photoCount.textContent = state.slides.length;
    DOM.photoGrid.innerHTML = '';
    
    // Auto trim custom audio since total duration/slides count changed
    autoTrimCustomAudio();
    
    // Autosave slides state on any change
    triggerAutosave();
    
    state.slides.forEach((slide, idx) => {
        const item = document.createElement('div');
        item.className = 'photo-item';
        if (slide.processing) {
            item.classList.add('processing');
        }
        item.setAttribute('draggable', slide.processing ? 'false' : 'true');
        item.dataset.id = slide.id;
        
        let badgeHtml = `<span class="cutout-status-badge">Cutout</span>`;
        if (slide.processing) {
            badgeHtml = `
                <div class="photo-item-loader">
                    <div class="spinner-sm"></div>
                    <span>AI Cutout...</span>
                </div>
            `;
        }
        
        item.innerHTML = `
            <img src="${slide.img.src}" alt="Uploaded Photo">
            <button class="remove-btn" data-id="${slide.id}">✕</button>
            ${badgeHtml}
        `;
        
        // Drag and Drop Logic
        if (!slide.processing) {
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', slide.id);
                item.classList.add('dragging');
                // Timeout needed to allow CSS change to render while dragging
                setTimeout(() => item.style.opacity = '0.5', 0);
            });
            
            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                item.style.opacity = '1';
            });
        }
        
        // Delete button listener
        item.querySelector('.remove-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            state.slides = state.slides.filter(s => s.id !== slide.id);
            onPhotosUpdated();
            if (state.slides.length < 5) {
                DOM.toStep2.disabled = true;
            }
        });

        // Open preview modal on click (skipping delete button clicks)
        item.addEventListener('click', (e) => {
            if (e.target.closest('.remove-btn')) return;
            if (slide.processing) return;
            openPreviewModal(idx);
        });
        
        DOM.photoGrid.appendChild(item);
    });
    
    // Grid Drag Over Events
    if (!DOM.photoGrid.dataset.dragInit) {
        DOM.photoGrid.dataset.dragInit = "true";
        DOM.photoGrid.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingElement = DOM.photoGrid.querySelector('.dragging');
            if (!draggingElement) return;
            const target = e.target.closest('.photo-item');
            if (target && target !== draggingElement) {
                const box = target.getBoundingClientRect();
                const next = (e.clientX - box.left > box.width / 2) || (e.clientY - box.top > box.height / 2);
                DOM.photoGrid.insertBefore(draggingElement, next ? target.nextSibling : target);
            }
        });
        
        DOM.photoGrid.addEventListener('drop', (e) => {
            e.preventDefault();
            const draggingElement = DOM.photoGrid.querySelector('.dragging');
            if (!draggingElement) return;
            const currentOrderIds = Array.from(DOM.photoGrid.querySelectorAll('.photo-item')).map(el => el.dataset.id);
            state.slides = currentOrderIds.map(id => state.slides.find(s => s.id === id));
            onPhotosUpdated();
        });
    }
    
    const hasProcessing = state.slides.some(s => s.processing);
    if (state.slides.length >= 5 && !hasProcessing) {
        DOM.toStep2.disabled = false;
        DOM.uploadedSection.style.display = 'block';
    } else {
        DOM.toStep2.disabled = true;
        if (state.slides.length > 0) {
            DOM.uploadedSection.style.display = 'block';
        } else {
            DOM.uploadedSection.style.display = 'none';
        }
    }
    
    // Sync with renderer
    renderer.setSlides(state.slides);
    
    // Re-populate dropdown and captions editor
    populateCutoutSelector();
    generateCaptionsEditor();
    checkOutOfRatioPhotos();
    
    // Update bottom multi-track timeline display
    updateTimelineDisplay();
}

// Sync the bottom editor timeline with the state in real-time
function updateTimelineDisplay() {
    const videoTimeline = document.getElementById('timeline-video-cells');
    const textTimeline = document.getElementById('timeline-text-cells');
    const audioSegment = document.getElementById('timeline-audio-segment');
    
    if (videoTimeline) {
        videoTimeline.innerHTML = '';
        state.slides.forEach((slide, idx) => {
            const cell = document.createElement('div');
            cell.className = 'timeline-cell video-cell';
            cell.dataset.id = slide.id;
            cell.setAttribute('draggable', slide.processing ? 'false' : 'true');
            
            if (slide.processing) {
                cell.classList.add('processing');
                cell.innerHTML = `
                    <div class="cell-thumb-placeholder">⌛</div>
                    <span class="cell-label">Proc...</span>
                `;
            } else {
                cell.innerHTML = `
                    <img src="${slide.img.src}" class="cell-thumb">
                    <span class="cell-label">Photo ${idx + 1}</span>
                `;
                cell.style.cursor = 'pointer';
                
                // Drag start / end on timeline cell
                cell.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', slide.id);
                    cell.classList.add('dragging-cell');
                    // Small timeout to allow visual drag feedback to remain correct
                    setTimeout(() => cell.style.opacity = '0.5', 0);
                });
                
                cell.addEventListener('dragend', () => {
                    cell.classList.remove('dragging-cell');
                    cell.style.opacity = '1';
                });
                
                cell.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent timeline track container click trigger
                    state.playTime = idx * state.slideDuration;
                    if (renderer) {
                        renderer.draw(state.playTime);
                    }
                    updateHudTimeline(state.slides.length * state.slideDuration);
                    
                    // Select this photo in Step 2 if Step 2 is active
                    state.activeSlideIdx = idx;
                    if (state.currentStep === 2) {
                        if (DOM.editorPhotoSelect) {
                            DOM.editorPhotoSelect.value = idx;
                        }
                        loadSlideIntoEditor();
                    }
                });
                
                cell.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    openPreviewModal(idx);
                });
            }
            videoTimeline.appendChild(cell);
        });
    }
    
    if (textTimeline) {
        textTimeline.innerHTML = '';
        state.slides.forEach((slide, idx) => {
            const cell = document.createElement('div');
            cell.className = 'timeline-cell text-cell';
            const textVal = slide.text ? `"${slide.text}"` : '(No caption)';
            cell.innerHTML = `<span class="cell-text-bubble">${textVal}</span>`;
            if (!slide.processing) {
                cell.style.cursor = 'pointer';
                cell.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent timeline track container click trigger
                    state.playTime = idx * state.slideDuration;
                    if (renderer) {
                        renderer.draw(state.playTime);
                    }
                    updateHudTimeline(state.slides.length * state.slideDuration);
                    
                    // Select this photo in Step 2 if Step 2 is active
                    state.activeSlideIdx = idx;
                    if (state.currentStep === 2) {
                        if (DOM.editorPhotoSelect) {
                            DOM.editorPhotoSelect.value = idx;
                        }
                        loadSlideIntoEditor();
                    }
                });
                
                cell.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    openPreviewModal(idx);
                });
            }
            textTimeline.appendChild(cell);
        });
    }
    
    if (audioSegment) {
        let text = '🔇 No Backing Audio';
        if (state.musicTheme === 'lofi') {
            text = '🎵 Lofi Dream (Chill Synth)';
        } else if (state.musicTheme === 'desi_boyz') {
            text = '🎵 Subha Hone Na De (Desi Boyz)';
        } else if (state.musicTheme === 'custom') {
            text = `📁 Custom Audio: ${state.customAudioFilename || 'Loaded'}`;
        }
        audioSegment.textContent = text;
        
        // Dynamically align the audio track's width to match video cells length
        if (state.slides.length > 0) {
            const totalCellsWidth = state.slides.length * (70 + 6) - 6;
            audioSegment.style.width = totalCellsWidth + 'px';
        } else {
            audioSegment.style.width = '100%';
        }
    }
}

// Load pre-defined song (Subha Hone Na De)
function loadPredefinedSong() {
    showToast("🎵 Loading 'Subha Hone Na De'...");
    
    // Hide custom editor controls since it's a default song
    if (DOM.customAudioEditor) DOM.customAudioEditor.style.display = 'none';
    
    fetch('./Subha%20Hone%20Na%20De%20Desi%20Boyz%20128%20Kbps.mp3')
        .then(response => {
            if (!response.ok) throw new Error("Network response was not ok");
            return response.arrayBuffer();
        })
        .then(arrayBuffer => {
            return audio.loadCustomAudioFile(arrayBuffer);
        })
        .then(decodedBuffer => {
            audio.setTheme('desi_boyz'); // Override the theme to desi_boyz
            state.musicTheme = 'desi_boyz';
            
            // Set trim boundaries to full song by default
            audio.customAudioStart = 0;
            audio.customAudioEnd = decodedBuffer.duration;
            
            showToast("🎵 'Subha Hone Na De' loaded!");
            
            if (state.isPlaying) {
                audio.start(onAudioBeat);
            }
            
            if (state.speedMode === 'auto') {
                syncSpeedToBeats();
            } else {
                autoTrimCustomAudio();
            }
            updateTimelineDisplay();
            triggerAutosave();
        })
        .catch(err => {
            console.error("Failed to load Subha Hone Na De:", err);
            showToast("❌ Failed to load song.");
            // Revert to lofi
            state.musicTheme = 'lofi';
            if (DOM.musicSelect) DOM.musicSelect.value = 'lofi';
            audio.setTheme('lofi');
            if (state.isPlaying) {
                audio.start(onAudioBeat);
            }
            updateTimelineDisplay();
        });
}

function enableNextSteps() {
    const hasProcessing = state.slides.some(s => s.processing);
    DOM.stepBtns.forEach((btn, idx) => {
        if (idx > 0) {
            btn.disabled = (state.slides.length < 5 || hasProcessing);
        }
    });
}

// Populate Step 2 Dropdown
function populateCutoutSelector() {
    DOM.editorPhotoSelect.innerHTML = '';
    state.slides.forEach((slide, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `Image ${idx + 1}: ${slide.text || 'Untitled'}`;
        DOM.editorPhotoSelect.appendChild(opt);
    });
}

// Generate Step 3 caption inputs
function generateCaptionsEditor() {
    DOM.captionsContainer.innerHTML = '';
    state.slides.forEach((slide, idx) => {
        const item = document.createElement('div');
        item.className = 'caption-editor-item';
        item.innerHTML = `
            <div style="display: flex; flex-direction: column; width: 100%; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="caption-num">${idx + 1}</span>
                    <input type="text" class="caption-input" data-idx="${idx}" value="${slide.text}" placeholder="Enter caption text..." style="flex: 1;">
                </div>
                <div style="display: flex; align-items: center; gap: 8px; padding-left: 28px;">
                    <span style="font-size: 11px; color: var(--text-muted);">Rotation:</span>
                    <input type="range" class="rotation-slider custom-slider" data-idx="${idx}" min="-30" max="30" value="${Math.round((slide.rotation || 0) * 180 / Math.PI)}" style="flex: 1;">
                    <span class="rotation-val" data-idx="${idx}" style="font-size: 11px; width: 28px; text-align: right;">${Math.round((slide.rotation || 0) * 180 / Math.PI)}°</span>
                </div>
            </div>
        `;
        
        item.querySelector('.caption-input').addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.idx);
            state.slides[index].text = e.target.value;
            // Force re-update renderer references
            renderer.setSlides(state.slides);
            
            // Sync with editor dropdown label
            const option = DOM.editorPhotoSelect.options[index];
            if (option) {
                option.textContent = `Image ${index + 1}: ${e.target.value || 'Untitled'}`;
            }
            updateTimelineDisplay();
            triggerAutosave();
        });

        item.querySelector('.rotation-slider').addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.idx);
            const val = parseInt(e.target.value);
            state.slides[index].rotation = val * Math.PI / 180;
            item.querySelector('.rotation-val').textContent = val + '°';
            // Force re-update renderer references
            renderer.setSlides(state.slides);
            triggerAutosave();
        });
        
        DOM.captionsContainer.appendChild(item);
    });
}

// Event Listeners Setup
function setupEventListeners() {
    
    // Project Select dropdown change
    DOM.projectSelect.addEventListener('change', async (e) => {
        state.activeProjectId = e.target.value;
        await loadProject(state.activeProjectId);
    });

    // Project Actions
    DOM.btnNewProject.addEventListener('click', createNewProject);
    DOM.btnRenameProject.addEventListener('click', renameActiveProject);
    DOM.btnDeleteProject.addEventListener('click', deleteActiveProject);
    
    // Drag and Drop Zone
    DOM.dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        DOM.dropZone.classList.add('dragover');
    });
    
    DOM.dropZone.addEventListener('dragleave', () => {
        DOM.dropZone.classList.remove('dragover');
    });
    
    DOM.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        DOM.dropZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
    
    DOM.fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });
    
    DOM.clearAll.addEventListener('click', () => {
        state.slides = [];
        onPhotosUpdated();
    });

    // Step Nav Transitions
    DOM.stepBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const stepNum = parseInt(btn.dataset.step);
            goToStep(stepNum);
        });
    });

    // Step Action Buttons
    DOM.toStep2.addEventListener('click', () => goToStep(2));
    DOM.toStep3.addEventListener('click', () => goToStep(3));
    DOM.toStep4.addEventListener('click', () => goToStep(4));
    
    DOM.backTo1.addEventListener('click', () => goToStep(1));
    DOM.backTo2.addEventListener('click', () => goToStep(2));
    DOM.backTo3.addEventListener('click', () => goToStep(3));

    // Step 2 Editor Controls
    DOM.editorPhotoSelect.addEventListener('change', (e) => {
        state.activeSlideIdx = parseInt(e.target.value);
        loadSlideIntoEditor();
    });

    DOM.toolBrush.addEventListener('click', () => selectEditorTool('brush'));
    DOM.toolEraser.addEventListener('click', () => selectEditorTool('eraser'));
    
    const lassoBtn = document.getElementById('tool-lasso');
    if (lassoBtn) lassoBtn.addEventListener('click', () => selectEditorTool('lasso'));
    
    DOM.toolClear.addEventListener('click', () => {
        const slide = state.slides[state.activeSlideIdx];
        if (slide && slide.mask) {
            const ctx = slide.mask.getContext('2d');
            ctx.clearRect(0, 0, slide.mask.width, slide.mask.height);
            // Re-render cutout
            slide.cutout = renderer.generateCutout(slide.img, slide.mask);
            renderer.setSlides(state.slides);
            drawEditorFrame();
            triggerAutosave();
        }
    });

    DOM.toolMagic.addEventListener('click', () => {
        const slide = state.slides[state.activeSlideIdx];
        if (slide) {
            DOM.editorLoader.style.display = 'flex';
            // Show contextual loading message
            const loaderP = DOM.editorLoader.querySelector('p');
            const badge = DOM.aiBadge;
            if (badge.classList.contains('badge-ready')) {
                if (loaderP) loaderP.textContent = 'AI is extracting subject...';
            } else if (badge.classList.contains('badge-loading') || badge.classList.contains('badge-connecting')) {
                if (loaderP) loaderP.textContent = 'Downloading AI model (~30MB)...';
            } else {
                if (loaderP) loaderP.textContent = 'Extracting subject (fast mode)...';
            }
            detectSubject(slide.img, state.autoSensitivity / 100).then(mask => {
                slide.mask = mask;
                slide.cutout = renderer.generateCutout(slide.img, slide.mask);
                renderer.setSlides(state.slides);
                DOM.editorLoader.style.display = 'none';
                if (loaderP) loaderP.textContent = 'Extracting subject...';
                drawEditorFrame();
                triggerAutosave();
            });
        }
    });

    DOM.brushSizeSlider.addEventListener('input', (e) => {
        state.brushSize = parseInt(e.target.value);
        DOM.brushSizeVal.textContent = state.brushSize + 'px';
    });

    const featherSlider = document.getElementById('feather-radius');
    const featherVal    = document.getElementById('feather-val');
    if (featherSlider) {
        featherSlider.addEventListener('input', (e) => {
            state.featherRadius = parseInt(e.target.value);
            if (featherVal) featherVal.textContent = state.featherRadius + 'px';
        });
    }

    DOM.autoSensSlider.addEventListener('input', (e) => {
        state.autoSensitivity = parseInt(e.target.value);
        DOM.autoSensVal.textContent = state.autoSensitivity + '%';
    });

    // Step 2 Canvas Drawing Logic
    setupEditorDrawing();

    // Step 3 Collage Theme Cards
    DOM.styleCards.forEach(card => {
        card.addEventListener('click', () => {
            DOM.styleCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            state.style = card.dataset.style;
            renderer.activeStyle = state.style;
            DOM.hudStyleTag.textContent = card.querySelector('.style-card-title').textContent;
            triggerAutosave();
        });
    });

    // Beat Sync Toggle
    DOM.beatSyncCheckbox.addEventListener('change', (e) => {
        state.beatSync = e.target.checked;
        renderer.beatSync = state.beatSync;
        triggerAutosave();
    });

    // Settings
    DOM.slideDurationSlider.addEventListener('input', (e) => {
        state.slideDuration = parseFloat(e.target.value);
        DOM.slideDurVal.textContent = state.slideDuration.toFixed(1) + 's';
        renderer.slideDuration = state.slideDuration;
        autoTrimCustomAudio();
        triggerAutosave();
    });

    // Speed Mode Segmented Control
    if (DOM.speedModeManual && DOM.speedModeAuto) {
        DOM.speedModeManual.addEventListener('click', () => {
            state.speedMode = 'manual';
            updateSpeedModeUI();
            triggerAutosave();
        });
        DOM.speedModeAuto.addEventListener('click', () => {
            state.speedMode = 'auto';
            updateSpeedModeUI();
            triggerAutosave();
        });
    }

    // Timing slider listener
    DOM.cutoutHoldSlider.addEventListener('input', (e) => {
        state.cutoutHoldRatio = parseFloat(e.target.value) / 100;
        DOM.cutoutHoldVal.textContent = e.target.value + '%';
        renderer.cutoutHoldRatio = state.cutoutHoldRatio;
        triggerAutosave();
    });

    DOM.cutoutBorderSelect.addEventListener('change', (e) => {
        state.borderType = e.target.value;
        renderer.borderType = state.borderType;
        triggerAutosave();
    });

    DOM.bgStyleSelect.addEventListener('change', (e) => {
        state.bgPalette = e.target.value;
        renderer.bgPalette = state.bgPalette;
        triggerAutosave();
    });

    if (DOM.videoAspectRatio) {
        DOM.videoAspectRatio.addEventListener('change', (e) => {
            state.videoRatio = e.target.value;
            updateVideoAspectRatio();
            triggerAutosave();
        });
    }

    if (DOM.btnRotateRandom) {
        DOM.btnRotateRandom.addEventListener('click', () => {
            if (state.slides.length === 0) return;
            state.slides.forEach(slide => {
                // Random tilt between -10 and +10 degrees in radians
                slide.rotation = (Math.random() - 0.5) * (20 * Math.PI / 180);
            });
            triggerAutosave();
            if (renderer) {
                renderer.draw(state.playTime);
            }
            showToast("🎲 Randomly scattered all photos!", "success");
        });
    }

    if (DOM.btnRotateReset) {
        DOM.btnRotateReset.addEventListener('click', () => {
            if (state.slides.length === 0) return;
            state.slides.forEach(slide => {
                slide.rotation = 0;
            });
            triggerAutosave();
            if (renderer) {
                renderer.draw(state.playTime);
            }
            showToast("📐 Aligned all photos straight (0°)", "success");
        });
    }

    if (DOM.captionFontSelect) {
        DOM.captionFontSelect.addEventListener('change', (e) => {
            state.captionFont = e.target.value;
            if (renderer) renderer.captionFont = state.captionFont;
            triggerAutosave();
        });
    }

    // Music theme selector
    DOM.musicSelect.addEventListener('change', (e) => {
        state.musicTheme = e.target.value;
        
        // Show/hide select custom audio button
        if (DOM.btnUploadMusic) {
            DOM.btnUploadMusic.style.display = state.musicTheme === 'custom' ? 'flex' : 'none';
            if (state.musicTheme === 'custom' && !state.customAudioFileBlob) {
                DOM.btnUploadMusic.classList.add('pulse-highlight');
            } else {
                DOM.btnUploadMusic.classList.remove('pulse-highlight');
            }
        }
        
        if (state.musicTheme === 'desi_boyz') {
            loadPredefinedSong();
        } else if (state.musicTheme === 'custom') {
            if (state.customAudioFileBlob) {
                // Audio already loaded — show editor and resume playback
                DOM.customAudioEditor.style.display = 'flex';
                if (state.isPlaying) {
                    audio.start(onAudioBeat);
                }
            }
            // If no audio yet, user must click btn-upload-music (a direct user gesture)
            // We scroll to it and pulse it to draw attention
            if (DOM.btnUploadMusic) {
                DOM.btnUploadMusic.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        } else {
            if (DOM.customAudioEditor) DOM.customAudioEditor.style.display = 'none';
            audio.setTheme(state.musicTheme);
            if (state.isPlaying) {
                audio.start(onAudioBeat);
            }
        }
        if (DOM.musicVolumeContainer) {
            DOM.musicVolumeContainer.style.display = state.musicTheme === 'none' ? 'none' : 'block';
        }
        
        if (state.speedMode === 'auto') {
            syncSpeedToBeats();
        } else {
            autoTrimCustomAudio();
        }
        triggerAutosave();
    });

    if (DOM.btnUploadMusic) {
        DOM.btnUploadMusic.addEventListener('click', () => {
            // Direct user gesture — browser allows this programmatic click
            DOM.customAudioInput.value = ''; // reset so same file can be re-selected
            DOM.customAudioInput.click();
        });
    }

    DOM.customAudioInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (DOM.btnUploadMusic) {
            DOM.btnUploadMusic.classList.remove('pulse-highlight');
        }
        
        // Store Blob/File directly in IndexedDB (highly optimized, avoids size limits & memory bloat)
        state.customAudioFileBlob = file;
        state.customAudioFilename = file.name;
        
        // Save settings+audio IMMEDIATELY with a dedicated fast call 
        // (no slide serialization that could fail or be slow)
        saveProjectSettingsOnly().then(() => {
            console.log('[app] Audio saved to IndexedDB immediately ✓', file.size, 'bytes');
        });
        
        // Load the audio for playback — pass the file (engine handles decoding via FileReader)
        audio.loadCustomAudioFile(file).then((decodedBuffer) => {
            state.customAudioStart = 0;
            state.customAudioEnd = decodedBuffer.duration;
            
            audio.customAudioStart = state.customAudioStart;
            audio.customAudioEnd = state.customAudioEnd;
            audio.setVolume(state.musicVolume);
            
            configureAudioEditorSliders(decodedBuffer.duration);
            
            if (state.isPlaying) {
                audio.start(onAudioBeat);
            }
            
            // Show success toast
            showToast(`🎵 Audio saved: ${file.name}`);
        }).catch(err => {
            console.error('[app] Failed to decode custom audio:', err);
            showToast('⚠️ Could not decode audio file. Try a different format.');
        });
    });

    // Music Volume Slider Listeners (global)
    if (DOM.musicVolumeSlider) {
        DOM.musicVolumeSlider.addEventListener('input', (e) => {
            state.musicVolume = parseFloat(e.target.value) / 100;
            DOM.musicVolumeVal.textContent = e.target.value + '%';
            audio.setVolume(state.musicVolume);
        });

        DOM.musicVolumeSlider.addEventListener('change', () => {
            triggerAutosave();
        });
    }

    if (DOM.audioStartSlider) {
        DOM.audioStartSlider.addEventListener('input', (e) => {
            state.customAudioStart = parseFloat(e.target.value);
            autoTrimCustomAudio();
        });

        DOM.audioStartSlider.addEventListener('change', () => {
            audio.restartCustomBuffer();
            triggerAutosave();
        });
    }

    if (DOM.audioEndSlider) {
        DOM.audioEndSlider.disabled = true;
        DOM.audioEndSlider.style.opacity = '0.5';
    }

    // Timing Settings Info Banner Listeners
    if (DOM.infoBtnDuration) {
        DOM.infoBtnDuration.addEventListener('click', (e) => {
            e.preventDefault();
            DOM.timingInfoBox.style.display = 'flex';
            DOM.timingInfoTitle.textContent = "⏱️ Slide Duration";
            DOM.timingInfoDesc.textContent = "Controls the time each photo is shown in the video. In 'Manual' mode, drag the slider to change speed. In 'Auto Beat Sync' mode, the transition speed is locked to match the musical beats of the background track automatically.";
        });
    }

    if (DOM.infoBtnHold) {
        DOM.infoBtnHold.addEventListener('click', (e) => {
            e.preventDefault();
            DOM.timingInfoBox.style.display = 'flex';
            DOM.timingInfoTitle.textContent = "✨ Cutout Hold Duration";
            DOM.timingInfoDesc.textContent = "Controls the pause duration between the subject cutout appearing on a black background and the rest of the original photo fading in. A lower value (e.g. 10%) means the background appears almost instantly, while a higher value (e.g. 70%) keeps the cutout alone on screen for longer before the full photo is revealed.";
        });
    }

    if (DOM.timingInfoClose) {
        DOM.timingInfoClose.addEventListener('click', (e) => {
            e.preventDefault();
            DOM.timingInfoBox.style.display = 'none';
        });
    }

    // HUD Playback Controls
    DOM.hudPlayBtn.addEventListener('click', togglePlayback);
    
    // Export Actions
    DOM.btnStartExport.addEventListener('click', startExportingVideo);
    DOM.btnCancelExport.addEventListener('click', cancelExportingVideo);

    // Image Preview Modal Listeners
    DOM.previewModalClose.addEventListener('click', closePreviewModal);
    DOM.previewModalOverlay.addEventListener('click', closePreviewModal);
    
    DOM.tabPreviewOrig.addEventListener('click', () => {
        state.previewTab = 'orig';
        DOM.tabPreviewOrig.classList.add('active');
        DOM.tabPreviewCutout.classList.remove('active');
        updatePreviewContent();
    });
    
    DOM.tabPreviewCutout.addEventListener('click', () => {
        state.previewTab = 'cutout';
        DOM.tabPreviewCutout.classList.add('active');
        DOM.tabPreviewOrig.classList.remove('active');
        updatePreviewContent();
    });
    
    DOM.btnPreviewPrev.addEventListener('click', () => {
        if (state.previewActiveIdx > 0) {
            state.previewActiveIdx--;
            updatePreviewContent();
        }
    });
    
    DOM.btnPreviewNext.addEventListener('click', () => {
        if (state.previewActiveIdx < state.slides.length - 1) {
            state.previewActiveIdx++;
            updatePreviewContent();
        }
    });

    // HUD Playback seek / scrub controls
    if (DOM.hudProgressBar) {
        const handleSeek = (e) => {
            const rect = DOM.hudProgressBar.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const totalDuration = state.slides.length * state.slideDuration;
            state.playTime = percent * totalDuration;
            if (renderer) {
                renderer.draw(state.playTime);
            }
            updateHudTimeline(totalDuration);
        };
        
        DOM.hudProgressBar.addEventListener('mousedown', (e) => {
            handleSeek(e);
            const moveHandler = (moveEvent) => {
                handleSeek(moveEvent);
            };
            const upHandler = () => {
                window.removeEventListener('mousemove', moveHandler);
                window.removeEventListener('mouseup', upHandler);
            };
            window.addEventListener('mousemove', moveHandler);
            window.addEventListener('mouseup', upHandler);
        });

        DOM.hudProgressBar.addEventListener('touchstart', (e) => {
            handleSeek(e);
            const moveHandler = (moveEvent) => {
                handleSeek(moveEvent);
            };
            const upHandler = () => {
                window.removeEventListener('touchmove', moveHandler);
                window.removeEventListener('touchend', upHandler);
            };
            window.addEventListener('touchmove', moveHandler);
            window.addEventListener('touchend', upHandler);
        }, { passive: true });
    }

    // Timeline seek / scrub controls
    const timelineContainer = document.querySelector('.timeline-tracks-container');
    if (timelineContainer) {
        const handleTimelineSeek = (e) => {
            const rect = timelineContainer.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const relativeX = clientX - rect.left;
            
            // Ignore clicks on the sticky track info headers (130px width)
            if (relativeX <= 130) return;
            
            const scrollX = relativeX + timelineContainer.scrollLeft;
            const timelineX = scrollX - 130 - 16; // 130px header + 16px timeline padding
            
            const cellWidth = 70;
            const cellGap = 6;
            const pixelsPerSecond = (cellWidth + cellGap) / state.slideDuration;
            const targetTime = timelineX / pixelsPerSecond;
            const totalDuration = state.slides.length * state.slideDuration;
            
            state.playTime = Math.max(0, Math.min(totalDuration, targetTime));
            if (renderer) {
                renderer.draw(state.playTime);
            }
            updateHudTimeline(totalDuration);
        };
        
        timelineContainer.addEventListener('mousedown', (e) => {
            // Ignore if clicked on a button, input, or other interactive element directly
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
            handleTimelineSeek(e);
            
            const moveHandler = (moveEvent) => {
                handleTimelineSeek(moveEvent);
            };
            const upHandler = () => {
                window.removeEventListener('mousemove', moveHandler);
                window.removeEventListener('mouseup', upHandler);
            };
            window.addEventListener('mousemove', moveHandler);
            window.addEventListener('mouseup', upHandler);
        });
        
        timelineContainer.addEventListener('touchstart', (e) => {
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
            handleTimelineSeek(e);
            const moveHandler = (moveEvent) => {
                handleTimelineSeek(moveEvent);
            };
            const upHandler = () => {
                window.removeEventListener('touchmove', moveHandler);
                window.removeEventListener('touchend', upHandler);
            };
            window.addEventListener('touchmove', moveHandler);
            window.addEventListener('touchend', upHandler);
        }, { passive: true });
    }

    // Timeline Video Track Drag & Drop Reordering
    const videoTimeline = document.getElementById('timeline-video-cells');
    if (videoTimeline) {
        videoTimeline.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingElement = videoTimeline.querySelector('.dragging-cell');
            if (!draggingElement) return;
            const target = e.target.closest('.video-cell');
            if (target && target !== draggingElement) {
                const box = target.getBoundingClientRect();
                const next = (e.clientX - box.left > box.width / 2);
                videoTimeline.insertBefore(draggingElement, next ? target.nextSibling : target);
            }
        });
        
        videoTimeline.addEventListener('drop', (e) => {
            e.preventDefault();
            const draggingElement = videoTimeline.querySelector('.dragging-cell');
            if (!draggingElement) return;
            const currentOrderIds = Array.from(videoTimeline.querySelectorAll('.video-cell')).map(el => el.dataset.id);
            state.slides = currentOrderIds.map(id => state.slides.find(s => s.id === id));
            onPhotosUpdated();
        });
    }

    if (DOM.hudRewindBtn) {
        DOM.hudRewindBtn.addEventListener('click', () => {
            state.playTime = Math.max(0, state.playTime - 3);
            if (renderer) renderer.draw(state.playTime);
            const totalDuration = state.slides.length * state.slideDuration;
            updateHudTimeline(totalDuration);
        });
    }

    if (DOM.hudForwardBtn) {
        DOM.hudForwardBtn.addEventListener('click', () => {
            const totalDuration = state.slides.length * state.slideDuration;
            state.playTime = Math.min(totalDuration, state.playTime + 3);
            if (renderer) renderer.draw(state.playTime);
            updateHudTimeline(totalDuration);
        });
    }

    // Image Preview Modal Tab 3: Crop
    if (DOM.tabPreviewCrop) {
        DOM.tabPreviewCrop.addEventListener('click', () => {
            state.previewTab = 'crop';
            DOM.tabPreviewCrop.classList.add('active');
            DOM.tabPreviewOrig.classList.remove('active');
            DOM.tabPreviewCutout.classList.remove('active');
            updatePreviewContent();
        });
    }

    // Image Preview Modal Cutout Editor Controls
    if (DOM.prevToolBrush) {
        DOM.prevToolBrush.addEventListener('click', () => {
            state.prevEditorTool = 'brush';
            DOM.prevToolBrush.classList.add('active');
            DOM.prevToolEraser.classList.remove('active');
            if (DOM.prevBrushToolIndicator) DOM.prevBrushToolIndicator.textContent = "Mode: Brush (Reveal)";
        });
    }

    if (DOM.prevToolEraser) {
        DOM.prevToolEraser.addEventListener('click', () => {
            state.prevEditorTool = 'eraser';
            DOM.prevToolEraser.classList.add('active');
            DOM.prevToolBrush.classList.remove('active');
            if (DOM.prevBrushToolIndicator) DOM.prevBrushToolIndicator.textContent = "Mode: Eraser (Remove)";
        });
    }

    if (DOM.prevBrushSizeSlider) {
        DOM.prevBrushSizeSlider.addEventListener('input', (e) => {
            state.prevBrushSize = parseInt(e.target.value);
            DOM.prevBrushSizeVal.textContent = state.prevBrushSize + 'px';
        });
    }

    if (DOM.prevToolClear) {
        DOM.prevToolClear.addEventListener('click', () => {
            const slide = state.slides[state.previewActiveIdx];
            if (slide && slide.mask) {
                const ctx = slide.mask.getContext('2d');
                ctx.clearRect(0, 0, slide.mask.width, slide.mask.height);
                slide.cutout = renderer.generateCutout(slide.img, slide.mask);
                renderer.setSlides(state.slides);
                triggerAutosave();
                drawPreviewCutout();
                
                if (state.currentStep === 2 && state.activeSlideIdx === state.previewActiveIdx) {
                    loadSlideIntoEditor();
                }
            }
        });
    }

    if (DOM.prevToolMagic) {
        DOM.prevToolMagic.addEventListener('click', async () => {
            const slide = state.slides[state.previewActiveIdx];
            if (!slide) return;
            
            // Show loading overlay on cutout preview
            const canvas = DOM.previewModalCanvasCutout;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#ffffff';
            ctx.font = '14px Outfit';
            ctx.textAlign = 'center';
            ctx.fillText('AI is extracting subject...', canvas.width / 2, canvas.height / 2);
            
            try {
                const mask = await detectSubject(slide.img, 0.4);
                slide.mask = mask;
                slide.cutout = renderer.generateCutout(slide.img, slide.mask);
                renderer.setSlides(state.slides);
                triggerAutosave();
                drawPreviewCutout();
                
                if (state.currentStep === 2 && state.activeSlideIdx === state.previewActiveIdx) {
                    loadSlideIntoEditor();
                }
            } catch (err) {
                console.error("AI extraction failed in preview:", err);
                alert("AI segmentation failed. You can still manually paint/erase.");
                drawPreviewCutout();
            }
        });
    }

    // Image Preview Modal Canvas Cutout mouse/touch paint events
    if (DOM.previewModalCanvasCutout) {
        const getPrevCoords = (e) => {
            const canvas = DOM.previewModalCanvasCutout;
            const rect = canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: ((clientX - rect.left) / rect.width) * canvas.width,
                y: ((clientY - rect.top) / rect.height) * canvas.height
            };
        };
        
        const prevPaint = (e) => {
            if (!state.prevIsDrawing) return;
            e.preventDefault();
            
            const slide = state.slides[state.previewActiveIdx];
            if (!slide) return;
            
            const coords = getPrevCoords(e);
            const mCtx = slide.mask.getContext('2d');
            const brushPx = state.prevBrushSize;
            
            mCtx.save();
            mCtx.lineCap = 'round';
            mCtx.lineJoin = 'round';
            mCtx.lineWidth = brushPx;
            
            if (state.prevEditorTool === 'brush') {
                mCtx.globalCompositeOperation = 'source-over';
                mCtx.strokeStyle = '#ffffff';
                mCtx.fillStyle = '#ffffff';
            } else {
                mCtx.globalCompositeOperation = 'destination-out';
                mCtx.strokeStyle = 'rgba(0,0,0,1)';
                mCtx.fillStyle = 'rgba(0,0,0,1)';
            }
            
            mCtx.beginPath();
            if (state.prevLastX !== undefined) {
                mCtx.moveTo(state.prevLastX, state.prevLastY);
                mCtx.lineTo(coords.x, coords.y);
                mCtx.stroke();
            } else {
                mCtx.arc(coords.x, coords.y, brushPx / 2, 0, Math.PI * 2);
                mCtx.fill();
            }
            mCtx.restore();
            
            state.prevLastX = coords.x;
            state.prevLastY = coords.y;
            
            drawPreviewCutout();
        };
        
        const prevStartPainting = (e) => {
            state.prevIsDrawing = true;
            state.prevLastX = undefined;
            state.prevLastY = undefined;
            prevPaint(e);
        };
        
        const prevStopPainting = () => {
            if (!state.prevIsDrawing) return;
            state.prevIsDrawing = false;
            state.prevLastX = undefined;
            state.prevLastY = undefined;
            
            const slide = state.slides[state.previewActiveIdx];
            if (slide) {
                slide.cutout = renderer.generateCutout(slide.img, slide.mask);
                renderer.setSlides(state.slides);
                triggerAutosave();
                
                if (state.currentStep === 2 && state.activeSlideIdx === state.previewActiveIdx) {
                    loadSlideIntoEditor();
                }
            }
        };

        DOM.previewModalCanvasCutout.addEventListener('mousedown', prevStartPainting);
        DOM.previewModalCanvasCutout.addEventListener('mousemove', prevPaint);
        window.addEventListener('mouseup', prevStopPainting);
        
        DOM.previewModalCanvasCutout.addEventListener('touchstart', prevStartPainting, { passive: false });
        DOM.previewModalCanvasCutout.addEventListener('touchmove', prevPaint, { passive: false });
        window.addEventListener('touchend', prevStopPainting);
    }

    // Image Preview Modal Canvas Crop dragging and ratio selectors
    if (DOM.previewModalCanvasCrop) {
        const handleCropStart = (e) => {
            state.isDraggingCrop = true;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            state.cropDragStartMouse = { x: clientX, y: clientY };
            state.cropDragStartCenter = { x: state.cropPercentX, y: state.cropPercentY };
        };

        const handleCropMove = (e) => {
            if (!state.isDraggingCrop) return;
            e.preventDefault();
            
            const canvas = DOM.previewModalCanvasCrop;
            const rect = canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            
            const dx = clientX - state.cropDragStartMouse.x;
            const dy = clientY - state.cropDragStartMouse.y;
            
            const pctDx = dx / rect.width;
            const pctDy = dy / rect.height;
            
            state.cropPercentX = state.cropDragStartCenter.x + pctDx;
            state.cropPercentY = state.cropDragStartCenter.y + pctDy;
            
            drawCropCanvas();
        };

        const handleCropEnd = () => {
            state.isDraggingCrop = false;
        };

        DOM.previewModalCanvasCrop.addEventListener('mousedown', handleCropStart);
        DOM.previewModalCanvasCrop.addEventListener('mousemove', handleCropMove);
        window.addEventListener('mouseup', handleCropEnd);

        DOM.previewModalCanvasCrop.addEventListener('touchstart', handleCropStart, { passive: false });
        DOM.previewModalCanvasCrop.addEventListener('touchmove', handleCropMove, { passive: false });
        window.addEventListener('touchend', handleCropEnd);
    }

    const selectCropRatio = (ratio, activeBtn) => {
        state.cropRatio = ratio;
        [DOM.btnCropFree, DOM.btnCrop1_1, DOM.btnCrop9_16, DOM.btnCrop16_9, DOM.btnCrop4_5].forEach(btn => {
            if (btn) btn.classList.remove('active');
        });
        if (activeBtn) activeBtn.classList.add('active');
        drawCropCanvas();
    };

    if (DOM.btnCropFree) DOM.btnCropFree.addEventListener('click', () => selectCropRatio('free', DOM.btnCropFree));
    if (DOM.btnCrop1_1) DOM.btnCrop1_1.addEventListener('click', () => selectCropRatio('1-1', DOM.btnCrop1_1));
    if (DOM.btnCrop9_16) DOM.btnCrop9_16.addEventListener('click', () => selectCropRatio('9-16', DOM.btnCrop9_16));
    if (DOM.btnCrop16_9) DOM.btnCrop16_9.addEventListener('click', () => selectCropRatio('16-9', DOM.btnCrop16_9));
    if (DOM.btnCrop4_5) DOM.btnCrop4_5.addEventListener('click', () => selectCropRatio('4-5', DOM.btnCrop4_5));

    if (DOM.cropScaleSlider) {
        DOM.cropScaleSlider.addEventListener('input', (e) => {
            state.cropScale = parseFloat(e.target.value) / 100;
            if (DOM.cropScaleVal) DOM.cropScaleVal.textContent = e.target.value + '%';
            drawCropCanvas();
        });
    }

    if (DOM.btnPrevCropApply) {
        DOM.btnPrevCropApply.addEventListener('click', applyCrop);
    }
    
    // Setup GPT Poster Prompt designer event listeners
    setupGptPromptEventListeners();
}

// Image Preview Modal Functions
function openPreviewModal(index) {
    state.previewActiveIdx = index;
    state.previewTab = 'orig';
    
    // Pause main playback if playing
    if (state.isPlaying) {
        togglePlayback();
    }
    
    DOM.previewModal.style.display = 'flex';
    // Small timeout to allow display change to take effect before opacity transition
    setTimeout(() => {
        DOM.previewModal.classList.add('active');
    }, 10);
    
    // Set up tabs
    DOM.tabPreviewOrig.classList.add('active');
    DOM.tabPreviewCutout.classList.remove('active');
    DOM.tabPreviewCrop.classList.remove('active');
    
    // Reset Crop parameters
    state.cropRatio = 'free';
    state.cropScale = 0.8;
    state.cropPercentX = 0.5;
    state.cropPercentY = 0.5;
    if (DOM.cropScaleSlider) {
        DOM.cropScaleSlider.value = 80;
        DOM.cropScaleVal.textContent = '80%';
    }
    [DOM.btnCropFree, DOM.btnCrop1_1, DOM.btnCrop9_16, DOM.btnCrop16_9, DOM.btnCrop4_5].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });
    if (DOM.btnCropFree) DOM.btnCropFree.classList.add('active');

    // Reset preview editor parameters
    state.prevEditorTool = 'brush';
    state.prevBrushSize = 30;
    if (DOM.prevBrushSizeSlider) {
        DOM.prevBrushSizeSlider.value = 30;
        DOM.prevBrushSizeVal.textContent = '30px';
    }
    if (DOM.prevToolBrush) DOM.prevToolBrush.classList.add('active');
    if (DOM.prevToolEraser) DOM.prevToolEraser.classList.remove('active');
    if (DOM.prevBrushToolIndicator) DOM.prevBrushToolIndicator.textContent = "Mode: Brush (Reveal)";

    updatePreviewContent();
    
    // Add global event listeners for closing and navigation
    document.addEventListener('keydown', handlePreviewKeyDown);
}

function closePreviewModal() {
    DOM.previewModal.classList.remove('active');
    setTimeout(() => {
        DOM.previewModal.style.display = 'none';
    }, 300);
    
    state.previewActiveIdx = null;
    
    // Hide controls
    if (DOM.previewModalEditorControls) DOM.previewModalEditorControls.style.display = 'none';
    if (DOM.previewModalCropControls) DOM.previewModalCropControls.style.display = 'none';
    
    // Remove global listeners
    document.removeEventListener('keydown', handlePreviewKeyDown);
}

function updatePreviewContent() {
    if (state.previewActiveIdx === null || state.previewActiveIdx < 0 || state.previewActiveIdx >= state.slides.length) {
        closePreviewModal();
        return;
    }
    
    const slide = state.slides[state.previewActiveIdx];
    
    // Update counter
    DOM.previewModalCounter.textContent = `${state.previewActiveIdx + 1} / ${state.slides.length}`;
    
    // Update caption
    DOM.previewModalCaption.textContent = slide.text || `Photo ${state.previewActiveIdx + 1}`;
    
    // Enable/disable navigation buttons
    DOM.btnPreviewPrev.disabled = state.previewActiveIdx === 0;
    DOM.btnPreviewNext.disabled = state.previewActiveIdx === state.slides.length - 1;
    
    // Render based on current active tab
    if (state.previewTab === 'orig') {
        DOM.previewImageContainer.classList.remove('checkerboard');
        DOM.previewModalImgOrig.src = slide.img.src;
        DOM.previewModalImgOrig.classList.add('active');
        DOM.previewModalCanvasCutout.style.display = 'none';
        DOM.previewModalCanvasCutout.classList.remove('active');
        DOM.previewModalCanvasCrop.style.display = 'none';
        DOM.previewModalCanvasCrop.classList.remove('active');
        
        if (DOM.previewModalEditorControls) DOM.previewModalEditorControls.style.display = 'none';
        if (DOM.previewModalCropControls) DOM.previewModalCropControls.style.display = 'none';
    } else if (state.previewTab === 'cutout') {
        DOM.previewImageContainer.classList.add('checkerboard');
        DOM.previewModalImgOrig.classList.remove('active');
        DOM.previewModalCanvasCutout.style.display = 'block';
        DOM.previewModalCanvasCutout.classList.add('active');
        DOM.previewModalCanvasCrop.style.display = 'none';
        DOM.previewModalCanvasCrop.classList.remove('active');
        
        if (DOM.previewModalEditorControls) DOM.previewModalEditorControls.style.display = 'flex';
        if (DOM.previewModalCropControls) DOM.previewModalCropControls.style.display = 'none';
        
        drawPreviewCutout();
    } else if (state.previewTab === 'crop') {
        DOM.previewImageContainer.classList.remove('checkerboard');
        DOM.previewModalImgOrig.classList.remove('active');
        DOM.previewModalCanvasCutout.style.display = 'none';
        DOM.previewModalCanvasCutout.classList.remove('active');
        DOM.previewModalCanvasCrop.style.display = 'block';
        DOM.previewModalCanvasCrop.classList.add('active');
        
        if (DOM.previewModalEditorControls) DOM.previewModalEditorControls.style.display = 'none';
        if (DOM.previewModalCropControls) DOM.previewModalCropControls.style.display = 'flex';
        
        drawCropCanvas();
    }
}

function handlePreviewKeyDown(e) {
    if (e.key === 'Escape') {
        closePreviewModal();
    } else if (e.key === 'ArrowLeft') {
        if (state.previewActiveIdx > 0 && state.previewTab !== 'crop' && !state.prevIsDrawing) {
            state.previewActiveIdx--;
            updatePreviewContent();
        }
    } else if (e.key === 'ArrowRight') {
        if (state.previewActiveIdx < state.slides.length - 1 && state.previewTab !== 'crop' && !state.prevIsDrawing) {
            state.previewActiveIdx++;
            updatePreviewContent();
        }
    }
}

// Draw transparent cutout onto preview modal canvas in real-time
function drawPreviewCutout() {
    const slide = state.slides[state.previewActiveIdx];
    if (!slide) return;
    const canvas = DOM.previewModalCanvasCutout;
    
    // Ensure mask matches image dimensions
    if (slide.mask.width !== slide.img.naturalWidth || slide.mask.height !== slide.img.naturalHeight) {
        const temp = document.createElement('canvas');
        temp.width = slide.img.naturalWidth;
        temp.height = slide.img.naturalHeight;
        const tempCtx = temp.getContext('2d');
        tempCtx.drawImage(slide.mask, 0, 0, temp.width, temp.height);
        slide.mask = temp;
    }

    canvas.width = slide.img.naturalWidth || 600;
    canvas.height = slide.img.naturalHeight || 400;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tCtx = tempCanvas.getContext('2d');
    
    tCtx.drawImage(slide.img, 0, 0);
    tCtx.globalCompositeOperation = 'destination-in';
    tCtx.drawImage(slide.mask, 0, 0);
    
    ctx.drawImage(tempCanvas, 0, 0);
}

// Draw crop screen onto preview-modal-canvas-crop
function drawCropCanvas() {
    const slide = state.slides[state.previewActiveIdx];
    if (!slide) return;
    const canvas = DOM.previewModalCanvasCrop;
    const ctx = canvas.getContext('2d');
    
    const img = slide.img;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    
    canvas.width = iw;
    canvas.height = ih;
    
    ctx.clearRect(0, 0, iw, ih);
    ctx.drawImage(img, 0, 0);
    
    let cropW = iw * state.cropScale;
    let cropH = ih * state.cropScale;
    
    if (state.cropRatio === '1-1') {
        const size = Math.min(iw, ih) * state.cropScale;
        cropW = size;
        cropH = size;
    } else if (state.cropRatio === '9-16') {
        const maxW = Math.min(iw, ih * (9 / 16));
        cropW = maxW * state.cropScale;
        cropH = cropW * (16 / 9);
    } else if (state.cropRatio === '16-9') {
        const maxH = Math.min(ih, iw * (9 / 16));
        cropH = maxH * state.cropScale;
        cropW = cropH * (16 / 9);
    } else if (state.cropRatio === '4-5') {
        const maxW = Math.min(iw, ih * (4 / 5));
        cropW = maxW * state.cropScale;
        cropH = cropW * (5 / 4);
    }
    
    if (cropW > iw) {
        cropW = iw;
        if (state.cropRatio === '1-1') cropH = cropW;
        else if (state.cropRatio === '9-16') cropH = cropW * (16 / 9);
        else if (state.cropRatio === '16-9') cropH = cropW * (9 / 16);
        else if (state.cropRatio === '4-5') cropH = cropW * (5 / 4);
    }
    if (cropH > ih) {
        cropH = ih;
        if (state.cropRatio === '1-1') cropW = cropH;
        else if (state.cropRatio === '9-16') cropW = cropH * (9 / 16);
        else if (state.cropRatio === '16-9') cropW = cropH * (16 / 9);
        else if (state.cropRatio === '4-5') cropW = cropH * (4 / 5);
    }
    
    let cx = state.cropPercentX * iw;
    let cy = state.cropPercentY * ih;
    
    cx = Math.max(cropW / 2, Math.min(iw - cropW / 2, cx));
    cy = Math.max(cropH / 2, Math.min(ih - cropH / 2, cy));
    
    state.cropPercentX = cx / iw;
    state.cropPercentY = cy / ih;
    
    const rx = cx - cropW / 2;
    const ry = cy - cropH / 2;
    
    state.currentCropRect = { sx: rx, sy: ry, sw: cropW, sh: cropH };
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, iw, ry);
    ctx.fillRect(0, ry + cropH, iw, ih - (ry + cropH));
    ctx.fillRect(0, ry, rx, cropH);
    ctx.fillRect(rx + cropW, ry, iw - (rx + cropW), cropH);
    
    ctx.strokeStyle = '#9d4edd';
    ctx.lineWidth = Math.max(3, iw / 250);
    ctx.strokeRect(rx, ry, cropW, cropH);
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = Math.max(1, iw / 500);
    ctx.beginPath();
    ctx.moveTo(rx + cropW / 3, ry);
    ctx.lineTo(rx + cropW / 3, ry + cropH);
    ctx.moveTo(rx + (2 * cropW) / 3, ry);
    ctx.lineTo(rx + (2 * cropW) / 3, ry + cropH);
    ctx.moveTo(rx, ry + cropH / 3);
    ctx.lineTo(rx + cropW, ry + cropH / 3);
    ctx.moveTo(rx, ry + (2 * cropH) / 3);
    ctx.lineTo(rx + cropW, ry + (2 * cropH) / 3);
    ctx.stroke();
}

// Crop the image and mask canvas, regenerate cutout and save
async function applyCrop() {
    const slide = state.slides[state.previewActiveIdx];
    if (!slide || !state.currentCropRect) return;
    
    const { sx, sy, sw, sh } = state.currentCropRect;
    
    // 1. Crop original image
    const croppedImageCanvas = document.createElement('canvas');
    croppedImageCanvas.width = sw;
    croppedImageCanvas.height = sh;
    const ciCtx = croppedImageCanvas.getContext('2d');
    ciCtx.drawImage(slide.img, sx, sy, sw, sh, 0, 0, sw, sh);
    
    const croppedImg = new Image();
    croppedImg.src = croppedImageCanvas.toDataURL();
    await new Promise(resolve => croppedImg.onload = resolve);
    
    // 2. Crop mask canvas
    const croppedMaskCanvas = document.createElement('canvas');
    croppedMaskCanvas.width = sw;
    croppedMaskCanvas.height = sh;
    const cmCtx = croppedMaskCanvas.getContext('2d');
    
    // Ensure mask matches original image resolution before crop
    if (slide.mask.width !== slide.img.naturalWidth || slide.mask.height !== slide.img.naturalHeight) {
        const temp = document.createElement('canvas');
        temp.width = slide.img.naturalWidth;
        temp.height = slide.img.naturalHeight;
        const tempCtx = temp.getContext('2d');
        tempCtx.drawImage(slide.mask, 0, 0, temp.width, temp.height);
        slide.mask = temp;
    }
    
    cmCtx.drawImage(slide.mask, sx, sy, sw, sh, 0, 0, sw, sh);
    
    // 3. Update slide
    slide.img = croppedImg;
    slide.mask = croppedMaskCanvas;
    
    // 4. Regenerate cutout
    slide.cutout = renderer.generateCutout(slide.img, slide.mask);
    renderer.setSlides(state.slides);
    
    // 5. Save & refresh
    triggerAutosave();
    onPhotosUpdated();
    
    // Switch back to original view tab
    state.previewTab = 'orig';
    DOM.tabPreviewOrig.classList.add('active');
    DOM.tabPreviewCrop.classList.remove('active');
    DOM.tabPreviewCutout.classList.remove('active');
    
    updatePreviewContent();
}

// Wizard Step Navigation Routing
function goToStep(stepNum) {
    state.currentStep = stepNum;
    
    DOM.stepBtns.forEach(btn => {
        btn.classList.remove('active');
        if (parseInt(btn.dataset.step) === stepNum) {
            btn.classList.add('active');
        }
    });
    
    DOM.stepPanels.forEach(panel => {
        panel.classList.remove('active');
        if (parseInt(panel.dataset.step) === stepNum) {
            panel.classList.add('active');
        }
    });
    
    // Step specific loads
    if (stepNum === 2) {
        // Pause active preview to focus resources on cutout editor
        if (state.isPlaying) togglePlayback();
        loadSlideIntoEditor();
    } else if (stepNum === 3) {
        // Resume previewing
        if (!state.isPlaying) togglePlayback();
    }
}

// Parse uploaded files
function handleFiles(files) {
    const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    
    if (validFiles.length === 0) return;
    
    validFiles.forEach(file => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const slideId = Math.random().toString(36).substr(2, 9);
                
                // Add placeholder slide immediately
                state.slides.push({
                    id: slideId,
                    img: img,
                    mask: null,
                    cutout: null, // precomputed in renderer
                    text: '',
                    processing: true,
                    rotation: (Math.random() - 0.5) * 8 * Math.PI / 180 // Random -4 to +4 degrees
                });
                onPhotosUpdated();
                enableNextSteps();
                
                // Asynchronously run subject detection
                detectSubject(img, 0.4).then(mask => {
                    const slide = state.slides.find(s => s.id === slideId);
                    if (slide) {
                        slide.mask = mask;
                        slide.processing = false;
                        onPhotosUpdated();
                        enableNextSteps();
                    }
                }).catch(err => {
                    console.error("AI subject detection failed:", err);
                    // Remove failed slide
                    state.slides = state.slides.filter(s => s.id !== slideId);
                    onPhotosUpdated();
                    enableNextSteps();
                    showToast("❌ Failed to process subject cutout.");
                });
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// --- STEP 2 EDITOR INTERFACE ---

function selectEditorTool(tool) {
    // Cancel any active lasso session when switching tools
    if (state.editorTool === 'lasso' && tool !== 'lasso') {
        state.lassoPoints = [];
        state.lassoActive = false;
        state.lassoMousePos = null;
        drawEditorFrame();
    }
    
    state.editorTool = tool;
    DOM.toolBrush.classList.remove('active');
    DOM.toolEraser.classList.remove('active');
    const lassoBtn = document.getElementById('tool-lasso');
    if (lassoBtn) lassoBtn.classList.remove('active');
    
    if (tool === 'brush')  DOM.toolBrush.classList.add('active');
    if (tool === 'eraser') DOM.toolEraser.classList.add('active');
    if (tool === 'lasso' && lassoBtn) lassoBtn.classList.add('active');
}

function loadSlideIntoEditor() {
    const slide = state.slides[state.activeSlideIdx];
    if (!slide) return;
    
    edImage = slide.img;
    
    // Scale editor canvas to fit image proportions
    const aspect = edImage.naturalWidth / edImage.naturalHeight;
    const maxW = 340;
    const maxH = 340;
    
    let destW = maxW;
    let destH = destW / aspect;
    if (destH > maxH) {
        destH = maxH;
        destW = destH * aspect;
    }
    
    DOM.editorCanvas.width = destW;
    DOM.editorCanvas.height = destH;
    
    drawEditorFrame();
}

// Redraws the manual cutout editor canvas (original image + transparent red mask overlay)
function drawEditorFrame() {
    const slide = state.slides[state.activeSlideIdx];
    if (!slide || !edImage) return;
    
    const w = DOM.editorCanvas.width;
    const h = DOM.editorCanvas.height;
    
    edCtx.clearRect(0, 0, w, h);
    
    // 1. Draw original photo
    edCtx.drawImage(edImage, 0, 0, w, h);
    
    // 2. Draw red background mask overlay
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = w;
    overlayCanvas.height = h;
    const oCtx = overlayCanvas.getContext('2d');
    oCtx.fillStyle = 'rgba(239, 71, 111, 0.45)';
    oCtx.fillRect(0, 0, w, h);
    oCtx.globalCompositeOperation = 'destination-out';
    oCtx.drawImage(slide.mask, 0, 0, w, h);
    edCtx.drawImage(overlayCanvas, 0, 0);
    
    // 3. Draw live lasso preview on top
    if (state.editorTool === 'lasso' && state.lassoPoints.length > 0) {
        const pts = state.lassoPoints;
        const mouse = state.lassoMousePos;
        
        edCtx.save();
        
        // Dashed path line
        edCtx.setLineDash([5, 4]);
        edCtx.lineWidth = 1.5;
        edCtx.strokeStyle = 'rgba(255,255,255,0.9)';
        edCtx.shadowColor = 'rgba(0,0,0,0.8)';
        edCtx.shadowBlur = 3;
        edCtx.beginPath();
        edCtx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) edCtx.lineTo(pts[i].x, pts[i].y);
        // Line to current mouse
        if (mouse) edCtx.lineTo(mouse.x, mouse.y);
        edCtx.stroke();
        
        // Closing line hint (dashed in different colour)
        if (mouse && pts.length > 2) {
            edCtx.setLineDash([3, 6]);
            edCtx.strokeStyle = 'rgba(157, 78, 221, 0.7)';
            edCtx.beginPath();
            edCtx.moveTo(mouse.x, mouse.y);
            edCtx.lineTo(pts[0].x, pts[0].y);
            edCtx.stroke();
        }
        
        edCtx.setLineDash([]);
        edCtx.shadowBlur = 0;
        
        // Draw point handles
        pts.forEach((pt, i) => {
            const isFirst = i === 0;
            const r = isFirst ? 7 : 4;
            edCtx.beginPath();
            edCtx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
            edCtx.fillStyle = isFirst ? 'rgba(157,78,221,0.9)' : 'rgba(255,255,255,0.9)';
            edCtx.fill();
            edCtx.lineWidth = 1.5;
            edCtx.strokeStyle = isFirst ? '#fff' : 'rgba(157,78,221,0.9)';
            edCtx.stroke();
        });
        
        // Show "close" hint when near first point
        if (mouse && pts.length > 2) {
            const dx = mouse.x - pts[0].x, dy = mouse.y - pts[0].y;
            if (Math.hypot(dx, dy) < 18) {
                edCtx.fillStyle = 'rgba(157,78,221,0.85)';
                edCtx.font = 'bold 11px Outfit, sans-serif';
                edCtx.fillText('Close ✓', pts[0].x + 10, pts[0].y - 10);
            }
        }
        
        edCtx.restore();
    }
}

/**
 * Commits the current N-point lasso polygon to the slide's mask.
 * Fills the polygon interior then applies a Gaussian feather for smooth edges.
 */
function commitLassoPolygon(mode = 'add') {
    const pts = state.lassoPoints;
    if (pts.length < 3) return;
    
    const slide = state.slides[state.activeSlideIdx];
    if (!slide) return;
    
    const mW = slide.mask.width;
    const mH = slide.mask.height;
    const eW = DOM.editorCanvas.width;
    const eH = DOM.editorCanvas.height;
    const sx = mW / eW;
    const sy = mH / eH;
    
    // ── 1. Draw filled polygon on a temporary canvas at mask resolution ──
    const polyCanvas = document.createElement('canvas');
    polyCanvas.width  = mW;
    polyCanvas.height = mH;
    const pCtx = polyCanvas.getContext('2d');
    
    pCtx.beginPath();
    pCtx.moveTo(pts[0].x * sx, pts[0].y * sy);
    for (let i = 1; i < pts.length; i++) pCtx.lineTo(pts[i].x * sx, pts[i].y * sy);
    pCtx.closePath();
    pCtx.fillStyle = '#ffffff';
    pCtx.fill();
    
    // ── 2. Feather the polygon by blurring then re-thresholding ──────────
    const feather = Math.max(0, state.featherRadius);
    if (feather > 0) {
        // Blur to create soft edge
        pCtx.filter = `blur(${feather}px)`;
        const blurCanvas = document.createElement('canvas');
        blurCanvas.width = mW; blurCanvas.height = mH;
        const bCtx = blurCanvas.getContext('2d');
        bCtx.filter = `blur(${feather}px)`;
        bCtx.drawImage(polyCanvas, 0, 0);
        bCtx.filter = 'none';
        // Use the blurred version as our polygon
        pCtx.clearRect(0, 0, mW, mH);
        pCtx.drawImage(blurCanvas, 0, 0);
    }
    
    // ── 3. Composite onto the real mask ──────────────────────────────────
    const mCtx = slide.mask.getContext('2d');
    mCtx.save();
    if (mode === 'add') {
        mCtx.globalCompositeOperation = 'source-over';
    } else {
        // 'subtract' — erase from mask using the polygon
        mCtx.globalCompositeOperation = 'destination-out';
    }
    mCtx.drawImage(polyCanvas, 0, 0);
    mCtx.restore();
    
    // ── 4. Regenerate cutout + update renderer ────────────────────────────
    slide.cutout = renderer.generateCutout(slide.img, slide.mask);
    renderer.setSlides(state.slides);
    
    // ── 5. Reset lasso state ──────────────────────────────────────────────
    state.lassoPoints  = [];
    state.lassoActive  = false;
    state.lassoMousePos = null;
    drawEditorFrame();
    triggerAutosave();
}

function setupEditorDrawing() {
    const getCoords = (e) => {
        const rect = DOM.editorCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: ((clientX - rect.left) / rect.width) * DOM.editorCanvas.width,
            y: ((clientY - rect.top) / rect.height) * DOM.editorCanvas.height
        };
    };
    
    // ── Brush / Eraser drawing ────────────────────────────────────────────
    const paint = (e) => {
        if (!state.isDrawing) return;
        e.preventDefault();
        
        const coords = getCoords(e);
        const slide  = state.slides[state.activeSlideIdx];
        if (!slide) return;
        
        const mCtx  = slide.mask.getContext('2d');
        const scaleX = slide.mask.width  / DOM.editorCanvas.width;
        const scaleY = slide.mask.height / DOM.editorCanvas.height;
        const brushPx = state.brushSize * scaleX;
        
        mCtx.save();
        mCtx.lineCap   = 'round';
        mCtx.lineJoin  = 'round';
        mCtx.lineWidth = brushPx;
        
        if (state.editorTool === 'brush') {
            mCtx.globalCompositeOperation = 'source-over';
            mCtx.strokeStyle = '#ffffff';
            mCtx.fillStyle   = '#ffffff';
        } else {
            mCtx.globalCompositeOperation = 'destination-out';
            mCtx.strokeStyle = 'rgba(0,0,0,1)';
            mCtx.fillStyle   = 'rgba(0,0,0,1)';
        }
        
        mCtx.beginPath();
        if (state.lastX !== undefined) {
            mCtx.moveTo(state.lastX * scaleX, state.lastY * scaleY);
            mCtx.lineTo(coords.x   * scaleX, coords.y   * scaleY);
            mCtx.stroke();
        } else {
            mCtx.arc(coords.x * scaleX, coords.y * scaleY, brushPx / 2, 0, Math.PI * 2);
            mCtx.fill();
        }
        mCtx.restore();
        
        state.lastX = coords.x;
        state.lastY = coords.y;
        drawEditorFrame();
    };
    
    const startPainting = (e) => {
        if (state.editorTool !== 'brush' && state.editorTool !== 'eraser') return;
        state.isDrawing = true;
        state.lastX = undefined;
        state.lastY = undefined;
        paint(e);
    };
    
    const stopPainting = () => {
        if (!state.isDrawing) return;
        state.isDrawing = false;
        state.lastX = undefined;
        state.lastY = undefined;
        const slide = state.slides[state.activeSlideIdx];
        if (slide) {
            slide.cutout = renderer.generateCutout(slide.img, slide.mask);
            renderer.setSlides(state.slides);
            triggerAutosave();
        }
    };
    
    // ── Lasso (N-point polygon) interaction ───────────────────────────────
    const handleLassoClick = (e) => {
        if (state.editorTool !== 'lasso') return;
        e.preventDefault();
        const coords = getCoords(e);
        const pts    = state.lassoPoints;
        
        // Close polygon if clicking near first point (within 18px) and have 3+ points
        if (pts.length > 2) {
            const dx = coords.x - pts[0].x;
            const dy = coords.y - pts[0].y;
            if (Math.hypot(dx, dy) < 18) {
                // Check shift key for subtract mode
                const mode = e.shiftKey ? 'subtract' : 'add';
                commitLassoPolygon(mode);
                return;
            }
        }
        
        // Add point
        state.lassoPoints.push({ x: coords.x, y: coords.y });
        state.lassoActive = true;
        drawEditorFrame();
    };
    
    const handleLassoDoubleClick = (e) => {
        if (state.editorTool !== 'lasso') return;
        e.preventDefault();
        if (state.lassoPoints.length > 2) {
            const mode = e.shiftKey ? 'subtract' : 'add';
            commitLassoPolygon(mode);
        }
    };
    
    const handleLassoMouseMove = (e) => {
        if (state.editorTool !== 'lasso' || !state.lassoActive) return;
        state.lassoMousePos = getCoords(e);
        drawEditorFrame();
    };
    
    // ── Escape key cancels lasso ──────────────────────────────────────────
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.editorTool === 'lasso') {
            state.lassoPoints   = [];
            state.lassoActive   = false;
            state.lassoMousePos = null;
            drawEditorFrame();
        }
        // Enter also commits
        if (e.key === 'Enter' && state.editorTool === 'lasso' && state.lassoPoints.length > 2) {
            commitLassoPolygon(e.shiftKey ? 'subtract' : 'add');
        }
    });

    DOM.editorCanvas.addEventListener('mousedown',  startPainting);
    DOM.editorCanvas.addEventListener('mousemove',  (e) => { paint(e); handleLassoMouseMove(e); });
    window.addEventListener('mouseup',              stopPainting);
    DOM.editorCanvas.addEventListener('click',      handleLassoClick);
    DOM.editorCanvas.addEventListener('dblclick',   handleLassoDoubleClick);
    
    DOM.editorCanvas.addEventListener('touchstart', startPainting);
    DOM.editorCanvas.addEventListener('touchmove',  paint);
    window.addEventListener('touchend',             stopPainting);
}

// --- AUDIO & PLAYBACK ENGINE CONTROLLER ---

function togglePlayback() {
    if (state.slides.length === 0) return;
    
    state.isPlaying = !state.isPlaying;
    if (renderer) {
        renderer.isPlaying = state.isPlaying;
        renderer.draw(state.playTime);
    }
    
    if (state.isPlaying) {
        DOM.hudPlayBtn.innerHTML = '<i data-lucide="pause" style="width:16px;height:16px;"></i>';
        if (window.lucide) lucide.createIcons();
        DOM.musicIndicator.style.display = 'flex';
        // Play audio
        console.log(`[Playback] Starting playback. Theme: ${state.musicTheme}, Volume: ${state.musicVolume}`);
        if (state.musicVolume === 0) {
            console.warn("[Playback] Music volume is set to 0% (muted). You won't hear any sound!");
        }
        audio.setTheme(state.musicTheme);
        audio.start(onAudioBeat);
    } else {
        DOM.hudPlayBtn.innerHTML = '<i data-lucide="play" style="width:16px;height:16px;"></i>';
        if (window.lucide) lucide.createIcons();
        DOM.musicIndicator.style.display = 'none';
        // Stop audio
        audio.stop();
    }
}

// Triggers flash pulse on beat sync
function onAudioBeat(time) {
    if (renderer) {
        renderer.triggerBeatPulse();
    }
}

// --- MAIN LOOP ---

let lastTime = 0;
function animationTick(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dt = (timestamp - lastTime) / 1000.0;
    lastTime = timestamp;

    if (renderer) {
        renderer.update(dt);
        
        if (state.isPlaying && !state.isRecording) {
            state.playTime += dt;
            const totalDuration = state.slides.length * state.slideDuration;
            
            if (state.playTime >= totalDuration) {
                state.playTime = 0;
            }
            
            // Sync HUD Timeline values
            updateHudTimeline(totalDuration);
        }
        
        // Draw current frame
        if (!state.isRecording) {
            renderer.draw(state.playTime);
        }
    }

    requestAnimationFrame(animationTick);
}

function updateHudTimeline(totalDuration) {
    // Seek Fill
    const percent = (state.playTime / totalDuration) * 100;
    DOM.hudProgressFill.style.width = percent + '%';
    
    // Timer Text
    const m = Math.floor(state.playTime / 60);
    const s = Math.floor(state.playTime % 60);
    const tm = Math.floor(totalDuration / 60);
    const ts = Math.floor(totalDuration % 60);
    DOM.hudTimeVal.textContent = `${m}:${s.toString().padStart(2, '0')} / ${tm}:${ts.toString().padStart(2, '0')}`;
    
    // Slide counter tag
    const curSlide = Math.floor(state.playTime / state.slideDuration) + 1;
    DOM.hudCounter.textContent = `${Math.min(state.slides.length, curSlide)} / ${state.slides.length}`;

    // Update bottom timeline playhead position
    const playhead = document.getElementById('timeline-playhead');
    if (playhead && state.slides.length > 0) {
        const cellWidth = 70;
        const cellGap = 6;
        const pixelsPerSecond = (cellWidth + cellGap) / state.slideDuration;
        const playheadOffset = state.playTime * pixelsPerSecond;
        const playheadLeft = 130 + 16 + playheadOffset;
        playhead.style.left = playheadLeft + 'px';
        
        // Auto-scroll the timeline container to keep playhead in view
        const container = document.querySelector('.timeline-tracks-container');
        if (container) {
            const containerWidth = container.clientWidth;
            const scrollLeft = container.scrollLeft;
            const stickyHeaderWidth = 130;
            const playheadRelativeX = playheadLeft - scrollLeft;
            
            // If playhead goes beyond the visible area (with margin), scroll to it
            if (playheadRelativeX > containerWidth - 120) {
                container.scrollLeft = playheadLeft - (containerWidth - 150);
            } else if (playheadRelativeX < stickyHeaderWidth + 20) {
                container.scrollLeft = Math.max(0, playheadLeft - stickyHeaderWidth - 20);
            }
        }
    }

    // Update Step 3 Easing Curve sweep playhead dot
    if (state.currentStep === 3) {
        drawTransitionCurve();
    }
}

// --- VIDEO EXPORT PIPELINE ---

async function startExportingVideo() {
    if (state.slides.length === 0) return;
    
    state.isRecording = true;
    DOM.exportProgressArea.style.display = 'block';
    DOM.btnStartExport.style.display = 'none';
    DOM.btnCancelExport.style.display = 'block';
    DOM.btnDownloadVideo.style.display = 'none';
    if (DOM.renderedVideoPreviewWrapper) {
        DOM.renderedVideoPreviewWrapper.style.display = 'none';
    }
    if (DOM.renderedVideoPlayer) {
        DOM.renderedVideoPlayer.src = '';
        DOM.renderedVideoPlayer.load();
    }
    DOM.backTo3.disabled = true;
    DOM.exportStatusText.textContent = "Initializing recording...";
    DOM.exportProgressBar.style.width = '0%';
    DOM.exportPercent.textContent = '0%';
    
    // Temporarily halt standard player
    if (state.isPlaying) togglePlayback();
    
    const isHighRes = DOM.exportResolution.value === '1080';
    let resolutionWidth = isHighRes ? 1080 : 720;
    let resolutionHeight = isHighRes ? 1920 : 1280;
    
    if (state.videoRatio === '16-9') {
        resolutionWidth = isHighRes ? 1920 : 1280;
        resolutionHeight = isHighRes ? 1080 : 720;
    } else if (state.videoRatio === '1-1') {
        resolutionWidth = isHighRes ? 1080 : 720;
        resolutionHeight = isHighRes ? 1080 : 720;
    } else if (state.videoRatio === '4-5') {
        resolutionWidth = isHighRes ? 1080 : 720;
        resolutionHeight = isHighRes ? 1350 : 900;
    }
    
    // 1. Setup high-res recording canvas
    const recordCanvas = document.createElement('canvas');
    recordCanvas.id = 'temp-recording-canvas';
    recordCanvas.width = resolutionWidth;
    recordCanvas.height = resolutionHeight;
    
    // Style and append canvas to DOM to ensure captureStream() triggers frame generation.
    // We style it to cover the viewport but layer it behind the page body background
    // (z-index: -10000) with low opacity (0.01) so it is 100% invisible to the user,
    // but the browser compositor is forced to paint it (since it's in the viewport).
    // This prevents culling/optimizations that pause canvas rendering in Safari and Firefox.
    recordCanvas.style.position = 'fixed';
    recordCanvas.style.left = '0';
    recordCanvas.style.top = '0';
    recordCanvas.style.width = '100vw';
    recordCanvas.style.height = '100vh';
    recordCanvas.style.opacity = '0.01';
    recordCanvas.style.zIndex = '-10000';
    recordCanvas.style.pointerEvents = 'none';
    document.body.appendChild(recordCanvas);
    
    const recordRenderer = new CollageRenderer(recordCanvas);
    recordRenderer.activeStyle = state.style;
    recordRenderer.borderType = state.borderType;
    recordRenderer.bgPalette = state.bgPalette;
    recordRenderer.slideDuration = state.slideDuration;
    recordRenderer.beatSync = state.beatSync;
    recordRenderer.setSlides(state.slides);
    
    // 2. Hook up MediaRecorder streams
    const fps = 30;
    const canvasStream = recordCanvas.captureStream(fps);
    const combinedTracks = [...canvasStream.getVideoTracks()];
    
    // Mix music stream into video
    let audioStream = null;
    if (state.musicTheme !== 'none') {
        // Start synthetic audio context BEFORE grabbing track
        audio.setTheme(state.musicTheme);
        audio.start((time) => {
            recordRenderer.triggerBeatPulse();
        });
        
        // Wait for AudioContext to be fully running to prevent silent/empty tracks and starting crashes
        if (audio.ctx && audio.ctx.state === 'suspended') {
            try {
                await audio.ctx.resume();
                console.log("[export] AudioContext resumed successfully before recording. State:", audio.ctx.state);
            } catch (err) {
                console.warn("[export] Failed to resume AudioContext before recording:", err);
            }
        }
        
        audioStream = audio.getAudioStream();
        if (audioStream) {
            combinedTracks.push(...audioStream.getAudioTracks());
        } else {
            console.warn("[export] Audio stream is null, recording video without audio.");
        }
    }
    
    const mergedStream = new MediaStream(combinedTracks);
    
    // Determine compatible mime codecs
    const formatSelection = DOM.exportFormat.value;
    let mimeType = 'video/webm;codecs=vp9,opus';
    let fileExtension = '.webm';
    
    if (formatSelection === 'mp4' || !MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported('video/mp4;codecs="avc1.424028, mp4a.40.2"')) {
            mimeType = 'video/mp4;codecs="avc1.424028, mp4a.40.2"';
            fileExtension = '.mp4';
        } else if (MediaRecorder.isTypeSupported('video/mp4;codecs="avc1.42c01e, mp4a.40.2"')) {
            mimeType = 'video/mp4;codecs="avc1.42c01e, mp4a.40.2"';
            fileExtension = '.mp4';
        } else if (MediaRecorder.isTypeSupported('video/mp4;codecs="avc1,mp4a"')) {
            mimeType = 'video/mp4;codecs="avc1,mp4a"';
            fileExtension = '.mp4';
        } else if (MediaRecorder.isTypeSupported('video/mp4;codecs=h264,aac')) {
            mimeType = 'video/mp4;codecs=h264,aac';
            fileExtension = '.mp4';
        } else if (MediaRecorder.isTypeSupported('video/mp4')) {
            mimeType = 'video/mp4';
            fileExtension = '.mp4';
        } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
            mimeType = 'video/webm;codecs=vp8,opus';
            fileExtension = '.webm';
        } else {
            mimeType = '';
            fileExtension = '.webm';
        }
    }
    
    state.recordedChunks = [];
    let usingFallbackOnlyVideo = false;
    
    // Configure high-quality options (15 Mbps for 1080p, 8 Mbps for 720p, 320 kbps for audio)
    const targetVideoBitrate = isHighRes ? 15000000 : 8000000;
    const targetAudioBitrate = 320000;
    
    const combinedOptions = {};
    if (mimeType) combinedOptions.mimeType = mimeType;
    combinedOptions.videoBitsPerSecond = targetVideoBitrate;
    combinedOptions.audioBitsPerSecond = targetAudioBitrate;
    
    const videoOnlyOptions = {};
    if (mimeType) videoOnlyOptions.mimeType = mimeType;
    videoOnlyOptions.videoBitsPerSecond = targetVideoBitrate;
    
    try {
        state.recorder = new MediaRecorder(mergedStream, combinedOptions);
    } catch (e) {
        console.warn("[export] Combined audio+video MediaRecorder failed, attempting fallback:", e);
        // Fallback 1: Try video-only stream
        try {
            const videoOnlyStream = new MediaStream(canvasStream.getVideoTracks());
            state.recorder = new MediaRecorder(videoOnlyStream, videoOnlyOptions);
            usingFallbackOnlyVideo = true;
        } catch (e2) {
            console.warn("[export] Video-only MediaRecorder with mimeType failed, falling back to default options:", e2);
            // Fallback 2: Try default options with video-only
            try {
                const videoOnlyStream = new MediaStream(canvasStream.getVideoTracks());
                state.recorder = new MediaRecorder(videoOnlyStream);
                usingFallbackOnlyVideo = true;
            } catch (e3) {
                console.error("[export] All MediaRecorder configurations failed:", e3);
                showToast("❌ Video recording not supported on this browser.");
                DOM.exportStatusText.textContent = "⚠️ Export failed — browser incompatible.";
                finishExportingState();
                return;
            }
        }
    }

    const processAndDownload = async (recordedChunks, recorderMimeType) => {
        const videoBlob = new Blob(recordedChunks, { type: recorderMimeType || 'video/webm' });
        const fallbackURL = URL.createObjectURL(videoBlob);
        
        DOM.exportStatusText.textContent = "Optimizing video...";
        showToast("🎬 Optimizing video quality & compatibility...");
        
        let convertUrl = '/convert';
        
        if (state.thumbnailDataUrl) {
            try {
                DOM.exportStatusText.textContent = "Uploading cover art...";
                // Convert dataUrl to blob
                const thumbBlob = await (await fetch(state.thumbnailDataUrl)).blob();
                const uploadResp = await fetch('/upload_thumbnail', {
                    method: 'POST',
                    body: thumbBlob
                });
                if (uploadResp.ok) {
                    const uploadResult = await uploadResp.json();
                    if (uploadResult.thumbnail_id) {
                        convertUrl = `/convert?thumbnail_id=${encodeURIComponent(uploadResult.thumbnail_id)}`;
                        console.info("[export] Thumbnail uploaded successfully, ID:", uploadResult.thumbnail_id);
                    }
                }
            } catch (err) {
                console.warn("[export] Failed to upload thumbnail cover art, proceeding without it:", err);
            }
        }
        
        DOM.exportStatusText.textContent = "Optimizing video...";
        
        fetch(convertUrl, {
            method: 'POST',
            body: videoBlob
        })
        .then(response => {
            if (!response.ok) throw new Error("Server conversion failed");
            return response.blob();
        })
        .then(convertedBlob => {
            const videoURL = URL.createObjectURL(convertedBlob);
            DOM.btnDownloadVideo.href = videoURL;
            DOM.btnDownloadVideo.download = `scrapbook_collage_${Date.now()}.mp4`; // Always download standard .mp4
            DOM.btnDownloadVideo.style.display = 'flex';
            
            if (DOM.renderedVideoPlayer) {
                DOM.renderedVideoPlayer.src = videoURL;
                if (state.thumbnailDataUrl) {
                    DOM.renderedVideoPlayer.setAttribute('poster', state.thumbnailDataUrl);
                } else {
                    DOM.renderedVideoPlayer.removeAttribute('poster');
                }
                DOM.renderedVideoPlayer.load();
            }
            if (DOM.renderedVideoPreviewWrapper) {
                DOM.renderedVideoPreviewWrapper.style.display = 'block';
            }
            
            DOM.exportStatusText.textContent = "Video ready!";
            finishExportingState();
        })
        .catch(err => {
            console.warn("[export] Optimization failed, falling back to raw recording:", err);
            DOM.btnDownloadVideo.href = fallbackURL;
            DOM.btnDownloadVideo.download = `scrapbook_collage_${Date.now()}${fileExtension}`;
            DOM.btnDownloadVideo.style.display = 'flex';
            
            if (DOM.renderedVideoPlayer) {
                DOM.renderedVideoPlayer.src = fallbackURL;
                DOM.renderedVideoPlayer.removeAttribute('poster');
                DOM.renderedVideoPlayer.load();
            }
            if (DOM.renderedVideoPreviewWrapper) {
                DOM.renderedVideoPreviewWrapper.style.display = 'block';
            }
            
            DOM.exportStatusText.textContent = "Video ready (raw fallback)";
            finishExportingState();
        });
    };

    state.recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
            state.recordedChunks.push(event.data);
        }
    };
    
    state.recorder.onstop = () => {
        // Turn off music synth
        audio.stop();
        
        // Remove temporary canvas from DOM
        const tempCanvas = document.getElementById('temp-recording-canvas');
        if (tempCanvas && tempCanvas.parentNode) {
            tempCanvas.parentNode.removeChild(tempCanvas);
        }
        
        if (!state.isRecording) return; // recording aborted
        
        processAndDownload(state.recordedChunks, state.recorder.mimeType);
    };
    
    // Start recording with robust runtime starting fallback
    let started = false;
    try {
        state.recorder.start();
        started = true;
    } catch (err) {
        console.warn("[export] Failed to start combined recorder, attempting video-only runtime fallback:", err);
        state.recorder = null;
    }

    if (!started) {
        // Attempt fallback to video-only
        try {
            const videoOnlyStream = new MediaStream(canvasStream.getVideoTracks());
            state.recorder = new MediaRecorder(videoOnlyStream, videoOnlyOptions);
            state.recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    state.recordedChunks.push(event.data);
                }
            };
            state.recorder.onstop = () => {
                const tempCanvas = document.getElementById('temp-recording-canvas');
                if (tempCanvas && tempCanvas.parentNode) {
                    tempCanvas.parentNode.removeChild(tempCanvas);
                }
                if (!state.isRecording) return;
                processAndDownload(state.recordedChunks, state.recorder.mimeType);
            };
            state.recorder.start();
            usingFallbackOnlyVideo = true;
            started = true;
        } catch (e2) {
            console.warn("[export] Video-only fallback failed to start, trying default options:", e2);
            try {
                const videoOnlyStream = new MediaStream(canvasStream.getVideoTracks());
                state.recorder = new MediaRecorder(videoOnlyStream);
                state.recorder.ondataavailable = (event) => {
                    if (event.data && event.data.size > 0) {
                        state.recordedChunks.push(event.data);
                    }
                };
                state.recorder.onstop = () => {
                    const tempCanvas = document.getElementById('temp-recording-canvas');
                    if (tempCanvas && tempCanvas.parentNode) {
                        tempCanvas.parentNode.removeChild(tempCanvas);
                    }
                    if (!state.isRecording) return;
                    processAndDownload(state.recordedChunks, state.recorder.mimeType);
                };
                state.recorder.start();
                usingFallbackOnlyVideo = true;
                started = true;
            } catch (e3) {
                console.error("[export] All MediaRecorder attempts failed at runtime:", e3);
                showToast("❌ Video recording not supported on this browser.");
                DOM.exportStatusText.textContent = "⚠️ Export failed — browser incompatible.";
                finishExportingState();
                return;
            }
        }
    }
    
    if (usingFallbackOnlyVideo) {
        showToast("⚠️ Exporting video only (audio mixing not supported on this browser)");
    }
    
    const totalDuration = state.slides.length * state.slideDuration;
    
    DOM.exportStatusText.textContent = "Rendering frames...";
    showToast("⚠️ Please keep this tab active and in the foreground for best export quality.");
    
    let startTime = null;
    let t = 0;
    
    const renderNextFrame = (timestamp) => {
        if (!state.isRecording) {
            // Cancelled
            return;
        }
        
        if (startTime === null) {
            startTime = timestamp;
        }
        
        // Calculate the elapsed time in seconds since rendering started
        const elapsed = (timestamp - startTime) / 1000.0;
        const dt = elapsed - t;
        t = elapsed;
        
        try {
            // Advance renderer in sync with real time
            recordRenderer.update(dt);
            recordRenderer.draw(t);
        } catch (err) {
            console.error('[export] Frame render error at t=' + t.toFixed(3) + 's:', err);
            // Show error and abort
            DOM.exportStatusText.textContent = "⚠️ Render error — check console for details.";
            try {
                if (state.recorder && state.recorder.state !== 'inactive') {
                    state.recorder.stop();
                }
            } catch (recErr) {}
            state.isRecording = false;
            // Clean up DOM canvas immediately
            const tempCanvas = document.getElementById('temp-recording-canvas');
            if (tempCanvas && tempCanvas.parentNode) {
                tempCanvas.parentNode.removeChild(tempCanvas);
            }
            return;
        }
        
        // Progress based on elapsed real-world time
        const percent = Math.min(100, Math.round((t / totalDuration) * 100));
        DOM.exportProgressBar.style.width = percent + '%';
        DOM.exportPercent.textContent = percent + '%';
        
        if (t >= totalDuration) {
            DOM.exportStatusText.textContent = "Processing video file...";
            try {
                state.recorder.stop();
            } catch (recErr) {
                console.error("[export] Error stopping recorder:", recErr);
                finishExportingState();
            }
            return;
        }
        
        // Use requestAnimationFrame to stay in sync with browser paint cycle
        // This prevents frame pile-up and keeps UI responsive
        requestAnimationFrame(renderNextFrame);
    };
    
    requestAnimationFrame(renderNextFrame);
}

function cancelExportingVideo() {
    if (state.recorder && state.recorder.state !== 'inactive') {
        state.recorder.stop();
    }
    audio.stop();
    finishExportingState();
}

function finishExportingState() {
    state.isRecording = false;
    DOM.exportProgressArea.style.display = 'none';
    DOM.btnStartExport.style.display = 'block';
    DOM.btnCancelExport.style.display = 'none';
    DOM.backTo3.disabled = false;
    
    // Remove temporary recording canvas if present in DOM
    const tempCanvas = document.getElementById('temp-recording-canvas');
    if (tempCanvas && tempCanvas.parentNode) {
        tempCanvas.parentNode.removeChild(tempCanvas);
    }
}

function configureAudioEditorSliders(duration) {
    if (!DOM.customAudioEditor) return;
    DOM.customAudioEditor.style.display = 'flex';
    DOM.audioFilenameBadge.textContent = state.customAudioFilename || 'Custom Audio';
    DOM.audioFilenameBadge.title = state.customAudioFilename || '';
    
    DOM.audioStartSlider.max = duration;
    
    if (state.speedMode === 'auto') {
        syncSpeedToBeats();
    } else {
        autoTrimCustomAudio();
    }
}

function autoTrimCustomAudio() {
    if (!state.customAudioFileBlob || !audio.customAudioBuffer) return;
    
    const videoLength = state.slides.length * state.slideDuration;
    const audioDuration = audio.customAudioBuffer.duration;
    
    // Clamp state.customAudioStart to stay within valid limits
    const maxStartTrim = Math.max(0, audioDuration - videoLength);
    if (state.customAudioStart > maxStartTrim) {
        state.customAudioStart = maxStartTrim;
    }
    if (state.customAudioStart < 0) {
        state.customAudioStart = 0;
    }
    
    // Set customAudioEnd to exactly Start Trim + Video Length
    state.customAudioEnd = state.customAudioStart + videoLength;
    if (state.customAudioEnd > audioDuration) {
        state.customAudioEnd = audioDuration;
    }
    
    // Update audio engine trim parameters
    audio.customAudioStart = state.customAudioStart;
    audio.customAudioEnd = state.customAudioEnd;
    
    // Synchronize UI elements
    if (DOM.audioStartSlider) {
        DOM.audioStartSlider.max = audioDuration;
        DOM.audioStartSlider.value = state.customAudioStart;
        DOM.audioStartVal.textContent = state.customAudioStart.toFixed(1) + 's';
    }
    if (DOM.audioEndSlider) {
        DOM.audioEndSlider.max = audioDuration;
        DOM.audioEndSlider.value = state.customAudioEnd;
        DOM.audioEndVal.textContent = state.customAudioEnd.toFixed(1) + 's';
        DOM.audioEndSlider.disabled = true;
        DOM.audioEndSlider.style.opacity = '0.5';
    }
    
    // If playing custom audio, hot-reload to apply the trim changes
    if (state.isPlaying && state.musicTheme === 'custom') {
        audio.restartCustomBuffer();
    }
}

function syncSpeedToBeats() {
    if (state.speedMode !== 'auto') return;
    
    const bpm = audio.detectedBPM || audio.bpm || 120;
    const beatDuration = 60 / bpm;
    
    // Find the best beat multiplier: the number of beats that best fits common slide durations
    // Prefer 2 or 4 beats per slide for musical feel; allow range 1–8
    const targetDuration = state.slideDuration;
    let bestBeats = 2;
    let bestDiff = Infinity;
    
    for (let b = 1; b <= 8; b++) {
        const candidateDuration = b * beatDuration;
        // Only consider durations in a sensible range (0.4s – 6s)
        if (candidateDuration < 0.4 || candidateDuration > 6.0) continue;
        const diff = Math.abs(candidateDuration - targetDuration);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestBeats = b;
        }
    }
    
    // Set slideDuration exactly to match beat duration × bestBeats
    state.slideDuration = bestBeats * beatDuration;
    
    if (renderer) {
        renderer.slideDuration = state.slideDuration;
    }
    
    // Update Slide Duration Slider UI
    if (DOM.slideDurationSlider) {
        DOM.slideDurationSlider.value = state.slideDuration;
        DOM.slideDurationSlider.disabled = true;
    }
    if (DOM.slideDurVal) {
        DOM.slideDurVal.innerHTML = `${state.slideDuration.toFixed(2)}s <span style="font-size: 10px; color: var(--primary); font-weight: bold; background: rgba(157, 78, 221, 0.15); padding: 2px 6px; border-radius: 10px; margin-left: 6px;">⚡ ${bestBeats} beat${bestBeats > 1 ? 's' : ''} @ ${bpm.toFixed(0)}BPM</span>`;
    }
    
    // Trimming the audio is dependent on the updated video length
    autoTrimCustomAudio();
}

function updateSpeedModeUI() {
    if (!DOM.speedModeManual || !DOM.speedModeAuto) return;
    
    if (state.speedMode === 'auto') {
        DOM.speedModeManual.classList.remove('active');
        DOM.speedModeAuto.classList.add('active');
        syncSpeedToBeats();
    } else {
        DOM.speedModeAuto.classList.remove('active');
        DOM.speedModeManual.classList.add('active');
        if (DOM.slideDurationSlider) {
            DOM.slideDurationSlider.disabled = false;
        }
        if (DOM.slideDurVal) {
            DOM.slideDurVal.textContent = state.slideDuration.toFixed(1) + 's';
        }
        autoTrimCustomAudio();
    }
}

function updateVideoAspectRatio() {
    const ratio = state.videoRatio || '9-16';
    const canvas = DOM.previewCanvas;
    if (!canvas) return;
    
    // Update preview canvas dimensions
    let w = 540, h = 960;
    if (ratio === '16-9') {
        w = 960; h = 540;
    } else if (ratio === '1-1') {
        w = 640; h = 640;
    } else if (ratio === '4-5') {
        w = 640; h = 800;
    }
    
    canvas.width = w;
    canvas.height = h;
    
    // Update the phone frame CSS class
    const frame = document.querySelector('.phone-frame');
    if (frame) {
        frame.className = 'phone-frame ratio-' + ratio;
    }
    
    // Refresh the renderer
    if (renderer) {
        renderer.draw(state.playTime);
    }
    
    // Update photos grid in Step 1 to show out-of-ratio badges
    checkOutOfRatioPhotos();
}

function checkOutOfRatioPhotos() {
    // Don't show ratio warnings if only mock/demo photos are loaded
    const hasRealPhotos = state.slides.some(s => !s.isMock);
    if (!hasRealPhotos) {
        document.querySelectorAll('.ratio-warning-badge').forEach(b => b.remove());
        return;
    }
    
    const ratio = state.videoRatio || '9-16';
    let targetAspect = 9 / 16;
    let ratioLabel = '9:16';
    if (ratio === '16-9') {
        targetAspect = 16 / 9;
        ratioLabel = '16:9';
    } else if (ratio === '1-1') {
        targetAspect = 1.0;
        ratioLabel = '1:1';
    } else if (ratio === '4-5') {
        targetAspect = 4 / 5;
        ratioLabel = '4:5';
    }
    
    const photoItems = document.querySelectorAll('.photo-item');
    photoItems.forEach((item) => {
        const id = item.dataset.id;
        const slide = state.slides.find(s => s.id === id);
        let badge = item.querySelector('.ratio-warning-badge');
        
        if (slide && slide.img && !slide.isMock) {
            const w = slide.img.naturalWidth;
            const h = slide.img.naturalHeight;
            if (!w || !h) { if (badge) badge.remove(); return; }
            
            const aspect = w / h;
            const diff = Math.abs(aspect - targetAspect);
            
            // 0.15 tolerance — accounts for minor rounding in phone camera ratios
            if (diff > 0.15) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'ratio-warning-badge';
                    item.appendChild(badge);
                }
                badge.textContent = `⚠️ Non-${ratioLabel}`;
                badge.style.display = 'block';
            } else {
                if (badge) badge.remove();
            }
        } else {
            // Mock or missing slide — remove any stale badge
            if (badge) badge.remove();
        }
    });
}

// Draw the Bezier Easing Curve Graph on Step 3
function drawTransitionCurve() {
    const canvas = document.getElementById('bezier-curve-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Support High DPI displays
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);
    
    // Draw background grid lines (lavender color palette)
    ctx.strokeStyle = 'rgba(124, 111, 219, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 20; x < w; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }
    for (let y = 20; y < h; y += 20) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }
    
    const paddingX = 30;
    const paddingY = 20;
    const graphW = w - paddingX * 2;
    const graphH = h - paddingY * 2;
    
    // Easing function: Ease-In-Out
    const easeInOut = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    
    // Draw curve path
    ctx.beginPath();
    ctx.strokeStyle = '#7c6fdb'; // Accent color
    ctx.lineWidth = 2.5;
    for (let i = 0; i <= 100; i++) {
        const xPercent = i / 100;
        const yPercent = easeInOut(xPercent);
        
        const px = paddingX + xPercent * graphW;
        const py = paddingY + graphH - yPercent * graphH;
        
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.stroke();
    
    // Draw axes lines (faint border)
    ctx.strokeStyle = 'rgba(124, 111, 219, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(paddingX, paddingY);
    ctx.lineTo(paddingX, paddingY + graphH);
    ctx.lineTo(paddingX + graphW, paddingY + graphH);
    ctx.stroke();
    
    // Draw Sweep playhead marker on the curve if playing
    if (state.slides.length > 0) {
        const localTime = state.playTime % state.slideDuration;
        const xPercent = localTime / state.slideDuration;
        const yPercent = easeInOut(xPercent);
        
        const px = paddingX + xPercent * graphW;
        const py = paddingY + graphH - yPercent * graphH;
        
        // Draw vertical playhead line
        ctx.strokeStyle = 'rgba(124, 111, 219, 0.3)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(px, paddingY);
        ctx.lineTo(px, paddingY + graphH);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Draw glow dot
        ctx.fillStyle = '#7c6fdb';
        ctx.shadowColor = 'rgba(124, 111, 219, 0.8)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0; // reset
    }
}

// =========================================================================
// 🎨 GPT COLLAGE POSTER PROMPT & BATCH PHOTO ZIP EXPORTER
// =========================================================================

function openGptModal() {
    if (!DOM.gptPromptModal) return;
    DOM.gptPromptModal.style.display = 'flex';
    
    // Pause playback if active
    if (state.isPlaying) {
        togglePlayback();
    }
    
    // Default selected cutouts to all slides if empty
    if (state.gptSelectedCutouts.length === 0) {
        state.gptSelectedCutouts = state.slides.map(s => s.id);
    }
    
    // Sync text and inputs
    if (DOM.gptCaptionInput) DOM.gptCaptionInput.value = state.gptPosterCaption || '';
    if (DOM.gptFontStyleSelect) DOM.gptFontStyleSelect.value = state.gptFontStyle || 'aesthetic bold & chunky font, with thick hand-drawn borders';
    if (DOM.gptLayoutStyleSelect) DOM.gptLayoutStyleSelect.value = state.gptLayoutStyle || 'overlapping layered scrapbook layout, with retro polaroid photo frames and warm indie vibes';
    
    renderGptCutoutList();
    generateGptPrompt();
}

function closeGptModal() {
    if (DOM.gptPromptModal) {
        DOM.gptPromptModal.style.display = 'none';
    }
}

function renderGptCutoutList() {
    if (!DOM.gptCutoutList) return;
    DOM.gptCutoutList.innerHTML = '';
    
    state.slides.forEach((slide, idx) => {
        const isSelected = state.gptSelectedCutouts.includes(slide.id);
        
        const card = document.createElement('div');
        card.className = `gpt-cutout-card${isSelected ? ' selected' : ''}`;
        card.dataset.slideId = slide.id;
        
        const img = document.createElement('img');
        img.src = slide.img.src;
        
        const checkbox = document.createElement('div');
        checkbox.className = 'gpt-cutout-checkbox';
        if (isSelected) {
            checkbox.classList.add('checked');
        }
        
        card.appendChild(img);
        card.appendChild(checkbox);
        
        card.addEventListener('click', () => {
            if (isSelected) {
                state.gptSelectedCutouts = state.gptSelectedCutouts.filter(id => id !== slide.id);
            } else {
                state.gptSelectedCutouts.push(slide.id);
            }
            renderGptCutoutList();
            generateGptPrompt();
            saveProjectSettingsOnly();
        });
        
        DOM.gptCutoutList.appendChild(card);
    });
    
    if (DOM.gptCutoutCount) {
        DOM.gptCutoutCount.textContent = `Selected: ${state.gptSelectedCutouts.length}`;
    }
}

function generateGptPrompt() {
    if (!DOM.gptPromptOutput) return;
    
    const caption = state.gptPosterCaption || "[ADD POSTER CAPTION]";
    const fontStyle = state.gptFontStyle || "aesthetic bold & chunky font, with thick hand-drawn borders";
    const layoutStyle = state.gptLayoutStyle || "overlapping layered scrapbook layout, with retro polaroid photo frames and warm indie vibes";
    
    const promptText = `Please create an aesthetic, bold, and cool scrapbook-style collage poster utilizing the uploaded images, following this exact layout and composition structure:

1. SUBJECT CUTOUTS:
- Isolate the main subjects from the uploaded photos to make clean transparent cutouts.
- Position these cutouts in an overlapping layered arrangement across the poster layout.
- Give each cutout a clean, bold white paper-cut sticker stroke/outline to separate them visually and add tactile depth.

2. POLAROID FRAME & PLACEMENT:
- Place a vintage white Polaroid-style photo frame at a prominent position (e.g. bottom-center).
- Inside the Polaroid frame, display a key romantic/subject scene from the images.

3. TYPOGRAPHY & CAPTION:
- Title/Caption text: "${caption}"
- Font Style: written in a very prominent, ${fontStyle}.
- Font Placement: positioned at the center or bottom-center (specifically layered over the Polaroid frame border, just like the reference style) to make it look cohesive, bold, and professional.

4. THEME & BACKGROUND:
- Style: ${layoutStyle}.
- Color Palette: Harmonious tones derived from the photos, mixed with a warm indie aesthetic, soft drop shadows behind layers to give 3D depth, and clean sticker-like textures.
- Ensure the final composition is extremely premium, artistic, and looks like a professionally designed poster.`;
    
    DOM.gptPromptOutput.value = promptText;
}

async function copyGptPrompt() {
    if (!DOM.gptPromptOutput) return;
    try {
        await navigator.clipboard.writeText(DOM.gptPromptOutput.value);
        showToast("✓ Prompt copied to clipboard!", "success");
        
        // Auto-download ZIP if checked
        if (DOM.gptAutoDownloadZip && DOM.gptAutoDownloadZip.checked) {
            setTimeout(() => {
                downloadGptCutoutsZip();
            }, 600);
        }
    } catch (err) {
        console.error("Failed to copy text: ", err);
        showToast("❌ Failed to copy prompt.", "error");
    }
}

async function downloadGptCutoutsZip() {
    if (!window.JSZip) {
        showToast("⚠️ JSZip library is not loaded.", "error");
        return;
    }
    
    const selectedIds = state.gptSelectedCutouts;
    if (selectedIds.length === 0) {
        showToast("⚠️ No images selected to download.", "warning");
        return;
    }
    
    showToast("📦 Generating ZIP file...");
    
    const zip = new JSZip();
    let addedCount = 0;
    
    for (let i = 0; i < selectedIds.length; i++) {
        const slideId = selectedIds[i];
        const slide = state.slides.find(s => s.id === slideId);
        if (!slide || !slide.img) continue;
        
        try {
            const resp = await fetch(slide.img.src);
            const blob = await resp.blob();
            // Try to extract extension or default to png
            let ext = 'png';
            if (slide.img.src.startsWith('data:image/')) {
                const match = slide.img.src.match(/data:image\/([a-zA-Z0-9+]+);base64/);
                if (match && match[1]) ext = match[1];
            } else if (slide.img.src.includes('.')) {
                ext = slide.img.src.split('.').pop().split('?')[0];
            }
            zip.file(`image_${i + 1}.${ext}`, blob);
            addedCount++;
        } catch (err) {
            console.error("Failed to fetch slide image for zip:", err);
        }
    }
    
    if (addedCount === 0) {
        showToast("⚠️ No images could be added to the ZIP.", "error");
        return;
    }
    
    try {
        const content = await zip.generateAsync({ type: "blob" });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = `collage_photos_${Date.now()}.zip`;
        link.click();
        showToast("✓ ZIP downloaded successfully!", "success");
    } catch (e) {
        console.error("Failed to generate ZIP:", e);
        showToast("❌ Failed to create ZIP file.", "error");
    }
}

function handlePosterUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(evt) {
        state.thumbnailDataUrl = evt.target.result;
        updatePosterPreviewUI();
        saveProjectSettingsOnly();
        showToast("✓ Custom cover poster uploaded successfully!", "success");
    };
    reader.readAsDataURL(file);
}

function updatePosterPreviewUI() {
    if (state.thumbnailDataUrl) {
        if (DOM.posterPreviewImg) {
            DOM.posterPreviewImg.src = state.thumbnailDataUrl;
            DOM.posterPreviewImg.style.display = 'block';
        }
        if (DOM.posterPreviewPlaceholder) {
            DOM.posterPreviewPlaceholder.style.display = 'none';
        }
        
        // Load Image object for the canvas renderer
        if (renderer) {
            const img = new Image();
            img.onload = () => {
                renderer.thumbnailImage = img;
                // Trigger a draw if the playhead is at 0 and not playing
                if (!state.isPlaying && state.playTime === 0) {
                    renderer.draw(state.playTime);
                }
            };
            img.src = state.thumbnailDataUrl;
        }
    } else {
        if (DOM.posterPreviewImg) {
            DOM.posterPreviewImg.style.display = 'none';
        }
        if (DOM.posterPreviewPlaceholder) {
            DOM.posterPreviewPlaceholder.style.display = 'flex';
        }
        if (renderer) {
            renderer.thumbnailImage = null;
            if (!state.isPlaying && state.playTime === 0) {
                renderer.draw(state.playTime);
            }
        }
    }
}

function setupGptPromptEventListeners() {
    if (DOM.btnOpenGptModal) {
        DOM.btnOpenGptModal.addEventListener('click', openGptModal);
    }
    if (DOM.gptPromptModalClose) {
        DOM.gptPromptModalClose.addEventListener('click', closeGptModal);
    }
    if (DOM.gptPromptModalOverlay) {
        DOM.gptPromptModalOverlay.addEventListener('click', closeGptModal);
    }
    
    if (DOM.gptCaptionInput) {
        DOM.gptCaptionInput.addEventListener('input', (e) => {
            state.gptPosterCaption = e.target.value;
            generateGptPrompt();
        });
        DOM.gptCaptionInput.addEventListener('change', () => {
            saveProjectSettingsOnly();
        });
    }
    
    if (DOM.gptFontStyleSelect) {
        DOM.gptFontStyleSelect.addEventListener('change', (e) => {
            state.gptFontStyle = e.target.value;
            generateGptPrompt();
            saveProjectSettingsOnly();
        });
    }
    
    if (DOM.gptLayoutStyleSelect) {
        DOM.gptLayoutStyleSelect.addEventListener('change', (e) => {
            state.gptLayoutStyle = e.target.value;
            generateGptPrompt();
            saveProjectSettingsOnly();
        });
    }
    
    if (DOM.btnGptSelectAll) {
        DOM.btnGptSelectAll.addEventListener('click', () => {
            state.gptSelectedCutouts = state.slides.map(s => s.id);
            renderGptCutoutList();
            generateGptPrompt();
            saveProjectSettingsOnly();
        });
    }
    
    if (DOM.btnGptDeselectAll) {
        DOM.btnGptDeselectAll.addEventListener('click', () => {
            state.gptSelectedCutouts = [];
            renderGptCutoutList();
            generateGptPrompt();
            saveProjectSettingsOnly();
        });
    }
    
    if (DOM.btnGptCopyPrompt) {
        DOM.btnGptCopyPrompt.addEventListener('click', copyGptPrompt);
    }
    
    if (DOM.btnGptDownloadImages) {
        DOM.btnGptDownloadImages.addEventListener('click', downloadGptCutoutsZip);
    }
    
    if (DOM.btnUploadPoster && DOM.posterUploadInput) {
        DOM.btnUploadPoster.addEventListener('click', () => {
            DOM.posterUploadInput.click();
        });
        DOM.posterUploadInput.addEventListener('change', handlePosterUpload);
    }
}
