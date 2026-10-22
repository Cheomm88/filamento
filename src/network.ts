import * as THREE from 'three';
import { GRAPH } from './config';
import { getHaloTexture, type Piece } from './pieces';

// Conexiones, pulsos y circuitos.
//
// Cada pieza conecta con 2 vecinas como máximo, así que el grafo solo puede
// tener cadenas y anillos: un circuito cerrado es un componente en el que
// todas las piezas tienen grado 2.
//
// Tiempo: un reloj global (audioContext.currentTime) dividido en semicorcheas.
// Cada tramo dura un número entero de pasos según su longitud, de modo que
// todas las notas de todos los circuitos caen en la misma rejilla.

type Edge = [number, number];

interface Segment {
  from: number;
  to: number;
  start: number;
  end: number;
  scheduled: boolean;
}

interface Pulse {
  segs: Segment[];
  sprite: THREE.Sprite;
  endAt: number | null;
}

export interface Cycle {
  key: string;
  members: number[];
  color: THREE.Color;
}

export class Network {
  readonly object = new THREE.Group();
  readonly step = 60 / GRAPH.bpm / GRAPH.stepsPerBeat;

  onNote: (pieceId: number, time: number) => void = () => {};
  onCycleClosed: (cycle: Cycle, time: number) => void = () => {};

  private pieces: Piece[];
  private adj: number[][];
  private edges: Edge[] = [];
  private cycles: Cycle[] = [];
  private cycleOfPiece = new Map<number, Cycle>();
  private pulses: Pulse[] = [];
  private freeSprites: THREE.Sprite[] = [];
  private lines: THREE.LineSegments;
  private preview: THREE.LineSegments;

