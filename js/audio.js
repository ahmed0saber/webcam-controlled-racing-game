export class AudioEngine {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.master = null;
    this._engine = null;
    this._noiseBuffer = null;
    this.supported = typeof AudioContext !== "undefined" || typeof webkitAudioContext !== "undefined";
  }

  unlock() {
    if (!this.supported) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx) {
      try {
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? 0.9 : 0;
        this.master.connect(this.ctx.destination);
        const seconds = 0.4;
        const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * seconds), this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
        this._noiseBuffer = buffer;
      } catch {
        this.supported = false;
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
    if (!this.master) return;
    this.master.gain.value = this.enabled ? 0.9 : 0;
    if (!this.enabled) this._stopEngine();
  }

  setEngine(speed, active) {
    if (!this.ctx || !this.enabled || !active) {
      this._stopEngine();
      return;
    }
    if (!this._engine) this._startEngine();
    const kmh = Math.max(0, speed * 3.6);
    const freq = 46 + kmh * 0.62;
    const now = this.ctx.currentTime;
    this._engine.osc.frequency.setTargetAtTime(freq, now, 0.08);
    this._engine.sub.frequency.setTargetAtTime(freq * 0.5, now, 0.1);
    const vol = 0.045 + Math.min(0.07, kmh / 2800);
    this._engine.gain.gain.setTargetAtTime(vol, now, 0.06);
  }

  playCoin() {
    this._tone({ freq: 740, endFreq: 1280, dur: 0.09, type: "square", gain: 0.08 });
    this._tone({ freq: 1180, endFreq: 1680, dur: 0.12, type: "square", gain: 0.05, delay: 0.05 });
  }

  playBoost() {
    this._tone({ freq: 240, endFreq: 920, dur: 0.32, type: "sawtooth", gain: 0.07 });
    this._tone({ freq: 480, endFreq: 1400, dur: 0.28, type: "triangle", gain: 0.04, delay: 0.04 });
  }

  playCollision() {
    this._noise(0.28, 0.35, 420);
    this._tone({ freq: 140, endFreq: 55, dur: 0.28, type: "sawtooth", gain: 0.1 });
  }

  playOffroad() {
    this._noise(0.12, 0.12, 240);
  }

  playCountdown(step) {
    if (step === "GO") {
      this._tone({ freq: 660, endFreq: 1320, dur: 0.22, type: "square", gain: 0.09 });
      return;
    }
    this._tone({ freq: 620, endFreq: 620, dur: 0.12, type: "square", gain: 0.07 });
  }

  playGameOver() {
    this._stopEngine();
    this._tone({ freq: 392, endFreq: 98, dur: 0.7, type: "sawtooth", gain: 0.08 });
    this._noise(0.35, 0.18, 300);
  }

  _startEngine() {
    if (!this.ctx || this._engine) return;
    const osc = this.ctx.createOscillator();
    const sub = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    sub.type = "triangle";
    filter.type = "lowpass";
    filter.frequency.value = 420;
    gain.gain.value = 0.0001;
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start();
    sub.start();
    this._engine = { osc, sub, gain };
  }

  _stopEngine() {
    if (!this._engine || !this.ctx) {
      this._engine = null;
      return;
    }
    const { osc, sub, gain } = this._engine;
    const t = this.ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0.0001, t, 0.03);
      osc.stop(t + 0.08);
      sub.stop(t + 0.08);
    } catch {
      /* already stopped */
    }
    this._engine = null;
  }

  _tone({ freq, endFreq, dur, type, gain, delay = 0 }) {
    if (!this.ctx || !this.enabled || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, freq), t);
    if (endFreq && endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur);
    }
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  _noise(dur, gain, freq) {
    if (!this.ctx || !this.enabled || !this._noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  close() {
    this._stopEngine();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
