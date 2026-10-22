import * as THREE from 'three';
import { INPUT, PIECES } from './config';
import { AudioEngine, heightToNote } from './audio';
import { createPieces, type Piece } from './pieces';
import { Network } from './network';
import { Hand, HandVisuals } from './input';
import { Onboarding } from './onboarding';
import type { Stage } from './scene';

// Orquesta la experiencia: input → piezas → red/pulsos → audio y atmósfera.

interface Flash {
  piece: Piece;
  time: number;
  glow: THREE.Color | null;
  strength: number;
}

export class Experience {
  readonly audio: AudioEngine;
  readonly pieces: Piece[];
  readonly network: Network;
  readonly hands: Hand[];
  readonly onboarding: Onboarding;
  private visuals = new HandVisuals();
  private flashes: Flash[] = [];
  private resetHold = 0;
  private resetLatched = false;
  private started = false;
  private tmp = new THREE.Vector3();
  private eye = new THREE.Vector3();

  constructor(
    private stage: Stage,
    ctx: AudioContext,
  ) {
    this.audio = new AudioEngine(ctx);
    this.pieces = createPieces(this.audio);
    for (const p of this.pieces) stage.world.add(p.group);
    this.network = new Network(this.pieces);
    stage.world.add(this.network.object);
    this.hands = [0, 1].map((i) => new Hand(i, stage.renderer, stage.scene));
    stage.world.add(this.visuals.mesh);
    this.onboarding = new Onboarding(this.pieces, this.audio);

    this.network.onNote = (id, time) => {
      const piece = this.pieces[id];
      this.audio.play(piece.kind, piece.note, time, piece.channel.input);
      const cycle = this.network.cycleOf(id);
      this.flashes.push({ piece, time, glow: cycle ? cycle.color : null, strength: 1 });
    };
    this.network.onCycleClosed = (cycle, time) => {
      this.audio.bloom(time);
      for (const id of cycle.members) {
        this.flashes.push({ piece: this.pieces[id], time, glow: null, strength: 0.6 });
      }
      this.flashes.push({ piece: this.pieces[cycle.members[0]], time, glow: cycle.color, strength: 0.6 });
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stage.showTitle('FILAMENTO');
  }

  update(dt: number, time: number): void {
    const ctx = this.audio.ctx;
    const now = ctx.currentTime;
    const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    const visualNow = now - latency;

    if (this.onboarding.phase === 'title' && this.started && !this.stage.titleVisible) this.onboarding.begin();

    this.stage.world.updateMatrixWorld();
    for (const h of this.hands) h.update(this.stage.world, dt);
    this.interact(dt, now);
    this.onboarding.update(dt);

    const eye = this.stage.renderer.xr.getCamera().getWorldPosition(this.eye);
    for (const p of this.pieces) {
      p.update(dt, time, eye);
      if (p.active) p.channel.setPosition(p.group.getWorldPosition(this.tmp));
    }

    this.network.update(now, visualNow, this.hands.some((h) => h.grabbed));

    // Destellos y resplandor sincronizados con el audio programado.
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      if (f.time > visualNow) continue;
      f.piece.triggerFlash(f.strength);
      if (f.glow) this.stage.pulseGlow(f.glow, 0.55);
      this.flashes.splice(i, 1);
    }

    this.visuals.update(this.hands, this.resetHold / INPUT.palmsHold);
  }

