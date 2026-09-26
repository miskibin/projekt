/**
 * Syntezowane efekty dźwiękowe (WebAudio) – zero plików assetów.
 * AudioContext tworzymy dopiero przy pierwszej interakcji użytkownika.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastJet = 0;
  private lastBlast = -Infinity;
  private unlocked = false;
  private _volume = 0.6;

  constructor() {
    const stored = localStorage.getItem("worms.volume");
    if (stored !== null) {
      const v = Number(stored);
      if (Number.isFinite(v)) this._volume = Math.max(0, Math.min(1, v));
    }
  }

  get volume(): number {
    return this._volume;
  }

  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    localStorage.setItem("worms.volume", String(this._volume));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.01);
  }

  /** Wywołaj z handlera zdarzenia użytkownika (klik/klawisz). */
  unlock(): void {
    this.unlocked = true;
    this.ensure();
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this._volume;
    this.master.connect(this.ctx.destination);

    const len = Math.floor(this.ctx.sampleRate * 1.2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return this.ctx;
  }

  /** Nazwy zgodne ze zdarzeniem `sound` z protokołu. */
  play(name: string): void {
    if (!this.unlocked) return; // przeglądarka i tak zablokuje dźwięk przed interakcją
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    if (name.startsWith("explosion:")) {
      // Salwy odłamków nie mogą nakładać kilkunastu identycznych głośnych dźwięków.
      if (t - this.lastBlast < 0.065) return;
      this.lastBlast = t;
      const style = name.slice(10);
      if (style === "holy") {
        this.noise(t, 0.95, 650, 0.65, "lowpass", 120);
        this.tone(t, "sine", 160, 34, 0.68, 0.85);
        for (const [i, f] of [523, 659, 784].entries()) this.tone(t + i * 0.035, "sine", f, f * 0.74, 0.12, 0.65);
      } else if (style === "dynamite" || style === "mine") {
        this.noise(t, 0.85, 850, 0.84, "lowpass", 95);
        this.tone(t, "sine", 115, 37, 0.65, 0.7);
        this.noise(t + 0.075, 0.4, 1300, 0.18, "bandpass", 300);
      } else if (style === "cluster" || style === "banana" || style === "airstrike") {
        this.noise(t, 0.26, style === "banana" ? 1900 : 1350, 0.52, "bandpass", 250);
        this.tone(t, "triangle", style === "banana" ? 310 : 170, 60, 0.3, 0.32);
      } else if (style === "shotgun" || style === "uzi") {
        this.noise(t, 0.14, 2500, 0.26, "highpass");
      } else {
        this.noise(t, 0.57, 1100, 0.68, "lowpass", 150);
        this.tone(t, "sine", 150, 48, 0.46, 0.46);
      }
      return;
    }
    switch (name) {
      case "explosion":
        this.noise(t, 0.75, 900, 0.9, "lowpass");
        this.tone(t, "sine", 120, 42, 0.55, 0.55);
        this.tone(t + 0.02, "triangle", 70, 30, 0.35, 0.7);
        break;
      case "shot":
      case "fire":
        this.noise(t, 0.16, 2600, 0.45, "highpass");
        this.tone(t, "sawtooth", 320, 90, 0.22, 0.18);
        break;
      case "uzi":
        this.noise(t, 0.065, 4300, 0.23, "highpass");
        this.tone(t, "square", 460, 170, 0.12, 0.06);
        break;
      case "shotgun":
        this.noise(t, 0.34, 2100, 0.62, "bandpass", 180);
        this.tone(t, "sine", 170, 48, 0.38, 0.27);
        break;
      case "jump":
        this.tone(t, "sine", 320, 620, 0.18, 0.14);
        break;
      case "hit":
      case "damage":
        this.noise(t, 0.12, 1400, 0.35, "bandpass");
        this.tone(t, "square", 200, 90, 0.16, 0.12);
        break;
      case "pickup":
        this.tone(t, "sine", 660, 660, 0.14, 0.1);
        this.tone(t + 0.09, "sine", 990, 990, 0.16, 0.12);
        break;
      case "splash":
        this.noise(t, 0.5, 1800, 0.42, "bandpass", 700);
        this.tone(t, "sine", 420, 120, 0.16, 0.3);
        break;
      case "hallelujah": {
        const chord = [523.25, 659.25, 783.99, 1046.5];
        chord.forEach((f, i) => this.tone(t + i * 0.06, "sine", f, f, 0.16, 0.9));
        break;
      }
      case "tick":
        this.tone(t, "square", 1200, 1200, 0.09, 0.035);
        break;
      case "bat":
        this.noise(t, 0.12, 1800, 0.4, "bandpass", 900);
        this.tone(t, "triangle", 500, 160, 0.25, 0.14);
        break;
      case "teleport":
        this.tone(t, "sine", 180, 1500, 0.2, 0.35);
        this.noise(t, 0.3, 2600, 0.16, "highpass");
        break;
      case "jetpack": {
        const now = performance.now();
        if (now - this.lastJet < 110) return;
        this.lastJet = now;
        this.noise(t, 0.2, 700, 0.16, "bandpass", 420);
        break;
      }
      case "crate":
      case "crateSpawn":
        this.tone(t, "sine", 300, 500, 0.12, 0.2);
        break;
      case "died":
      case "death":
        this.tone(t, "sawtooth", 260, 70, 0.24, 0.5);
        break;
      default:
        this.tone(t, "sine", 440, 440, 0.1, 0.08);
    }
  }

  private tone(
    at: number,
    type: OscillatorType,
    f0: number,
    f1: number,
    gain: number,
    dur: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  private noise(
    at: number,
    dur: number,
    cutoff: number,
    gain: number,
    filter: BiquadFilterType,
    cutoffEnd?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(cutoff, at);
    if (cutoffEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(40, cutoffEnd), at + dur);
    f.Q.value = filter === "bandpass" ? 1.2 : 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(at, Math.random() * 0.2);
    src.stop(at + dur + 0.05);
  }
}