  constructor(pieces: Piece[]) {
    this.pieces = pieces;
    this.adj = pieces.map(() => []);
    const maxEdges = pieces.length * 2;
    this.lines = makeLines(maxEdges, GRAPH.lineOpacity);
    this.preview = makeLines(maxEdges, GRAPH.previewOpacity);
    this.object.add(this.lines, this.preview);

    const tex = getHaloTexture();
    for (let i = 0; i < GRAPH.maxPulses; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          fog: false,
        }),
      );
      s.scale.setScalar(0.05);
      s.visible = false;
      s.renderOrder = 3;
      this.object.add(s);
      this.freeSprites.push(s);
    }
  }

  get cycleCount(): number {
    return this.cycles.length;
  }

  cycleOf(pieceId: number): Cycle | undefined {
    return this.cycleOfPiece.get(pieceId);
  }

  nextTick(now: number): number {
    return Math.ceil((now + 0.03) / this.step) * this.step;
  }

  // Empareja por distancia creciente respetando el máximo de vecinas.
  // `isMoved` decide qué piezas participan: al menos un extremo debe haberse
  // movido, así las piezas del arco inicial no se enlazan entre sí solas.
  private computeEdges(isMoved: (p: Piece) => boolean): Edge[] {
    const cand: { a: number; b: number; d: number }[] = [];
    const ps = this.pieces;
    for (let i = 0; i < ps.length; i++) {
      if (!ps[i].active) continue;
      for (let j = i + 1; j < ps.length; j++) {
        if (!ps[j].active) continue;
        if (!isMoved(ps[i]) && !isMoved(ps[j])) continue;
        const d = ps[i].base.distanceTo(ps[j].base);
        if (d < GRAPH.connectDistance) cand.push({ a: i, b: j, d });
      }
    }
    cand.sort((x, y) => x.d - y.d);
    const deg = new Array(ps.length).fill(0);
    const out: Edge[] = [];
    for (const c of cand) {
      if (deg[c.a] >= GRAPH.maxNeighbors || deg[c.b] >= GRAPH.maxNeighbors) continue;
      deg[c.a]++;
      deg[c.b]++;
      out.push([c.a, c.b]);
    }
    return out;
  }

  private hasEdge(a: number, b: number): boolean {
    return this.adj[a].includes(b);
  }

  private segmentSteps(a: number, b: number): number {
    const d = this.pieces[a].base.distanceTo(this.pieces[b].base);
    const steps = Math.round(d / GRAPH.pulseSpeed / this.step);
    return THREE.MathUtils.clamp(steps, 1, GRAPH.maxStepsPerSegment);
  }

  private spawn(from: number, to: number, start: number): Pulse | null {
    const sprite = this.freeSprites.pop();
    if (!sprite) return null;
    const p: Pulse = {
      segs: [{ from, to, start, end: start + this.segmentSteps(from, to) * this.step, scheduled: false }],
      sprite,
      endAt: null,
    };
    this.pulses.push(p);
    return p;
  }

  private kill(p: Pulse): void {
    p.sprite.visible = false;
    this.freeSprites.push(p.sprite);
    this.pulses.splice(this.pulses.indexOf(p), 1);
  }

  private currentSeg(p: Pulse, now: number): Segment {
    for (const s of p.segs) if (now < s.end) return s;
    return p.segs[p.segs.length - 1];
  }

  // Fija las conexiones (se llama al soltar una pieza o tras un reset).
  commit(released: number | null, now: number): void {
    this.edges = this.computeEdges((p) => p.moved);
    this.adj = this.pieces.map(() => []);
    for (const [a, b] of this.edges) {
      this.adj[a].push(b);
      this.adj[b].push(a);
    }

    // Componentes y circuitos.
    const prevKeys = new Set(this.cycles.map((c) => c.key));
    this.cycles = [];
    this.cycleOfPiece.clear();
    const seen = new Set<number>();
    for (let i = 0; i < this.pieces.length; i++) {
      if (seen.has(i) || this.adj[i].length === 0) continue;
      const comp: number[] = [];
      const stack = [i];
      seen.add(i);
      while (stack.length) {
        const n = stack.pop()!;
        comp.push(n);
        for (const m of this.adj[n]) if (!seen.has(m)) (seen.add(m), stack.push(m));
      }
      if (comp.length >= 3 && comp.every((n) => this.adj[n].length === 2)) {
        const cycle: Cycle = {
          key: [...comp].sort((a, b) => a - b).join(','),
          members: comp,
          color: dominantColor(comp.map((n) => this.pieces[n]), released),
        };
        this.cycles.push(cycle);
        for (const n of comp) this.cycleOfPiece.set(n, cycle);
      }
    }

    // Los pulsos en marcha siguen solo si su tramo actual sigue existiendo.
    for (const p of [...this.pulses]) {
      const cur = this.currentSeg(p, now);
      if (!this.hasEdge(cur.from, cur.to)) {
        this.kill(p);
        continue;
      }
      p.segs = [cur];
      p.endAt = null;
    }

    const tick = this.nextTick(now);

    // Exactamente un pulso por circuito.
    for (const cycle of this.cycles) {
      const inCycle = this.pulses.filter((p) => cycle.members.includes(p.segs[0].to));
      inCycle.slice(1).forEach((p) => this.kill(p));
      if (inCycle.length === 0) {
        const start = released !== null && cycle.members.includes(released) ? released : cycle.members[0];
        this.spawn(start, this.adj[start][0], tick);
      }
      if (!prevKeys.has(cycle.key)) this.onCycleClosed(cycle, tick);
    }

    // Al soltar una pieza en una cadena abierta, un pulso la recorre una vez.
    if (released !== null) {
      if (!this.cycleOfPiece.has(released)) {
        for (const n of this.adj[released]) this.spawn(released, n, tick);
      }
      this.onNote(released, tick);
    }
  }

  clear(): void {
    for (const p of [...this.pulses]) this.kill(p);
    this.edges = [];
    this.adj = this.pieces.map(() => []);
    this.cycles = [];
    this.cycleOfPiece.clear();
  }

  // `now` es el reloj de audio; `visualNow` lo compensa con la latencia de
  // salida para que el destello coincida con lo que se oye.
  update(now: number, visualNow: number, previewing: boolean): void {
    this.schedule(now);
    this.drawPulses(visualNow);
    this.drawLines();
    this.drawPreview(previewing);
  }

  private schedule(now: number): void {
    const horizon = now + GRAPH.lookahead;
    for (const p of this.pulses) {
      for (let guard = 0; guard < 64; guard++) {
        const last = p.segs[p.segs.length - 1];
        if (!last.scheduled) {
          if (last.end > horizon) break;
          last.scheduled = true;
          // Tras un parón (p. ej. al quitarse el casco) no dispara ráfagas.
          if (last.end > now - 0.05) this.onNote(last.to, last.end);
        }
        if (p.endAt !== null) break;
        const next = this.adj[last.to].find((n) => n !== last.from);
        if (next === undefined) {
          p.endAt = last.end;
          break;
        }
        p.segs.push({
          from: last.to,
          to: next,
          start: last.end,
          end: last.end + this.segmentSteps(last.to, next) * this.step,
          scheduled: false,
        });
      }
    }
  }

  private drawPulses(now: number): void {
    for (const p of [...this.pulses]) {
      if (p.endAt !== null && now > p.endAt + 0.05) {
        this.kill(p);
        continue;
      }
      while (p.segs.length > 1 && p.segs[0].end <= now) p.segs.shift();
      const s = p.segs[0];
      if (now < s.start) {
        p.sprite.visible = false;
        continue;
      }
      const k = THREE.MathUtils.clamp((now - s.start) / (s.end - s.start), 0, 1);
      const a = this.pieces[s.from];
      const b = this.pieces[s.to];
      p.sprite.visible = true;
      p.sprite.position.lerpVectors(a.group.position, b.group.position, k);
      const m = p.sprite.material as THREE.SpriteMaterial;
      m.color.copy(a.color).lerp(b.color, k).lerp(WHITE, 0.35);
    }
  }

  private drawLines(): void {
    writeEdges(this.lines, this.edges, this.pieces, (a) => (this.cycleOfPiece.has(a) ? 1 : 0.5));
  }

  private drawPreview(previewing: boolean): void {
    if (!previewing) {
      this.preview.geometry.setDrawRange(0, 0);
      return;
    }
    const cand = this.computeEdges((p) => p.moved || p.grabbedBy !== null).filter(
      ([a, b]) => !this.hasEdge(a, b),
    );
    writeEdges(this.preview, cand, this.pieces, () => 1);
  }
}

