// Procedural sound effects (WebAudio synthesis, no sample files) with 3D positioning.
import { WEAPONS } from '../../sim/weapons';
import type { Vec3 } from '../../sim/math';

type Cls = 'pistol' | 'rifle' | 'smg' | 'sniper' | 'shotgun' | 'lmg' | 'knife' | 'other';

const GUN: Record<Cls, { freq: number; q: number; dur: number; thump: number; gain: number; tail: number }> = {
  pistol: { freq: 1900, q: 0.9, dur: 0.12, thump: 110, gain: 0.7, tail: 0.25 },
  rifle: { freq: 1300, q: 0.7, dur: 0.18, thump: 75, gain: 0.95, tail: 0.5 },
  smg: { freq: 1700, q: 0.8, dur: 0.12, thump: 95, gain: 0.75, tail: 0.3 },
  sniper: { freq: 900, q: 0.6, dur: 0.35, thump: 55, gain: 1.2, tail: 1.1 },
  shotgun: { freq: 700, q: 0.4, dur: 0.25, thump: 60, gain: 1.1, tail: 0.6 },
  lmg: { freq: 1150, q: 0.7, dur: 0.17, thump: 70, gain: 0.95, tail: 0.5 },
  knife: { freq: 3000, q: 1.5, dur: 0.12, thump: 0, gain: 0.3, tail: 0 },
  other: { freq: 1500, q: 0.8, dur: 0.12, thump: 80, gain: 0.6, tail: 0.3 },
};