  private interact(dt: number, now: number): void {
    const active = this.pieces.filter((p) => p.active);
    for (const p of active) p.hoverTarget = 0;
    if (this.onboarding.phase === 'title') return;

    for (const h of this.hands) {
      if (!h.tracked) {
        if (h.grabbed) this.release(h, now);
        continue;
      }

      // Tocar la pieza inicial con cualquier dedo la despierta.
      if (this.onboarding.phase === 'waiting') {
        const seed = this.onboarding.seed;
        const pts = h.isHand ? h.tips : [h.point];
        if (pts.some((t) => t.distanceTo(seed.base) < INPUT.touchRadius)) this.onboarding.unfold();
      }

      if (h.grabbed) {
        const p = h.grabbed;
        if (h.justReleased || !h.pinching) {
          this.release(h, now);
          continue;
        }
        const target = this.tmp.copy(h.point).add(h.grabOffset);
        if (target.length() > PIECES.maxDistanceFromHead) target.setLength(PIECES.maxDistanceFromHead);
        p.base.copy(target);
        p.hoverTarget = 1;
        // Vista previa: suena cada vez que la altura cruza a otra nota.
        const note = heightToNote(p.base.y, p.note);
        if (note !== p.note) {
          p.note = note;
          this.audio.play(p.kind, note, now, p.channel.input, 0.5);
          p.triggerFlash(0.5);
        }
        continue;
      }

      const near = this.nearest(active, h.point, INPUT.hoverRadius);
      if (near) near.hoverTarget = 1;

      // Margen de gracia: al cerrar los dedos la punta se desplaza unos
      // centímetros, así que se acepta el agarre durante el inicio del pinch.
      if (h.pinching && h.pinchAge < INPUT.grabGrace) {
        const p = this.nearest(active, h.point, h.grabRadius);
        if (p) this.grab(h, p, now);
      }
    }

    this.updateReset(dt);
  }

  private nearest(ps: Piece[], point: THREE.Vector3, radius: number): Piece | null {
    let best: Piece | null = null;
    let bestD = radius;
    for (const p of ps) {
      if (p.grabbedBy !== null) continue;
      const d = p.base.distanceTo(point);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private grab(h: Hand, p: Piece, now: number): void {
    if (p === this.onboarding.seed) this.onboarding.unfold();
    p.grabbedBy = h.index;
    p.moveTo(p.base, 0); // cancela cualquier animación en curso
    h.grabbed = p;
    h.grabOffset.subVectors(p.base, h.point);
    p.note = heightToNote(p.base.y, p.note);
    this.audio.play(p.kind, p.note, now, p.channel.input, 0.6);
    p.triggerFlash(0.7);
  }

  private release(h: Hand, now: number): void {
    const p = h.grabbed!;
    p.grabbedBy = null;
    p.moved = true;
    h.grabbed = null;
    this.network.commit(p.id, now);
    this.audio.setLoopLevel(this.network.cycleCount);
  }

  // Reset: palmas abiertas juntas (o ambos botones de agarre) durante 1,5 s.
  private updateReset(dt: number): void {
    const [a, b] = this.hands;
    let holding = false;
    if (a.tracked && b.tracked && !a.grabbed && !b.grabbed) {
      if (a.isHand && b.isHand) {
        holding = !a.pinching && !b.pinching && a.palm.distanceTo(b.palm) < INPUT.palmsDistance;
      } else {
        holding = a.squeezing && b.squeezing;
      }
    }
    if (!holding) {
      this.resetLatched = false;
      this.resetHold = Math.max(0, this.resetHold - dt * 3);
      return;
    }
    if (this.resetLatched) return;
    this.resetHold += dt;
    if (this.resetHold >= INPUT.palmsHold) {
      this.resetHold = 0;
      this.resetLatched = true;
      this.reset();
    }
  }

  reset(): void {
    if (this.onboarding.phase !== 'open') return;
    this.network.clear();
    this.flashes.length = 0;
    this.audio.setLoopLevel(0);
    const now = this.audio.ctx.currentTime;
    for (const p of this.pieces) {
      p.moved = false;
      p.moveTo(p.home, PIECES.resetDuration);
      p.note = heightToNote(p.home.y);
    }
    // Un suspiro descendente para confirmar el reset.
    const sorted = [...this.pieces].sort((x, y) => y.note - x.note);
    sorted.forEach((p, i) => this.audio.play(p.kind, p.note, now + 0.25 + i * 0.07, p.channel.input, 0.3));
  }
}
