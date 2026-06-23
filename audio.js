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
        this.recorderDestination = this.ctx.createMediaStreamAudioDestination();
        this.masterGain.connect(this.recorderDestination);
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
        return this.recorderDestination.stream;
    }

    // --- Custom Audio File Loading ---
    loadCustomAudioFile(file) {
        return new Promise((resolve, reject) => {
            this.init();
            const reader = new FileReader();
            reader.onload = (e) => {
                const arrayBuffer = e.target.result;
                this.ctx.decodeAudioData(arrayBuffer, (decodedBuffer) => {
                    this.customAudioBuffer = decodedBuffer;
                    this.setTheme('custom');
                    // Estimate BPM roughly or set to standard 120
                    this.bpm = 120;
                    this.beatDuration = 60 / this.bpm;
                    this.customAudioStart = 0.0;
                    this.customAudioEnd = decodedBuffer.duration;
                    resolve(decodedBuffer);
                }, (err) => {
                    reject(err);
                });
            };
            reader.readAsArrayBuffer(file);
        });
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
