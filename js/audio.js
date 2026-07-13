"use strict";
// Zvuk: akustické vário, vítr, vlečná, události. Vše WebAudio, bez assetů.
class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.beepTimer = 0;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);

    // vário pípák
    this.varioOsc = ctx.createOscillator();
    this.varioOsc.type = "triangle";
    this.varioOsc.frequency.value = 500;
    this.varioGain = ctx.createGain();
    this.varioGain.gain.value = 0;
    this.varioOsc.connect(this.varioGain).connect(this.master);
    this.varioOsc.start();

    // tón klesání
    this.sinkOsc = ctx.createOscillator();
    this.sinkOsc.type = "sawtooth";
    this.sinkOsc.frequency.value = 220;
    this.sinkGain = ctx.createGain();
    this.sinkGain.gain.value = 0;
    const sinkFlt = ctx.createBiquadFilter();
    sinkFlt.type = "lowpass"; sinkFlt.frequency.value = 500;
    this.sinkOsc.connect(sinkFlt).connect(this.sinkGain).connect(this.master);
    this.sinkOsc.start();

    // šum (vítr + buffet)
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = buf; this.windSrc.loop = true;
    this.windFlt = ctx.createBiquadFilter();
    this.windFlt.type = "bandpass"; this.windFlt.frequency.value = 600; this.windFlt.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFlt).connect(this.windGain).connect(this.master);
    this.windSrc.start();

    // motor vlečné
    this.engOsc = ctx.createOscillator();
    this.engOsc.type = "sawtooth"; this.engOsc.frequency.value = 82;
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = "square"; this.engOsc2.frequency.value = 41;
    const engFlt = ctx.createBiquadFilter();
    engFlt.type = "lowpass"; engFlt.frequency.value = 320;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engOsc.connect(engFlt); this.engOsc2.connect(engFlt);
    engFlt.connect(this.engGain).connect(this.master);
    this.engOsc.start(); this.engOsc2.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
    return this.muted;
  }

  // volat každý frame
  update(dt, st) {
    // st: {vario, speed, mode, buffet, towing}
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // ---- vário ----
    const v = st.vario;
    if (st.flying && v > 0.12) {
      const rate = 1.5 + Math.min(v, 5.5) * 0.85;   // pípání/s
      this.beepTimer -= dt * rate;
      if (this.beepTimer <= 0) {
        this.beepTimer = 1;
        const f = 420 + Math.min(v, 6) * 115;
        this.varioOsc.frequency.setValueAtTime(f, t);
        this.varioGain.gain.cancelScheduledValues(t);
        this.varioGain.gain.setValueAtTime(0.14, t);
        this.varioGain.gain.setValueAtTime(0.14, t + 0.55 / rate * 0.6);
        this.varioGain.gain.linearRampToValueAtTime(0, t + 0.55 / rate * 0.6 + 0.02);
      }
    } else {
      this.beepTimer = 0;
    }
    // klesák
    const sinkVol = (st.flying && v < -1.4) ? Math.min((-v - 1.4) * 0.05, 0.12) : 0;
    this.sinkGain.gain.setTargetAtTime(sinkVol, t, 0.15);
    if (sinkVol > 0) this.sinkOsc.frequency.setTargetAtTime(240 + v * 14, t, 0.2);

    // ---- vítr ----
    const sp = st.speed || 0;
    let wv = st.flying ? Math.pow(Math.max(sp - 14, 0) / 55, 1.7) * 0.32 : 0;
    if (st.buffet) wv = Math.max(wv, 0.22 + 0.1 * Math.sin(t * 30)); // třepání před pádem
    this.windGain.gain.setTargetAtTime(wv, t, 0.1);
    this.windFlt.frequency.setTargetAtTime(380 + sp * 11 + (st.buffet ? -180 : 0), t, 0.15);

    // ---- vlečná ----
    this.engGain.gain.setTargetAtTime(st.towing ? 0.14 : 0, t, 0.25);
  }

  thud(strong) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = "lowpass"; flt.frequency.value = strong ? 160 : 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(strong ? 0.8 : 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (strong ? 0.7 : 0.3));
    src.connect(flt).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 1);
  }

  snap() { // vypnutí vleku
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "square"; o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(200, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.12);
  }
}
