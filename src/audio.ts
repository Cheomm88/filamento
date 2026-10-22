import * as THREE from 'three';
import { AUDIO, MUSIC, type ShapeKind } from './config';

// Todo sintetizado con Web Audio. Cada pieza tiene su propio PannerNode (HRTF)
// y cada nota crea nodos efímeros que se desconectan solos al terminar.

const NOTE_COUNT = MUSIC.scale.length * MUSIC.octaves + 1;

export function noteCount(): number {
  return NOTE_COUNT;
}

export function noteHz(index: number): number {
  const i = Math.max(0, Math.min(NOTE_COUNT - 1, index));
  const octave = Math.floor(i / MUSIC.scale.length);
  const semis = MUSIC.scale[i % MUSIC.scale.length] + 12 * octave;
  return MUSIC.rootHz * Math.pow(2, semis / 12);
}

// Convierte la altura (y relativa a la cabeza) en un índice de la escala, con
// histéresis respecto a la nota anterior para que no tiemble en los bordes.
export function heightToNote(y: number, previous = -1): number {
  const t = (y - MUSIC.yLow) / (MUSIC.yHigh - MUSIC.yLow);
  const raw = THREE.MathUtils.clamp(t, 0, 1) * (NOTE_COUNT - 1);
  if (previous >= 0 && Math.abs(raw - previous) < 0.5 + MUSIC.hysteresis) return previous;
  return Math.round(raw);
}

