import * as THREE from 'three';
import { INPUT, PIECES, SONG, type ShapeKind } from './config';
import { AudioEngine, heightToNote, setPitchRange } from './audio';
import { arcPosition, createPieces, Piece } from './pieces';
import { edgeKey, Network, type Constellation, type Cycle } from './network';
import { HandVisuals, XRRig, type InputRig, type Pointer } from './input';
import { ScreenLayout, TouchRig, type SongSpace } from './touch';
import { Dispenser, dispenserPositionsVR } from './dispenser';
import { Onboarding } from './onboarding';
import type { SongLoop } from './song';
import type { Stage } from './scene';

// Orquesta la experiencia: input → piezas → red/pulsos → audio y atmósfera.
//
// Además de mover piezas sueltas, se puede agarrar un bucle cerrado por su
// hilo y subirlo: se encoge y se guarda en la cúpula, donde sigue sonando.
// Un pellizco corto sobre un bucle guardado lo silencia o lo reactiva; bajarlo
// lo devuelve al área de trabajo. Todos los bucles guardados forman el tema.

interface Flash {
  piece: Piece;
  time: number;
  glow: THREE.Color | null;
  strength: number;
}

interface LoopGrab {
  cycle: Cycle;
  members: number[];
  offsets: THREE.Vector3[]; // respecto al puntero, a tamaño real
  start: THREE.Vector3;
  startTime: number;
  moved: boolean;
  shrink: number;
}

const ORIGINAL_COUNT = PIECES.layout.length;

export class Experience {
  readonly audio: AudioEngine;
  readonly pieces: Piece[];
  readonly network: Network;
  readonly rig: InputRig;
  readonly layout: ScreenLayout | null;
  readonly hands: Pointer[];
  readonly onboarding: Onboarding;
  readonly space: SongSpace;
  readonly dispenser: Dispenser;
  onSongChange: () => void = () => {};

  private visuals: HandVisuals;
  private flashes: Flash[] = [];
  private loopGrabs = new Map<Pointer, LoopGrab>();
  private resetHold = 0;
  private resetLatched = false;
  private started = false;
  private pendingSong: SongLoop[] | null = null;
  private tmp = new THREE.Vector3();
  private eye = new THREE.Vector3();

  constructor(
    private stage: Stage,
    ctx: AudioContext,
    readonly mode: 'xr' | 'screen',
  ) {
    const screen = mode === 'screen';
    this.audio = new AudioEngine(ctx, { hrtf: !screen });
    const layout = screen ? new ScreenLayout(stage) : null;
    if (layout) setPitchRange(layout.flat.yLow, layout.flat.yHigh);
    this.pieces = createPieces(this.audio, layout?.flat ?? null);
    for (const p of this.pieces) stage.world.add(p.group);
    this.network = new Network(this.pieces, layout?.distanceScale ?? 1);
    stage.world.add(this.network.object);
    this.rig = layout ? new TouchRig(stage, layout) : new XRRig(stage.renderer, stage.scene);
    this.layout = layout;
    this.hands = this.rig.pointers;
    this.visuals = new HandVisuals(screen ? 2.5 : 1);
    stage.world.add(this.visuals.mesh);
    this.onboarding = new Onboarding(this.pieces, this.audio);

    this.space = layout ?? {
      domeSlots: SONG.domeRows.flatMap((r) => r.angles.map((a) => arcPosition(a, r.y, r.radius))),
      dispenserSlots: dispenserPositionsVR(SONG.dispenser),
      shrinkStartY: SONG.shrinkStartY,
      storeY: SONG.storeY,
      scale: 1,
    };
    this.dispenser = new Dispenser(this.space.dispenserSlots, SONG.dispenser.scale * (layout?.flat.pieceScale ?? 1));
    stage.world.add(this.dispenser.object);

    this.network.onNote = (id, time) => {
      const piece = this.pieces[id];
      if (!piece.muted) this.audio.play(piece.kind, piece.note, time, piece.channel.input);
      const cycle = this.network.cycleOf(id);
      const glow = cycle && !piece.muted ? cycle.color : null;
      this.flashes.push({ piece, time, glow, strength: 1 });
    };
    this.network.onCycleClosed = (cycle, time) => {
      this.audio.bloom(time);
      for (const id of cycle.members) {
        this.flashes.push({ piece: this.pieces[id], time, glow: null, strength: 0.6 });
      }
      this.flashes.push({ piece: this.pieces[cycle.members[0]], time, glow: cycle.color, strength: 0.6 });
      this.dispenser.show(); // segundo descubrimiento
    };
  }

