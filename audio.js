/**
 * Web Audio Synthesis & Sequencer Engine
 */

export class AudioEngine {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.recorderDestination = null;
        
        this.isPlaying = false;
        this.bpm = 80;
        this.tempo = 80;
        this.volume = 0.8; // Track volume inside the audio engine
        
        this.schedulerTimerId = null;
        this.customBeatTimerId = null; // Track custom beat sync timer
        this.nextNoteTime = 0.0;
        this.currentStep = 0; // 16 steps per loop
        this.scheduleAheadTime = 0.1; // 100ms
        this.lookahead = 25.0; // 25ms
        
        this.activeTheme = 'lofi';
        this.onBeatCallback = null;
        
        // Custom audio variables
        this.customAudioBuffer = null;
        this.customAudioSource = null;
        this.customAudioStart = 0.0;
        this.customAudioEnd = null;
        
        // Raw bytes for reliable cross-reload storage (Uint8Array, avoids Blob GC issues)
        this._rawBytes = null;
        
        // Beat detection results
        this.detectedBeatTimes = []; // seconds of each detected beat
        this.detectedBPM = 120;
        
        // Beat Sync metrics
        this.lastBeatTime = 0;
        this.beatDuration = 0;
    }

    init() {
        if (this.ctx) return;
        
        console.log("[AudioEngine] Initializing Web Audio Context...");
        // Create audio context
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContextClass();
        
        // Create master gain
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.volume;
        this.masterGain.connect(this.ctx.destination);
        
        // Create recorder stream destination (for MediaRecorder output)
        if (typeof this.ctx.createMediaStreamDestination === 'function') {
            this.recorderDestination = this.ctx.createMediaStreamDestination();
            this.masterGain.connect(this.recorderDestination);
        } else if (typeof this.ctx.createMediaStreamAudioDestination === 'function') {
            // Fallback for non-standard/deprecated names if present
            this.recorderDestination = this.ctx.createMediaStreamAudioDestination();
            this.masterGain.connect(this.recorderDestination);
        } else {
            console.warn("[AudioEngine] createMediaStreamDestination is not supported in this browser/environment.");
            this.recorderDestination = null;
        }
        console.log("[AudioEngine] Web Audio initialized. Volume:", this.volume);
    }

    setTheme(themeName) {
        this.activeTheme = themeName;
        if (themeName === 'lofi') {
            this.bpm = 80;
        } else if (themeName === 'upbeat') {
            this.bpm = 120;
        } else if (themeName === 'retro') {
            this.bpm = 108;
        } else if (themeName === 'none') {
            this.bpm = 90;
        }
        this.beatDuration = 60 / this.bpm;
    }

    start(onBeat) {
        this.init();
        if (this.isPlaying) this.stop();
        
        console.log("[AudioEngine] Starting playback. Current AudioContext state:", this.ctx.state);
        
        // Resume context in case browser blocked it
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().then(() => {
                console.log("[AudioEngine] AudioContext resumed successfully. State:", this.ctx.state);
            }).catch(err => {
                console.error("[AudioEngine] Error resuming AudioContext:", err);
            });
        }
        
        this.isPlaying = true;
        this.onBeatCallback = onBeat;
        this.currentStep = 0;
        this.nextNoteTime = this.ctx.currentTime + 0.05;
        this.beatDuration = 60 / this.bpm;
        
        if (this.activeTheme === 'custom' && this.customAudioBuffer) {
            // Play custom audio buffer & start beat sync loop
            this.playCustomBuffer();
        } else if (this.activeTheme !== 'none') {
            // Start procedural sequencer
            this.schedulerLoop();
        }
    }

    stop() {
        console.log("[AudioEngine] Stopping playback.");
        this.isPlaying = false;
        
        if (this.schedulerTimerId) {
            clearTimeout(this.schedulerTimerId);
            this.schedulerTimerId = null;
        }
        
        if (this.customBeatTimerId) {
            clearTimeout(this.customBeatTimerId);
            this.customBeatTimerId = null;
        }
        
        if (this.customAudioSource) {
            try {
                this.customAudioSource.stop();
            } catch (e) {}
            this.customAudioSource = null;
        }
    }

    setVolume(volume) {
        this.volume = volume;
        if (this.masterGain) {
            this.masterGain.gain.setValueAtTime(volume, this.ctx ? this.ctx.currentTime : 0);
            console.log("[AudioEngine] Volume set to:", volume);
        } else {
            console.log("[AudioEngine] Volume stored as (no masterGain yet):", volume);
        }
    }

    getAudioStream() {
        this.init();
        return this.recorderDestination ? this.recorderDestination.stream : null;
    }

    // --- Custom Audio File Loading ---
    loadCustomAudioFile(fileOrBuffer) {
        return new Promise((resolve, reject) => {
            this.init();
            
            const processBuffer = (arrayBuffer) => {
                // Store raw bytes for reliable persistence (copy before neutering by decodeAudioData)
                this._rawBytes = new Uint8Array(arrayBuffer.slice(0));
                
                // decodeAudioData neuters the arrayBuffer — we pass a copy
                const bufferCopy = arrayBuffer.slice(0);
                this.ctx.decodeAudioData(bufferCopy, (decodedBuffer) => {
                    this.customAudioBuffer = decodedBuffer;
                    this.setTheme('custom');
                    this.customAudioStart = 0.0;
                    this.customAudioEnd = decodedBuffer.duration;
                    
                    // Run beat detection asynchronously (doesn't block playback)
                    this.detectBeats(decodedBuffer).then(({ bpm, beatTimes }) => {
                        this.detectedBPM = bpm;
                        this.detectedBeatTimes = beatTimes;
                        this.bpm = bpm;
                        this.beatDuration = 60 / bpm;
                        console.log(`[AudioEngine] Beat detection: ${bpm.toFixed(1)} BPM, ${beatTimes.length} beats`);
                        // Notify app that beat detection is done so it can re-sync if needed
                        window.dispatchEvent(new CustomEvent('audio-beat-detected', { detail: { bpm, beatTimes } }));
                    }).catch(() => {
                        // Fallback to 120 BPM
                        this.bpm = 120;
                        this.beatDuration = 60 / 120;
                    });
                    
                    resolve(decodedBuffer);
                }, (err) => {
                    reject(err);
                });
            };
            
            if (fileOrBuffer instanceof Uint8Array) {
                // Stored as Uint8Array from IndexedDB — convert to ArrayBuffer
                processBuffer(fileOrBuffer.buffer.slice(fileOrBuffer.byteOffset, fileOrBuffer.byteOffset + fileOrBuffer.byteLength));
            } else if (fileOrBuffer instanceof ArrayBuffer) {
                processBuffer(fileOrBuffer);
            } else {
                // File object
                const reader = new FileReader();
                reader.onload = (e) => processBuffer(e.target.result);
                reader.onerror = (e) => reject(e);
                reader.readAsArrayBuffer(fileOrBuffer);
            }
        });
    }

    /**
     * Detect beats using OfflineAudioContext + energy onset detection.
     * Returns { bpm, beatTimes } where beatTimes is an array of beat positions in seconds.
     * This is an industry-standard approach: high-pass filter → rectify → window energy → find peaks.
     */
    async detectBeats(audioBuffer) {
        const sampleRate = audioBuffer.sampleRate;
        const numChannels = audioBuffer.numberOfChannels;
        const length = audioBuffer.length;
        
        // Use OfflineAudioContext to process the audio offline
        const offlineCtx = new OfflineAudioContext(1, length, sampleRate);
        
        // Create buffer source
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        
        // High-pass filter at 150Hz to isolate mid-high frequencies (best for beat detection)
        const highpass = offlineCtx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 150;
        
        source.connect(highpass);
        highpass.connect(offlineCtx.destination);
        source.start(0);
        
        const renderedBuffer = await offlineCtx.startRendering();
        const rawData = renderedBuffer.getChannelData(0);
        
        // Step 1: Full-wave rectify
        const rectified = new Float32Array(rawData.length);
        for (let i = 0; i < rawData.length; i++) {
            rectified[i] = Math.abs(rawData[i]);
        }
        
        // Step 2: Compute energy in overlapping windows (beat tracking resolution ~10ms)
        const windowMs = 10; // 10ms windows
        const windowSize = Math.floor(sampleRate * windowMs / 1000);
        const hopSize = Math.floor(windowSize / 2);
        const energies = [];
        
        for (let i = 0; i < rectified.length - windowSize; i += hopSize) {
            let energy = 0;
            for (let j = 0; j < windowSize; j++) {
                energy += rectified[i + j] * rectified[i + j];
            }
            energies.push(energy / windowSize);
        }
        
        // Step 3: Onset detection — find local maxima with adaptive threshold
        const localWindow = 43; // ~430ms local context at 10ms/hop
        const threshold = 1.5; // Peak must be 1.5x local median
        const onsets = []; // in seconds
        
        for (let i = localWindow; i < energies.length - localWindow; i++) {
            const local = energies.slice(i - localWindow, i + localWindow);
            const sorted = [...local].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            const localMedian = median || 1e-9;
            
            if (energies[i] > localMedian * threshold) {
                // Check it's a local maximum
                let isPeak = true;
                for (let k = i - 3; k <= i + 3; k++) {
                    if (k !== i && energies[k] >= energies[i]) {
                        isPeak = false;
                        break;
                    }
                }
                if (isPeak) {
                    const timeSeconds = (i * hopSize) / sampleRate;
                    onsets.push(timeSeconds);
                }
            }
        }
        
        // Step 4: Estimate BPM from inter-onset intervals (IOIs)
        let estimatedBPM = 120;
        if (onsets.length >= 2) {
            const iois = [];
            for (let i = 1; i < onsets.length; i++) {
                const diff = onsets[i] - onsets[i - 1];
                if (diff > 0.2 && diff < 2.0) { // Only consider IOIs in 30-300 BPM range
                    iois.push(diff);
                }
            }
            
            if (iois.length > 0) {
                // Find mode (most common IOI via histogram)
                iois.sort((a, b) => a - b);
                const median = iois[Math.floor(iois.length / 2)];
                const candidateBPM = 60 / median;
                
                // Bring into typical BPM range (60-200)
                let bpm = candidateBPM;
                while (bpm < 60) bpm *= 2;
                while (bpm > 200) bpm /= 2;
                estimatedBPM = bpm;
            }
        }
        
        // Step 5: Build regular beat grid from estimated BPM and first onset
        const beatInterval = 60 / estimatedBPM;
        const firstBeat = onsets.length > 0 ? onsets[0] : 0;
        const beatTimes = [];
        for (let t = firstBeat; t < audioBuffer.duration; t += beatInterval) {
            beatTimes.push(Math.round(t * 1000) / 1000);
        }
        
        return { bpm: estimatedBPM, beatTimes };
    }

    playCustomBuffer() {
        if (!this.isPlaying || this.activeTheme !== 'custom' || !this.customAudioBuffer || !this.ctx) return;
        
        if (this.customAudioSource) {
            try {
                this.customAudioSource.stop();
            } catch (e) {}
            this.customAudioSource = null;
        }
        
        console.log("[AudioEngine] Playing custom buffer. Trim Start:", this.customAudioStart, "Trim End:", this.customAudioEnd);
        this.customAudioSource = this.ctx.createBufferSource();
        this.customAudioSource.buffer = this.customAudioBuffer;
        this.customAudioSource.loop = true;
        this.customAudioSource.loopStart = this.customAudioStart || 0;
        this.customAudioSource.loopEnd = this.customAudioEnd || this.customAudioBuffer.duration;
        this.customAudioSource.connect(this.masterGain);
        
        // Start playback at the loopStart offset
        this.customAudioSource.start(0, this.customAudioSource.loopStart);
        
        // Start beat sync callback loop
        this.startCustomBeatSyncLoop();
    }

    restartCustomBuffer() {
        this.playCustomBuffer();
    }

    startCustomBeatSyncLoop() {
        if (this.customBeatTimerId) {
            clearTimeout(this.customBeatTimerId);
            this.customBeatTimerId = null;
        }
        
        this.lastBeatTime = this.ctx.currentTime;
        const triggerBeat = () => {
            if (!this.isPlaying || this.activeTheme !== 'custom' || !this.ctx) return;
            const now = this.ctx.currentTime;
            this.lastBeatTime = now;
            if (this.onBeatCallback) {
                // Call beat sync callback (once every quarter note)
                this.onBeatCallback(now);
            }
            this.customBeatTimerId = setTimeout(triggerBeat, this.beatDuration * 1000);
        };
        triggerBeat();
    }

    // --- Procedural Synth Tracks ---
    
    schedulerLoop() {
        while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
            this.scheduleNote(this.currentStep, this.nextNoteTime);
            
            // Advance to next step (sixteenth notes)
            const secondsPerStep = 60.0 / this.bpm / 4.0; // 16th note duration
            this.nextNoteTime += secondsPerStep;
            
            // If it is a quarter note beat, call the beat callback
            if (this.currentStep % 4 === 0) {
                this.lastBeatTime = this.nextNoteTime - secondsPerStep;
                if (this.onBeatCallback) {
                    this.onBeatCallback(this.lastBeatTime);
                }
            }
            
            this.currentStep = (this.currentStep + 1) % 16;
        }
        
        if (this.isPlaying) {
            this.schedulerTimerId = setTimeout(() => this.schedulerLoop(), this.lookahead);
        }
    }

    scheduleNote(step, time) {
        if (this.activeTheme === 'lofi') {
            this.scheduleLofiNote(step, time);
        } else if (this.activeTheme === 'upbeat') {
            this.scheduleUpbeatNote(step, time);
        } else if (this.activeTheme === 'retro') {
            this.scheduleRetroNote(step, time);
        }
    }

    // --- Kick Synth ---
    triggerKick(time, gainVal = 1.0) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.connect(gain);
        gain.connect(this.masterGain);
        
        // Sweep frequency rapidly from 150Hz to 45Hz
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(45, time + 0.1);
        
        // Sharp volume envelope
        gain.gain.setValueAtTime(gainVal, time);
        gain.gain.linearRampToValueAtTime(0.01, time + 0.12);
        
        osc.start(time);
        osc.stop(time + 0.13);
    }

    // --- Snare Synth ---
    triggerSnare(time, gainVal = 0.5) {
        // Noise buffer
        const bufferSize = this.ctx.sampleRate * 0.2; // 200ms
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noiseNode = this.ctx.createBufferSource();
        noiseNode.buffer = buffer;
        
        // Snare filter
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1000, time);
        
        const gain = this.ctx.createGain();
        
        noiseNode.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        
        gain.gain.setValueAtTime(gainVal, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.18);
        
        noiseNode.start(time);
        noiseNode.stop(time + 0.2);

        // Add a small pitch pop
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, time);
        osc.frequency.exponentialRampToValueAtTime(100, time + 0.1);
        
        oscGain.gain.setValueAtTime(gainVal * 0.8, time);
        oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.08);
        
        osc.connect(oscGain);
        oscGain.connect(this.masterGain);
        osc.start(time);
        osc.stop(time + 0.09);
    }

    // --- Hi-Hat Synth ---
    triggerHihat(time, gainVal = 0.2) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        
        osc.type = 'square';
        osc.frequency.setValueAtTime(10000, time);
        
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(7000, time);
        
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        
        gain.gain.setValueAtTime(gainVal, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
        
        osc.start(time);
        osc.stop(time + 0.05);
    }

    // --- Chord Pluck/Pad Synthesizer ---
    triggerSynthNote(time, freq, duration, type = 'triangle', filterStart = 800, filterEnd = 200, volume = 0.3) {
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator(); // Detuned voice
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        
        osc1.type = type;
        osc1.frequency.setValueAtTime(freq, time);
        
        osc2.type = type;
        osc2.frequency.setValueAtTime(freq * 1.01, time); // detune
        
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(filterStart, time);
        filter.frequency.exponentialRampToValueAtTime(filterEnd, time + duration);
        
        gain.gain.setValueAtTime(volume, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
        
        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        
        osc1.start(time);
        osc2.start(time);
        
        osc1.stop(time + duration + 0.02);
        osc2.stop(time + duration + 0.02);
    }

    // --- LOFI THEME CHOREOGRAPHY ---
    scheduleLofiNote(step, time) {
        // Drums (Boom-Bap style lofi groove)
        // Step 0: Kick, Step 4: Snare, Step 8: Kick, Step 9: Kick, Step 12: Snare
        if (step === 0 || step === 8) {
            this.triggerKick(time, 0.8);
        } else if (step === 9) {
            this.triggerKick(time, 0.5); // Ghost kick
        } else if (step === 4 || step === 12) {
            this.triggerSnare(time, 0.35);
        }
        
        // Hi-hats on every eighth note with swing
        if (step % 2 === 0) {
            const isOffBeat = step % 4 === 2;
            this.triggerHihat(time, isOffBeat ? 0.06 : 0.03);
        }

        // Lofi chord progression (Cmaj7 - Am7 - Dm7 - G7)
        // Arpeggiated slow notes
        const chords = [
            [261.63, 329.63, 392.00, 493.88], // Cmaj7 (C4, E4, G4, B4)
            [220.00, 261.63, 329.63, 392.00], // Am7 (A3, C4, E4, G4)
            [293.66, 349.23, 440.00, 587.33], // Dm7 (D4, F4, A4, D5)
            [196.00, 246.94, 293.66, 349.23]  // G7 (G3, B3, D4, F4)
        ];
        
        const loopIdx = Math.floor(this.currentStep / 16); // wait, currentStep is inside 16 steps
        // Let's use a 4-bar progression (one chord per 16 steps)
        // We need a loop counter that increments every 16 steps. 
        // We can infer bar from the absolute step count, but let's just make a tracking variable or compute it:
        const bar = Math.floor(time * (this.bpm / 60) / 4) % 4;
        const chord = chords[bar];
        
        // Lofi Synth Chords (Soft pad on step 0 and 8, arpeggiating note on step 0, 3, 6, 9)
        if (step === 0) {
            // Trigger chord root and minor pad
            chord.forEach((freq, idx) => {
                this.triggerSynthNote(time, freq, 1.8, 'triangle', 600, 150, 0.08 - idx * 0.01);
            });
        }
        
        // Ambient lead notes (very sparse, pentatonic lofi melody)
        const melodyPattern = [
            { step: 2, note: 2 },
            { step: 6, note: 3 },
            { step: 10, note: 1 },
            { step: 14, note: 0 }
        ];
        
        const mel = melodyPattern.find(m => m.step === step);
        if (mel && Math.random() > 0.4) {
            const freq = chord[mel.note] * 2; // Octave higher
            this.triggerSynthNote(time, freq, 0.8, 'sine', 800, 300, 0.03);
        }
    }

    // --- UPBEAT FUTURE POP THEME CHOREOGRAPHY ---
    scheduleUpbeatNote(step, time) {
        // Dance beat: 4-on-the-floor kick
        if (step % 4 === 0) {
            this.triggerKick(time, 1.0);
        }
        
        // Snare on 4 and 12
        if (step === 4 || step === 12) {
            this.triggerSnare(time, 0.6);
        }
        
        // Fast hi-hats on off-beats
        if (step % 2 === 2) {
            this.triggerHihat(time, 0.12);
        }
        
        // Future pop chord progression (I - V - vi - IV: G - D - Em - C)
        const chords = [
            [196.00, 246.94, 293.66, 392.00], // G major
            [293.66, 369.99, 440.00, 587.33], // D major
            [164.81, 246.94, 329.63, 392.00], // E minor
            [261.63, 329.63, 392.00, 523.25]  // C major
        ];
        
        const bar = Math.floor(time * (this.bpm / 60) / 4) % 4;
        const chord = chords[bar];
        
        // Bouncy pluck synth on rhythm
        // Rhythm: 0, 3, 6, 8, 11, 14
        const popRhythm = [0, 3, 6, 8, 11, 14];
        if (popRhythm.includes(step)) {
            chord.forEach((freq, idx) => {
                // Bright sawtooth waves with fast decay
                this.triggerSynthNote(time, freq, 0.3, 'sawtooth', 1200, 200, 0.05 - idx * 0.008);
            });
        }
    }

    // --- RETRO SYNTHWAVE THEME CHOREOGRAPHY ---
    scheduleRetroNote(step, time) {
        // Driving beat
        if (step === 0 || step === 8) {
            this.triggerKick(time, 0.9);
        } else if (step === 4 || step === 12) {
            this.triggerSnare(time, 0.55);
        }
        
        // Hi-hats driving eighth notes
        if (step % 2 === 0) {
            this.triggerHihat(time, 0.05);
        }
        
        // Synthwave driving octaves bassline (C - Eb - G - F)
        const basslines = [130.81, 155.56, 196.00, 174.61]; // C3, Eb3, G3, F3
        const bar = Math.floor(time * (this.bpm / 60) / 4) % 4;
        const bassBase = basslines[bar];
        
        // Alternate bassline note on 8th notes
        if (step % 2 === 0) {
            const octave = (step % 4 === 0) ? 1.0 : 0.5; // alternate octaves (Root, Octave)
            const freq = bassBase * octave;
            this.triggerSynthNote(time, freq, 0.18, 'sawtooth', 700, 100, 0.08);
        }
        
        // Detuned brass synth on step 0 and 10
        const brassChords = [
            [261.63, 329.63, 392.00, 523.25], // C Major
            [311.13, 392.00, 466.16, 622.25], // Eb Major
            [392.00, 493.88, 587.33, 783.99], // G Major
            [349.23, 440.00, 523.25, 698.46]  // F Major
        ];
        
        const chord = brassChords[bar];
        
        if (step === 0 || step === 6) {
            chord.forEach((freq, idx) => {
                this.triggerSynthNote(time, freq, 0.8, 'sawtooth', 1500, 300, 0.04);
            });
        }
    }
}