export interface Channel {
  input: GainNode;
  panner: PannerNode;
  setPosition(p: THREE.Vector3): void;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private reverbSend: GainNode;
  private noise: AudioBuffer;
  private loopGain: GainNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    // Cadena master: compresor suave → limitador duro → salida.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    const out = ctx.createGain();
    out.gain.value = AUDIO.masterGain;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(limiter).connect(out).connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx, AUDIO.reverbSeconds);
    const wet = ctx.createGain();
    wet.gain.value = AUDIO.reverbWet;
    this.reverbSend = ctx.createGain();
    this.reverbSend.connect(reverb).connect(wet).connect(this.master);

    this.noise = makeNoise(ctx, 2);
    this.startDrone();

    this.loopGain = ctx.createGain();
    this.loopGain.gain.value = 0;
    this.startLoopLayer();
  }

  createChannel(): Channel {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 0.35;
    panner.rolloffFactor = 1;
    input.connect(panner);
    panner.connect(this.master);
    panner.connect(this.reverbSend);
    return {
      input,
      panner,
      setPosition(p) {
        if (panner.positionX) {
          const t = ctx.currentTime;
          panner.positionX.setTargetAtTime(p.x, t, 0.02);
          panner.positionY.setTargetAtTime(p.y, t, 0.02);
          panner.positionZ.setTargetAtTime(p.z, t, 0.02);
        } else {
          panner.setPosition(p.x, p.y, p.z);
        }
      },
    };
  }

  private fwd = new THREE.Vector3();
  private up = new THREE.Vector3();
  private pos = new THREE.Vector3();

  updateListener(camera: THREE.Camera): void {
    const l = this.ctx.listener;
    camera.matrixWorld.decompose(this.pos, _q, _s);
    this.fwd.set(0, 0, -1).applyQuaternion(_q);
    this.up.set(0, 1, 0).applyQuaternion(_q);
    if (l.positionX) {
      l.positionX.value = this.pos.x;
      l.positionY.value = this.pos.y;
      l.positionZ.value = this.pos.z;
      l.forwardX.value = this.fwd.x;
      l.forwardY.value = this.fwd.y;
      l.forwardZ.value = this.fwd.z;
      l.upX.value = this.up.x;
      l.upY.value = this.up.y;
      l.upZ.value = this.up.z;
    } else {
      l.setPosition(this.pos.x, this.pos.y, this.pos.z);
      l.setOrientation(this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
    }
  }

  play(kind: ShapeKind, note: number, time: number, dest: AudioNode, level = 1): void {
    const f = noteHz(note);
    const t = Math.max(time, this.ctx.currentTime);
    switch (kind) {
      case 'sphere':
        return this.bell(f, t, dest, 0.32 * level);
      case 'ring':
        return this.pluck(f, t, dest, 0.34 * level);
      case 'tube':
        return this.pad(f, t, dest, 0.16 * level);
      case 'prism':
        return this.bass(f / 4, t, dest, 0.55 * level);
      case 'dot':
        return this.perc(f, t, dest, 0.5 * level);
    }
  }

  // Intensidad de la capa que aparece al cerrar circuitos (0 = ninguno).
  setLoopLevel(loops: number): void {
    const target = loops > 0 ? AUDIO.loopDroneGain * Math.min(1, 0.6 + 0.2 * loops) : 0;
    this.loopGain.gain.setTargetAtTime(target, this.ctx.currentTime, loops > 0 ? 2.5 : 1.2);
  }

  // Un acorde grave y suave que marca el instante en que se cierra un bucle.
  bloom(time: number): void {
    const t = Math.max(time, this.ctx.currentTime);
    const g = this.ctx.createGain();
    g.connect(this.reverbSend);
    g.connect(this.master);
    for (const [i, f] of [110, 164.81, 220, 329.63].entries()) {
      this.pad(f, t + i * 0.04, g, 0.07);
    }
  }

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, to: AudioNode, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(to);
    o.start(t);
    o.stop(t + dur + 0.05);
    o.onended = () => o.disconnect();
    return o;
  }

  private bell(f: number, t: number, dest: AudioNode, a: number) {
    const g1 = this.env(t, a, 0.004, 1.6);
    const g2 = this.env(t, a * 0.28, 0.003, 0.6);
    const g3 = this.env(t, a * 0.08, 0.002, 0.22);
    g1.connect(dest);
    g2.connect(dest);
    g3.connect(dest);
    this.osc('sine', f, t, 1.65, g1);
    this.osc('sine', f * 2, t, 0.65, g2);
    this.osc('sine', f * 4, t, 0.25, g3);
  }

  private pluck(f: number, t: number, dest: AudioNode, a: number) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.3);
    const g = this.env(t, a, 0.003, 0.7);
    lp.connect(g).connect(dest);
    this.osc('triangle', f, t, 0.75, lp);
  }

  private pad(f: number, t: number, dest: AudioNode, a: number) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 950;
    lp.Q.value = 0.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
    lp.connect(g).connect(dest);
    this.osc('sawtooth', f, t, 2.1, lp, -7);
    this.osc('sawtooth', f, t, 2.1, lp, 7);
  }

  private bass(f: number, t: number, dest: AudioNode, a: number) {
    const g = this.env(t, a, 0.008, 0.9);
    const g2 = this.env(t, a * 0.25, 0.008, 0.4);
    g.connect(dest);
    g2.connect(dest);
    this.osc('sine', f, t, 0.95, g);
    this.osc('sine', f * 2, t, 0.45, g2);
  }

  private perc(f: number, t: number, dest: AudioNode, a: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 4;
    bp.Q.value = 6;
    const g = this.env(t, a, 0.001, 0.09);
    src.connect(bp).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.12);
    src.onended = () => src.disconnect();
  }

  // Drone continuo muy bajo: quinta grave + aire filtrado, con un vaivén lento.
  private startDrone() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = AUDIO.droneGain;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = AUDIO.droneGain * 0.35;
    lfo.connect(lfoAmt).connect(g.gain);
    lfo.start();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    lp.connect(g);
    g.connect(this.master);
    g.connect(this.reverbSend);
    for (const f of AUDIO.droneHz) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const airLp = ctx.createBiquadFilter();
    airLp.type = 'lowpass';
    airLp.frequency.value = 250;
    const airG = ctx.createGain();
    airG.gain.value = 0.5;
    air.connect(airLp).connect(airG).connect(g);
    air.start();
  }

  private startLoopLayer() {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.connect(this.loopGain);
    this.loopGain.connect(this.reverbSend);
    this.loopGain.connect(this.master);
    for (const f of AUDIO.loopDroneHz) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      o.connect(lp);
      o.start();
    }
  }
}

const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// Respuesta al impulso sintética: ruido estéreo con caída exponencial y un
// filtrado progresivo de agudos (cuanto más tarde, más oscuro).
function makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = 0.5 - 0.45 * t; // coeficiente del paso bajo de un polo
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - t, 3.2) * (i < 200 ? i / 200 : 1);
    }
  }
  return buf;
}