  get camera(): THREE.Camera {
    return this.mode === 'xr' ? this.stage.renderer.xr.getCamera() : this.stage.camera;
  }

  // Un tema compartido se carga cuando termina el título.
  loadSong(loops: SongLoop[]): void {
    this.pendingSong = loops;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stage.showTitle('FILAMENTO', this.layout?.titlePosition, this.layout?.titleScale);
  }

  update(dt: number, time: number): void {
    const ctx = this.audio.ctx;
    const now = ctx.currentTime;
    const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    const visualNow = now - latency;

    if (this.onboarding.phase === 'title' && this.started && !this.stage.titleVisible) {
      this.onboarding.begin();
      if (this.pendingSong) this.restoreSong(this.pendingSong, now);
      this.pendingSong = null;
    }

    this.stage.world.updateMatrixWorld();
    this.rig.update(this.stage.world, dt);
    this.interact(dt, now);
    this.onboarding.update(dt);

    const eye = this.camera.getWorldPosition(this.eye);
    for (const p of this.pieces) {
      if (p.disposed) continue;
      p.update(dt, time, eye);
      if (p.active) p.channel.setPosition(p.group.getWorldPosition(this.tmp));
    }
    this.dispenser.update(dt, time, eye);

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

  // ---- Interacción ----------------------------------------------------------

  private interact(dt: number, now: number): void {
    const active = this.pieces.filter((p) => p.active);
    for (const p of active) p.hoverTarget = 0;
    this.network.hoveredCycle = null;
    this.dispenser.hot = null;
    this.dispenser.full = this.aliveCount() >= SONG.maxPieces;
    if (this.onboarding.phase === 'title') return;

    for (const h of this.hands) {
      const loop = this.loopGrabs.get(h);
      if (!h.tracked) {
        if (h.grabbed) this.release(h, now);
        if (loop) this.releaseLoop(h, loop, now);
        continue;
      }

      // Tocar la pieza inicial con cualquier dedo la despierta.
      if (this.onboarding.phase === 'waiting') {
        const seed = this.onboarding.seed;
        const pts = h.isHand ? h.tips : [h.point];
        if (pts.some((t) => t.distanceTo(seed.base) < INPUT.touchRadius)) this.onboarding.unfold();
      }

      if (loop) {
        if (!h.pinching) this.releaseLoop(h, loop, now);
        else this.dragLoop(h, loop);
        continue;
      }

      if (h.grabbed) {
        const p = h.grabbed;
        if (!h.pinching) {
          this.release(h, now);
          continue;
        }
        const target = this.tmp.copy(h.point).add(h.grabOffset);
        this.rig.constrain(target);
        p.base.copy(target);
        p.hoverTarget = 1;
        if (this.dispenser.near(p.base, SONG.removeRadius * this.space.scale)) this.dispenser.hot = 'all';
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
      else this.network.hoveredCycle = this.network.cycleNear(h.point, this.threadRadius(h));
      const kind = this.dispenser.kindAt(h.point, h.grabRadius);
      if (!near && kind) this.dispenser.hot = kind;

      // Margen de gracia: al cerrar los dedos la punta se desplaza unos
      // centímetros, así que se acepta el agarre durante el inicio del pinch.
      if (h.pinching && h.pinchAge < INPUT.grabGrace) this.tryGrab(h, active, now);
    }

    this.updateReset(dt);
  }

  private threadRadius(h: Pointer): number {
    return this.mode === 'screen' ? h.grabRadius * 0.6 : SONG.threadRadius;
  }

  // Prioridad: pieza justo bajo el dedo → hilo de un bucle → pieza en el
  // radio de agarre amplio → fuente de piezas. Una pieza guardada en la
  // cúpula siempre arrastra su bucle entero.
  private tryGrab(h: Pointer, active: Piece[], now: number): void {
    const tight = this.mode === 'screen' ? h.grabRadius * 0.45 : 0.035;
    const p =
      this.nearest(active, h.point, tight) ??
      (this.network.cycleNear(h.point, this.threadRadius(h)) ? null : this.nearest(active, h.point, h.grabRadius));
    if (p && !p.frozen) return this.grab(h, p, now);
    const cycle = p ? this.network.cycleOf(p.id) : this.network.cycleNear(h.point, this.threadRadius(h));
    if (cycle && !this.isLoopGrabbed(cycle)) return this.grabLoop(h, cycle, now);
    const kind = this.dispenser.kindAt(h.point, h.grabRadius);
    if (kind) {
      const piece = this.spawnPiece(kind, this.dispenser.positionOf(kind));
      if (piece) {
        piece.moved = true;
        this.grab(h, piece, now);
      }
    }
  }

  private nearest(ps: Piece[], point: THREE.Vector3, radius: number): Piece | null {
    let best: Piece | null = null;
    let bestD = radius;
    for (const p of ps) {
      if (p.grabbedBy !== null || this.inLoopGrab(p.id)) continue;
      const d = p.base.distanceTo(point);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private grab(h: Pointer, p: Piece, now: number): void {
    if (p === this.onboarding.seed) this.onboarding.unfold();
    p.grabbedBy = h.index;
    p.moveTo(p.base, 0); // cancela cualquier animación en curso
    h.grabbed = p;
    h.grabOffset.subVectors(p.base, h.point);
    p.note = heightToNote(p.base.y, p.note);
    this.audio.play(p.kind, p.note, now, p.channel.input, 0.6);
    p.triggerFlash(0.7);
  }

  private release(h: Pointer, now: number): void {
    const p = h.grabbed!;
    p.grabbedBy = null;
    h.grabbed = null;
    // Soltarla sobre la fuente la retira.
    if (this.dispenser.near(p.base, SONG.removeRadius * this.space.scale)) {
      this.removePieces([p], now);
      return;
    }
    p.moved = true;
    this.network.commit(p.id, now);
    this.afterCommit();
  }

  // ---- Bucles -----------------------------------------------------------------

  private isLoopGrabbed(c: Cycle): boolean {
    return [...this.loopGrabs.values()].some((g) => g.cycle.key === c.key);
  }

  private inLoopGrab(id: number): boolean {
    return [...this.loopGrabs.values()].some((g) => g.members.includes(id));
  }

  private grabLoop(h: Pointer, cycle: Cycle, now: number): void {
    const shrink = cycle.constellation ? SONG.miniScale : 1;
    const members = cycle.order;
    const offsets = members.map((id) => this.pieces[id].base.clone().sub(h.point).divideScalar(shrink));
    for (const id of members) this.pieces[id].moveTo(this.pieces[id].base, 0);
    this.loopGrabs.set(h, {
      cycle,
      members,
      offsets,
      start: h.point.clone(),
      startTime: now,
      moved: false,
      shrink,
    });
    for (const id of members) this.pieces[id].triggerFlash(0.4);
  }

  // Encogimiento según la altura: 1 en el área de trabajo, miniatura arriba.
  private shrinkAt(y: number): number {
    const t = THREE.MathUtils.smoothstep(y, this.space.shrinkStartY, this.space.storeY);
    return THREE.MathUtils.lerp(1, SONG.miniScale, t);
  }

  private dragLoop(h: Pointer, g: LoopGrab): void {
    if (h.point.distanceTo(g.start) > SONG.tapMaxMove * this.space.scale) g.moved = true;
    this.network.hoveredCycle = g.cycle;
    if (!g.moved) return;
    g.shrink = this.shrinkAt(h.point.y);
    this.placeLoop(g, h.point, g.shrink);
  }

  private placeLoop(g: LoopGrab, anchor: THREE.Vector3, shrink: number): void {
    const targets = g.offsets.map((o) => anchor.clone().addScaledVector(o, shrink));
    // Limita el bucle entero moviendo su centro, sin deformarlo.
    const center = targets.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(targets.length);
    const clamped = center.clone();
    this.rig.constrain(clamped);
    const delta = clamped.sub(center);
    g.members.forEach((id, i) => {
      const p = this.pieces[id];
      p.base.copy(targets[i]).add(delta);
      p.shrink = shrink;
    });
  }

  private releaseLoop(h: Pointer, g: LoopGrab, now: number): void {
    this.loopGrabs.delete(h);
    const constellation = g.cycle.constellation;

    // Pellizco corto sin mover: silenciar o reactivar un bucle guardado.
    if (!g.moved) {
      if (constellation && now - g.startTime < SONG.tapMaxTime + 0.2) {
        this.network.setMuted(constellation, !constellation.muted);
        this.afterCommit();
      }
      return;
    }

    const wantsStore = h.point.y >= this.space.storeY;
    const center = g.members
      .reduce((s, id) => s.add(this.pieces[id].base), new THREE.Vector3())
      .divideScalar(g.members.length);
    const slot = wantsStore ? this.freeSlot(center, constellation) : -1;
    if (slot >= 0) {
      if (constellation) constellation.slot = slot;
      else this.network.freeze(g.cycle, slot);
      this.flyToSlot(g.members, slot);
      this.network.commit(null, now);
      this.afterCommit();
      return;
    }

    // Vuelve al área de trabajo a tamaño real; la altura nueva transpone.
    if (constellation) this.network.unfreeze(constellation);
    const anchor = h.point.clone();
    anchor.y = Math.min(anchor.y, this.space.shrinkStartY);
    this.placeLoop(g, anchor, 1);
    for (const id of g.members) {
      const p = this.pieces[id];
      p.note = heightToNote(p.base.y);
      p.moved = true;
    }
    this.network.commit(null, now);
    this.afterCommit();
  }

  private freeSlot(point: THREE.Vector3, own: Constellation | null): number {
    const used = new Set(this.network.constellations.filter((c) => c !== own).map((c) => c.slot));
    const max = Math.min(SONG.maxConstellations, this.space.domeSlots.length);
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < max; i++) {
      if (used.has(i)) continue;
      const d = this.space.domeSlots[i].distanceTo(point);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // Lleva un bucle guardado al centro de su hueco en la cúpula.
  private flyToSlot(members: number[], slot: number): void {
    const ps = members.map((id) => this.pieces[id]);
    const center = ps.reduce((s, p) => s.add(p.base), new THREE.Vector3()).divideScalar(ps.length);
    const delta = this.space.domeSlots[slot].clone().sub(center);
    for (const p of ps) {
      p.shrink = SONG.miniScale;
      p.moveTo(p.base.clone().add(delta), 0.5);
    }
  }

  // ---- Piezas dinámicas -----------------------------------------------------

  private aliveCount(): number {
    return this.pieces.filter((p) => !p.disposed).length;
  }

  private spawnPiece(kind: ShapeKind, at: THREE.Vector3): Piece | null {
    if (this.aliveCount() >= SONG.maxPieces) return null;
    // Los huecos de las 7 piezas originales quedan reservados para el reset.
    let id = this.pieces.findIndex((p, i) => i >= ORIGINAL_COUNT && p.disposed);
    if (id < 0) id = this.pieces.length;
    return this.placePiece(id, kind, at);
  }

  private placePiece(id: number, kind: ShapeKind, at: THREE.Vector3): Piece {
    const p = new Piece(id, kind, at, this.audio);
    p.flatScale = this.layout?.flat.pieceScale ?? 1;
    this.pieces[id] = p;
    this.stage.world.add(p.group);
    p.show(null);
    return p;
  }

  private removePieces(ps: Piece[], now: number): void {
    const ids = ps.map((p) => p.id);
    this.network.dropPulsesTouching(ids);
    for (const p of ps) p.dispose();
    this.network.commit(null, now);
    this.afterCommit();
  }

  private afterCommit(): void {
    this.audio.setLoopLevel(this.network.audibleCycleCount);
    this.onSongChange();
  }

  // ---- Tema -----------------------------------------------------------------

  get songLoops(): SongLoop[] {
    return [...this.network.constellations]
      .sort((a, b) => a.slot - b.slot)
      .map((c) => {
        const ps = c.order.map((id) => this.pieces[id]);
        const center = ps.reduce((s, p) => s.add(p.base), new THREE.Vector3()).divideScalar(ps.length);
        const k = SONG.miniScale * this.space.scale;
        return {
          kinds: ps.map((p) => p.kind),
          notes: ps.map((p) => p.note),
          steps: c.order.map((a, i) => c.plan.get(edgeKey(a, c.order[(i + 1) % c.order.length]))!),
          offsets: ps.map((p) => {
            const o = p.base.clone().sub(center).divideScalar(k);
            return [o.x, o.y, this.mode === 'screen' ? 0 : o.z] as [number, number, number];
          }),
          muted: c.muted,
        };
      });
  }

  private restoreSong(loops: SongLoop[], now: number): void {
    const max = Math.min(SONG.maxConstellations, this.space.domeSlots.length);
    const k = SONG.miniScale * this.space.scale;
    loops.slice(0, max).forEach((loop, slot) => {
      if (this.aliveCount() + loop.kinds.length > SONG.maxPieces) return;
      const center = this.space.domeSlots[slot];
      const ids = loop.kinds.map((kind, i) => {
        const o = loop.offsets[i];
        const at = new THREE.Vector3(o[0], o[1], this.mode === 'screen' ? 0 : o[2]).multiplyScalar(k).add(center);
        const p = this.spawnPiece(kind, at)!;
        p.note = loop.notes[i];
        p.moved = true;
        p.shrink = SONG.miniScale;
        return p.id;
      });
      this.network.addConstellation(ids, loop.steps, loop.muted, slot);
    });
    this.dispenser.show();
    this.network.commit(null, now);
    this.audio.setLoopLevel(this.network.audibleCycleCount);
  }

  // ---- Reset ------------------------------------------------------------------

  // Reset: palmas abiertas juntas, ambos botones de agarre o dos dedos en la
  // pantalla (sin tocar piezas) durante 1,5 s.
  private updateReset(dt: number): void {
    const [a, b] = this.hands;
    let holding = false;
    if (a.tracked && b.tracked && !a.grabbed && !b.grabbed && this.loopGrabs.size === 0) {
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

  // Primer reset: limpia el área de trabajo (los bucles guardados siguen).
  // Si ya estaba limpia, un segundo reset borra también el tema.
  reset(): void {
    if (this.onboarding.phase !== 'open') return;
    const now = this.audio.ctx.currentTime;
    const work = this.pieces.filter((p) => !p.disposed && !p.frozen);
    const workDirty = work.some((p) => p.id >= ORIGINAL_COUNT || p.moved);

    let toRemove: Piece[];
    let toHome: Piece[];
    if (workDirty || this.network.constellations.length === 0) {
      toRemove = work.filter((p) => p.id >= ORIGINAL_COUNT);
      toHome = work.filter((p) => p.id < ORIGINAL_COUNT);
    } else {
      for (const c of [...this.network.constellations]) this.network.unfreeze(c);
      const all = this.pieces.filter((p) => !p.disposed);
      toRemove = all.filter((p) => p.id >= ORIGINAL_COUNT);
      toHome = all.filter((p) => p.id < ORIGINAL_COUNT);
    }

    this.network.dropPulsesTouching(toRemove.map((p) => p.id));
    for (const p of toRemove) p.dispose();
    // Las originales que se retiraron en la fuente vuelven a su sitio.
    for (let i = 0; i < ORIGINAL_COUNT; i++) {
      const old = this.pieces[i];
      if (!old.disposed) continue;
      const p = this.placePiece(i, old.kind, old.home);
      toHome.push(p);
    }
    for (const p of toHome) {
      p.moved = false;
      p.shrink = 1;
      p.moveTo(p.home, PIECES.resetDuration);
      p.note = heightToNote(p.home.y);
    }
    this.flashes = this.flashes.filter((f) => !f.piece.disposed);
    this.network.commit(null, now);
    this.afterCommit();

    // Un suspiro descendente para confirmar el reset.
    const sorted = [...toHome].sort((x, y) => y.note - x.note);
    sorted.forEach((p, i) => this.audio.play(p.kind, p.note, now + 0.25 + i * 0.07, p.channel.input, 0.3));
  }
}