export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private ui!: GainNode;
  private noise!: AudioBuffer;
  private musicNodes: AudioNode[] = [];
  private musicTimer = 0;
  private fireLoops = new Map<number, { src: AudioBufferSourceNode; gain: GainNode }>();
  private tinnitus: { osc: OscillatorNode; gain: GainNode } | null = null;
  volumes = { master: 0.8, sfx: 0.9, music: 0.5, ui: 0.6 };

  /** Must be called from a user gesture (browser autoplay policy). */
  init(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.connect(this.master);
    this.ui = c.createGain(); this.ui.connect(this.master);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.sfx.gain.value = this.volumes.sfx;
    this.music.gain.value = this.volumes.music * 0.35;
    this.ui.gain.value = this.volumes.ui;
  }

  setListener(pos: Vec3, fwd: Vec3): void {
    const c = this.ctx;
    if (!c) return;
    const L = c.listener;
    const t = c.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else {
      (L as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
      (L as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void }).setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  /** Output node: positional panner or direct for our own sounds. */
  private out(pos: Vec3 | null, gain = 1, bus?: GainNode): GainNode {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.value = gain;
    if (pos) {
      const p = c.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 3;
      p.rolloffFactor = 1.1;
      p.maxDistance = 120;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
      g.connect(p).connect(bus ?? this.sfx);
    } else g.connect(bus ?? this.sfx);
    return g;
  }

  private noiseBurst(dest: AudioNode, t0: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, attack = 0.002, freqEnd?: number): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    const g = c.createGain();
    gain = Math.max(0.0002, gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0, Math.random() * 1.5, dur + 0.05);
  }

  private tone(dest: AudioNode, t0: number, dur: number, freq: number, type: OscillatorType, gain: number, freqEnd?: number, attack = 0.003): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    const g = c.createGain();
    gain = Math.max(0.0002, gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private cls(weapon: string): Cls {
    const c = WEAPONS[weapon]?.cls;
    return c === 'pistol' || c === 'rifle' || c === 'smg' || c === 'sniper' || c === 'shotgun' || c === 'lmg' || c === 'knife' ? c : c === 'training' ? 'pistol' : 'other';
  }

  gunshot(weapon: string, pos: Vec3 | null, distance = 0): void {
    if (!this.ctx) return;
    const p = GUN[this.cls(weapon)];
    const t = this.ctx.currentTime;
    const far = Math.min(1, distance / 60);
    const out = this.out(pos, p.gain * (pos ? 1.6 : 0.8));
    if (this.cls(weapon) === 'knife') { this.noiseBurst(out, t, 0.16, 'bandpass', 2500, 2, 0.35, 0.02, 6000); return; }
    this.noiseBurst(out, t, p.dur, 'bandpass', p.freq * (1 - far * 0.5), p.q, 0.9);
    this.noiseBurst(out, t, p.tail, 'lowpass', 900 * (1 - far * 0.6), 0.5, 0.35, 0.004, 120);
    if (p.thump) this.tone(out, t, 0.12, p.thump * 2, 'sine', 0.8 * (1 - far), p.thump * 0.6);
    if (!pos) this.noiseBurst(out, t + 0.01, 0.03, 'highpass', 4000, 0.7, 0.25);
  }

  footstep(pos: Vec3 | null, loud: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.out(pos, loud ? (pos ? 1.3 : 0.35) : 0.12);
    this.noiseBurst(out, t, 0.07, 'lowpass', 700 + Math.random() * 400, 1.2, 0.7, 0.004);
    this.noiseBurst(out, t + 0.03, 0.05, 'bandpass', 2200, 1.5, 0.15, 0.003);
  }

  land(pos: Vec3 | null): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.out(pos, pos ? 1.2 : 0.5);
    this.noiseBurst(out, t, 0.12, 'lowpass', 400, 1, 0.9, 0.003);
  }

  reload(weapon: string, pos: Vec3 | null): void {
    if (!this.ctx) return;
    const def = WEAPONS[weapon];
    const dur = def?.cls === 'shotgun' ? 0.5 : def?.reloadTime ?? 2;
    const t = this.ctx.currentTime;
    const out = this.out(pos, pos ? 0.9 : 0.45);
    const click = (at: number, f: number) => { this.noiseBurst(out, t + at, 0.04, 'bandpass', f, 4, 0.8, 0.001); this.tone(out, t + at, 0.03, f * 0.7, 'square', 0.08); };
    if (def?.cls === 'shotgun') { click(0.2, 1800); return; }
    click(dur * 0.15, 1500);           // mag out
    click(dur * 0.55, 1900);           // mag in
    click(dur * 0.82, 2400);           // bolt
    click(dur * 0.88, 1300);
  }

  dry(): void { if (!this.ctx) return; const t = this.ctx.currentTime; this.noiseBurst(this.out(null, 0.4), t, 0.03, 'bandpass', 3000, 6, 0.6, 0.001); }

  switchWeapon(): void { if (!this.ctx) return; const t = this.ctx.currentTime; const o = this.out(null, 0.3); this.noiseBurst(o, t, 0.05, 'bandpass', 1400, 3, 0.6); this.noiseBurst(o, t + 0.12, 0.04, 'bandpass', 2400, 3, 0.4); }

  hitFlesh(pos: Vec3 | null, head: boolean, helmet: boolean, local: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.out(pos, local ? 0.7 : 1);
    if (head && helmet) { this.tone(out, t, 0.25, 3200, 'triangle', 0.5, 2600); this.tone(out, t, 0.18, 5200, 'sine', 0.2); }
    else if (head) { this.noiseBurst(out, t, 0.12, 'lowpass', 1200, 1, 0.9); this.tone(out, t, 0.08, 900, 'triangle', 0.3); }
    else this.noiseBurst(out, t, 0.1, 'lowpass', 700, 1, 0.8);
  }

  hitmarker(): void { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(this.out(null, 0.25, this.ui), t, 0.05, 1800, 'square', 0.2); }

  killConfirm(headshot: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(null, 0.4, this.ui);
    this.tone(o, t, 0.1, headshot ? 1400 : 1000, 'triangle', 0.4);
    this.tone(o, t + 0.07, 0.14, headshot ? 2100 : 1500, 'triangle', 0.35);
  }

  explosion(pos: Vec3 | null, big = false): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.out(pos, big ? 3.5 : 2.2);
    this.noiseBurst(out, t, big ? 2.4 : 1.4, 'lowpass', 2400, 0.7, 1, 0.004, 120);
    this.tone(out, t, big ? 1.5 : 0.9, 70, 'sine', 1, 28);
    this.noiseBurst(out, t + 0.05, 0.6, 'bandpass', 500, 0.5, 0.5, 0.01, 200);
  }

  flashbang(pos: Vec3 | null): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.out(pos, 2.2);
    this.noiseBurst(out, t, 0.5, 'highpass', 1500, 0.5, 1, 0.002);
    this.tone(out, t, 0.4, 120, 'sine', 0.6, 40);
  }

  /** Ear ringing while blinded. */
  ringing(strength: number, duration: number): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    if (this.tinnitus) { try { this.tinnitus.osc.stop(); } catch { /* already stopped */ } }
    const osc = c.createOscillator();
    osc.frequency.value = 3600;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.12 * strength), t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.sfx);
    osc.start(t); osc.stop(t + duration + 0.1);
    this.tinnitus = { osc, gain: g };
  }

  smoke(pos: Vec3 | null): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(this.out(pos, 1), t, 2.4, 'bandpass', 3000, 0.6, 0.4, 0.05, 1500);
  }

  bounce(pos: Vec3 | null): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(pos, 0.8);
    this.tone(o, t, 0.06, 900 + Math.random() * 300, 'triangle', 0.4);
    this.noiseBurst(o, t, 0.05, 'bandpass', 2000, 3, 0.3);
  }

  glass(pos: Vec3 | null): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(pos, 1.3);
    for (let i = 0; i < 5; i++) this.noiseBurst(o, t + i * 0.025, 0.08, 'bandpass', 4000 + Math.random() * 3000, 8, 0.5);
    this.noiseBurst(o, t, 0.6, 'lowpass', 1200, 0.7, 0.6, 0.01, 300);
  }

  fireLoop(id: number, pos: Vec3 | null, on: boolean): void {
    if (!this.ctx) return;
    const ex = this.fireLoops.get(id);
    if (!on) { if (ex) { ex.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.2); ex.src.stop(this.ctx.currentTime + 1); this.fireLoops.delete(id); } return; }
    if (ex) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = this.out(pos, 0.9);
    const lfo = c.createOscillator(); lfo.frequency.value = 9; const lg = c.createGain(); lg.gain.value = 0.4;
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g);
    src.start(); lfo.start();
    this.fireLoops.set(id, { src, gain: g });
  }

  beep(pos: Vec3 | null, urgency: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(this.out(pos, 0.9), t, 0.09, 1900 + urgency * 400, 'sine', 0.6);
  }

  keypad(pos: Vec3 | null): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(pos, 0.6);
    for (let i = 0; i < 7; i++) this.tone(o, t + i * 0.32, 0.08, [1200, 1400, 1000, 1600, 1300, 1500, 1100][i], 'square', 0.15);
  }

  defuseKit(pos: Vec3 | null): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(pos, 0.7);
    for (let i = 0; i < 6; i++) this.noiseBurst(o, t + i * 0.25, 0.05, 'bandpass', 2500, 4, 0.4);
  }

  ui_click(): void { if (!this.ctx) return; this.tone(this.out(null, 0.3, this.ui), this.ctx.currentTime, 0.04, 1200, 'triangle', 0.3); }
  ui_hover(): void { if (!this.ctx) return; this.tone(this.out(null, 0.12, this.ui), this.ctx.currentTime, 0.03, 1800, 'sine', 0.2); }

  jingle(kind: 'win' | 'lose' | 'mvp' | 'rankup' | 'start' | 'levelup'): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.out(null, 0.35, this.ui);
    const seqs: Record<string, number[]> = {
      win: [523, 659, 784, 1047], lose: [440, 415, 349, 330], mvp: [659, 784, 988, 1319, 1568],
      rankup: [392, 523, 659, 784, 1047, 1319], start: [440, 554], levelup: [587, 740, 880, 1175],
    };
    seqs[kind].forEach((f, i) => { this.tone(o, t + i * 0.11, 0.35, f, 'triangle', 0.35); this.tone(o, t + i * 0.11, 0.35, f * 2, 'sine', 0.08); });
  }

  /** Slow generative pad for menus. */
  startMusic(): void {
    if (!this.ctx || this.musicNodes.length) return;
    const c = this.ctx;
    const chords = [[220, 277, 330], [196, 247, 294], [174.6, 220, 262], [196, 247, 330]];
    const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 900; filter.connect(this.music);
    const oscs: OscillatorNode[] = [];
    for (let i = 0; i < 3; i++) {
      for (const det of [-6, 6]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = det;
        const g = c.createGain(); g.gain.value = 0.05;
        o.connect(g).connect(filter); o.start();
        oscs.push(o);
        this.musicNodes.push(o, g);
      }
    }
    this.musicNodes.push(filter);
    let k = 0;
    const step = () => {
      const ch = chords[k++ % chords.length];
      oscs.forEach((o, i) => o.frequency.setTargetAtTime(ch[Math.floor(i / 2)], c.currentTime, 0.8));
    };
    step();
    this.musicTimer = window.setInterval(step, 4000);
  }

  stopMusic(): void {
    clearInterval(this.musicTimer);
    for (const n of this.musicNodes) { try { (n as OscillatorNode).stop?.(); } catch { /* not a source */ } n.disconnect(); }
    this.musicNodes = [];
  }

  private ambientNodes: AudioNode[] = [];
  /** Quiet environmental bed per map theme (wind, hum, birds, water). */
  startAmbient(theme: string): void {
    if (!this.ctx) return;
    this.stopAmbient();
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter();
    const g = c.createGain(); g.gain.value = 0.05;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.12; const lg = c.createGain(); lg.gain.value = 0.025;
    lfo.connect(lg).connect(g.gain);
    if (theme === 'industrial' || theme === 'rail') { f.type = 'lowpass'; f.frequency.value = 180; g.gain.value = 0.09; }
    else if (theme === 'construction') { f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.3; g.gain.value = 0.07; }
    else if (theme === 'urban') { f.type = 'lowpass'; f.frequency.value = 320; }
    else { f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.4; } // desert/jungle wind
    src.connect(f).connect(g).connect(this.sfx);
    src.start(); lfo.start();
    this.ambientNodes.push(src, f, g, lfo, lg);
    if (theme === 'jungle' || theme === 'mediterranean' || theme === 'italian') {
      // occasional birds
      const id = window.setInterval(() => {
        if (!this.ctx || !this.ambientNodes.length) { clearInterval(id); return; }
        if (Math.random() < 0.4) { const t = this.ctx.currentTime; const o = this.out(null, 0.05); for (let i = 0; i < 3; i++) this.tone(o, t + i * 0.12, 0.09, 2800 + Math.random() * 900, 'sine', 0.3, 3600); }
      }, 3500);
      this.birdTimer = id;
    }
  }
  private birdTimer = 0;
  stopAmbient(): void {
    clearInterval(this.birdTimer);
    for (const n of this.ambientNodes) { try { (n as OscillatorNode).stop?.(); } catch { /* not a source */ } n.disconnect(); }
    this.ambientNodes = [];
  }

  stopLoops(): void {
    this.stopAmbient();
    for (const id of [...this.fireLoops.keys()]) this.fireLoop(id, null, false);
  }
}

export const sfx = new Sfx();