const WHITE = new THREE.Color(0xffffff);
const _c = new THREE.Color();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();

function makeLines(maxEdges: number, opacity: number): THREE.LineSegments {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxEdges * 6), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxEdges * 6), 3).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  const m = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const l = new THREE.LineSegments(g, m);
  l.frustumCulled = false;
  l.renderOrder = 1;
  return l;
}

function writeEdges(l: THREE.LineSegments, edges: Edge[], pieces: Piece[], gain: (a: number) => number): void {
  const pos = l.geometry.getAttribute('position') as THREE.BufferAttribute;
  const col = l.geometry.getAttribute('color') as THREE.BufferAttribute;
  let i = 0;
  for (const [a, b] of edges) {
    const k = gain(a);
    const pa = pieces[a].group.position;
    const pb = pieces[b].group.position;
    _d.subVectors(pb, pa).normalize();
    for (const n of [a, b]) {
      // El hilo nace en el borde del contorno, no en el centro.
      const p = _e.copy(pieces[n].group.position).addScaledVector(_d, (n === a ? 1 : -1) * pieces[n].radius);
      pos.setXYZ(i, p.x, p.y, p.z);
      _c.copy(pieces[n].color).multiplyScalar(k);
      col.setXYZ(i, _c.r, _c.g, _c.b);
      i++;
    }
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
  l.geometry.setDrawRange(0, i);
}

function dominantColor(ps: Piece[], preferred: number | null): THREE.Color {
  const count = new Map<string, number>();
  for (const p of ps) count.set(p.colorName, (count.get(p.colorName) ?? 0) + 1);
  const max = Math.max(...count.values());
  const pref = ps.find((p) => p.id === preferred && count.get(p.colorName) === max);
  const winner = pref ?? ps.find((p) => count.get(p.colorName) === max)!;
  return winner.color.clone();
}
