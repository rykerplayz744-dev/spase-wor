// Procedural Web Audio API synthesizer for Spacewar! vector combat

class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;
  private thrustGain: GainNode | null = null;
  private thrustOsc: OscillatorNode | null = null;
  private isThrustPlaying: boolean = false;

  constructor() {
    const savedMute = localStorage.getItem('spacewar_muted');
    if (savedMute === 'true') {
      this.muted = true;
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem('spacewar_muted', String(this.muted));
    if (this.muted) {
      this.stopThrust();
    }
    return this.muted;
  }

  public playLaser(hull: string = 'needle') {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = hull === 'wedge' ? 'sawtooth' : hull === 'disc' ? 'triangle' : 'square';
    const startFreq = hull === 'wedge' ? 520 : hull === 'interceptor' ? 980 : 760;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.11);

    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  public updateThrust(active: boolean, currentSpeed: number) {
    if (this.muted || !active) {
      this.stopThrust();
      return;
    }
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    if (!this.isThrustPlaying) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      // Pitch scales subtly with ship's infinite momentum so player feels the velocity climbing
      const freq = 58 + Math.min(180, currentSpeed * 0.045);
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.045, now + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);

      this.thrustOsc = osc;
      this.thrustGain = gain;
      this.isThrustPlaying = true;
    } else if (this.thrustOsc && this.thrustGain) {
      const freq = 58 + Math.min(220, currentSpeed * 0.045);
      this.thrustOsc.frequency.setTargetAtTime(freq, now, 0.04);
    }
  }

  public stopThrust() {
    if (!this.isThrustPlaying) return;
    try {
      if (this.thrustGain && this.ctx) {
        this.thrustGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.02);
      }
      if (this.thrustOsc) {
        this.thrustOsc.stop(this.ctx ? this.ctx.currentTime + 0.04 : undefined);
        this.thrustOsc.disconnect();
      }
    } catch {
      // ignore already stopped
    }
    this.thrustOsc = null;
    this.thrustGain = null;
    this.isThrustPlaying = false;
  }

  public playHit(fatal: boolean = false) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = fatal ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(fatal ? 220 : 340, now);
    osc.frequency.exponentialRampToValueAtTime(fatal ? 32 : 75, now + (fatal ? 0.42 : 0.14));

    gain.gain.setValueAtTime(fatal ? 0.18 : 0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (fatal ? 0.42 : 0.14));

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + (fatal ? 0.44 : 0.15));
  }

  public playWarp() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(920, now + 0.18);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  public playMissileLaunch() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.22);

    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.23);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
  }
}

export const soundEngine = new SoundEngine();
