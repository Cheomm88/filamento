import * as THREE from 'three';
import { GRAPH, SONG } from './config';
import { getHaloTexture, type Piece } from './pieces';

// Conexiones, pulsos y circuitos.
//
// Cada pieza conecta con 2 vecinas como máximo, así que el grafo solo puede
// tener cadenas y anillos: un circuito cerrado es un componente en el que
// todas las piezas tienen grado 2.
//
// Tiempo: un reloj global (audioContext.currentTime) dividido en semicorcheas.
// Cada tramo dura un número entero de pasos según su longitud. Además, la
// duración total de cada bucle se redondea a medios compases y el bucle
// arranca en un medio compás: así varios bucles forman un tema y no derivan.
//
// Constelaciones: bucles guardados (en miniatura, en la cúpula). Sus
// conexiones y su plan rítmico quedan congelados y se pueden silenciar.

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

// Pasos por tramo de un bucle, indexados por edgeKey.
export type Plan = Map<string, number>;

export interface Constellation {
  key: string;
  order: number[]; // miembros en el orden del recorrido
  plan: Plan;
  muted: boolean;
  slot: number;
}

export interface Cycle {
  key: string;
  members: number[];
  order: number[];
  plan: Plan;
  color: THREE.Color;
  constellation: Constellation | null;
}

export const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export class Network {
  readonly object = new THREE.Group();
  readonly step = 60 / GRAPH.bpm / GRAPH.stepsPerBeat;

  onNote: (pieceId: number, time: number) => void = () => {};
  onCycleClosed: (cycle: Cycle, time: number) => void = () => {};

  readonly constellations: Constellation[] = [];
  hoveredCycle: Cycle | null = null;

  private pieces: Piece[];
  private adj: number[][] = [];
  private edges: Edge[] = [];
  private cycles: Cycle[] = [];
  private cycleOfPiece = new Map<number, Cycle>();
  private pulses: Pulse[] = [];
  private freeSprites: THREE.Sprite[] = [];
  private lines: THREE.LineSegments;
  private preview: THREE.LineSegments;

  private connectDistance: number;
  private pulseSpeed: number;

  // `distanceScale` adapta umbral y velocidad al tamaño del espacio de juego.
  constructor(pieces: Piece[], distanceScale = 1) {
    this.pieces = pieces;
    this.connectDistance = GRAPH.connectDistance * distanceScale;
    this.pulseSpeed = GRAPH.pulseSpeed * distanceScale;
    this.lines = makeLines(SONG.maxPieces, GRAPH.lineOpacity);
    this.preview = makeLines(SONG.maxPieces, GRAPH.previewOpacity);
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

  // Bucles sonando (sin contar los silenciados).
  get audibleCycleCount(): number {
    return this.cycles.filter((c) => !c.constellation?.muted).length;
  }

  get allCycles(): readonly Cycle[] {
    return this.cycles;
  }

  cycleOf(pieceId: number): Cycle | undefined {
    return this.cycleOfPiece.get(pieceId);
  }

  nextTick(now: number): number {
    return Math.ceil((now + 0.03) / this.step) * this.step;
  }

  // Los bucles nuevos arrancan en el siguiente medio compás.
  private nextAlignedTick(now: number): number {
    const unit = this.step * SONG.loopMultiple;
    return Math.ceil((now + 0.03) / unit) * unit;
  }

  // Empareja por distancia creciente respetando el máximo de vecinas.
  // `isMoved` decide qué piezas participan: al menos un extremo debe haberse
  // movido, así las piezas del arco inicial no se enlazan entre sí solas.
  // Las piezas de constelaciones no participan: sus hilos están congelados.
  private computeEdges(isMoved: (p: Piece) => boolean): Edge[] {
    const cand: { a: number; b: number; d: number }[] = [];
    const ps = this.pieces;
    const free = (p: Piece) => p.active && !p.frozen;
    for (let i = 0; i < ps.length; i++) {
      if (!free(ps[i])) continue;
      for (let j = i + 1; j < ps.length; j++) {
        if (!free(ps[j])) continue;
        if (!isMoved(ps[i]) && !isMoved(ps[j])) continue;
        const d = ps[i].base.distanceTo(ps[j].base);
        if (d < this.connectDistance) cand.push({ a: i, b: j, d });
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
    return this.adj[a]?.includes(b) ?? false;
  }

  private rawSteps(a: number, b: number): number {
    const d = this.pieces[a].base.distanceTo(this.pieces[b].base);
    const steps = Math.round(d / this.pulseSpeed / this.step);
    return THREE.MathUtils.clamp(steps, 1, GRAPH.maxStepsPerSegment);
  }

  private segmentSteps(a: number, b: number): number {
    const cycle = this.cycleOfPiece.get(a);
    return cycle?.plan.get(edgeKey(a, b)) ?? this.rawSteps(a, b);
  }

  // Plan rítmico de un bucle: los pasos de cada tramo según su longitud y,
  // si hace falta, pasos extra en los tramos más "apretados" hasta que el
  // total sea múltiplo de medio compás.
  private makePlan(order: number[]): Plan {
    const n = order.length;
    const segs = order.map((a, i) => {
      const b = order[(i + 1) % n];
      const d = this.pieces[a].base.distanceTo(this.pieces[b].base);
      return { key: edgeKey(a, b), steps: this.rawSteps(a, b), want: d / this.pulseSpeed / this.step };
    });
    const total = segs.reduce((s, x) => s + x.steps, 0);
    const m = SONG.loopMultiple;
    const target = total <= m / 2 ? m / 2 : Math.ceil(total / m) * m;
    for (let extra = target - total; extra > 0; extra--) {
      segs.sort((x, y) => y.want / y.steps - x.want / x.steps);
      segs[0].steps++;
    }
    return new Map(segs.map((s) => [s.key, s.steps]));
  }

  private walk(start: number): number[] {
    const order = [start];
    let prev = -1;
    let cur = start;
    for (;;) {
      const next = this.adj[cur].find((n) => n !== prev);
      if (next === undefined || next === start) break;
      order.push(next);
      prev = cur;
      cur = next;
    }
    return order;
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

  // Fija las conexiones (al soltar una pieza o un bucle, o tras un reset).
  commit(released: number | null, now: number): void {
    this.edges = this.computeEdges((p) => p.moved);
    for (const c of this.constellations) {
      c.order.forEach((a, i) => this.edges.push([a, c.order[(i + 1) % c.order.length]]));
    }
    this.adj = this.pieces.map(() => []);
    for (const [a, b] of this.edges) {
      this.adj[a].push(b);
      this.adj[b].push(a);
    }

    // Componentes y circuitos.
    const prev = new Map(this.cycles.map((c) => [c.key, c]));
    const byKey = new Map(this.constellations.map((c) => [c.key, c]));
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
        const key = [...comp].sort((a, b) => a - b).join(',');
        const constellation = byKey.get(key) ?? null;
        const order = constellation?.order ?? this.walk(released !== null && comp.includes(released) ? released : comp[0]);
        const cycle: Cycle = {
          key,
          members: comp,
          order,
          plan: constellation?.plan ?? this.makePlan(order),
          color: dominantColor(comp.map((n) => this.pieces[n]), released),
          constellation,
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

    const aligned = this.nextAlignedTick(now);

    // Exactamente un pulso por circuito. Si el ritmo de un bucle cambió, su
    // pulso vuelve a empezar alineado con el compás.
    for (const cycle of this.cycles) {
      const old = prev.get(cycle.key);
      const samePlan = old !== undefined && planEquals(old.plan, cycle.plan);
      const inCycle = this.pulses.filter((p) => cycle.members.includes(p.segs[0].to));
      const keep = samePlan ? inCycle.slice(0, 1) : [];
      inCycle.filter((p) => !keep.includes(p)).forEach((p) => this.kill(p));
      if (keep.length === 0) this.spawn(cycle.order[0], cycle.order[1], aligned);
      if (!old && !cycle.constellation) this.onCycleClosed(cycle, aligned);
    }

    // Al soltar una pieza en una cadena abierta, un pulso la recorre una vez.
    if (released !== null) {
      const tick = this.nextTick(now);
      if (!this.cycleOfPiece.has(released)) {
        for (const n of this.adj[released]) this.spawn(released, n, tick);
      }
      this.onNote(released, tick);
    }
  }

  // Lanza el patrón de una pieza (tocarla sin moverla), como un pad: suena
  // una vez y el pulso recorre su cadena. Entra en el siguiente tiempo de
  // negra para que un toque impreciso caiga a tempo. Dentro de un bucle
  // cerrado no hace nada: el bucle ya suena solo.
  launch(id: number, now: number): void {
    if (this.cycleOfPiece.has(id)) return;
    const beat = this.step * GRAPH.stepsPerBeat;
    const tick = Math.ceil((now + 0.03) / beat) * beat;
    for (const n of this.adj[id] ?? []) this.spawn(id, n, tick);
    this.onNote(id, tick);
  }

  // ---- Constelaciones -----------------------------------------------------

  freeze(cycle: Cycle, slot: number): Constellation {
    const c: Constellation = { key: cycle.key, order: cycle.order, plan: cycle.plan, muted: false, slot };
    this.constellations.push(c);
    for (const n of cycle.members) this.pieces[n].frozen = true;
    cycle.constellation = c;
    return c;
  }

  // Añade una constelación ya hecha (al cargar un tema compartido).
  addConstellation(order: number[], steps: number[], muted: boolean, slot: number): Constellation {
    const plan: Plan = new Map(order.map((a, i) => [edgeKey(a, order[(i + 1) % order.length]), steps[i]]));
    const key = [...order].sort((a, b) => a - b).join(',');
    const c: Constellation = { key, order, plan, muted, slot };
    this.constellations.push(c);
    for (const n of order) {
      this.pieces[n].frozen = true;
      this.pieces[n].setMuted(muted);
    }
    return c;
  }

  unfreeze(c: Constellation): void {
    this.constellations.splice(this.constellations.indexOf(c), 1);
    for (const n of c.order) {
      this.pieces[n].frozen = false;
      this.pieces[n].setMuted(false);
    }
  }

  setMuted(c: Constellation, muted: boolean): void {
    c.muted = muted;
    for (const n of c.order) this.pieces[n].setMuted(muted);
  }

  // Bucle cuyo hilo pasa a menos de `radius` del punto (para agarrarlo).
  cycleNear(point: THREE.Vector3, radius: number): Cycle | null {
    let best: Cycle | null = null;
    let bestD = radius;
    for (const c of this.cycles) {
      for (let i = 0; i < c.order.length; i++) {
        const a = this.pieces[c.order[i]].group.position;
        const b = this.pieces[c.order[(i + 1) % c.order.length]].group.position;
        const d = _seg.set(a, b).closestPointToPoint(point, true, _e).distanceTo(point);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }

  // Quita los pulsos que pasan por piezas que van a desaparecer.
  dropPulsesTouching(ids: number[]): void {
    for (const p of [...this.pulses]) {
      if (p.segs.some((s) => ids.includes(s.from) || ids.includes(s.to))) this.kill(p);
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
        const next = this.adj[last.to]?.find((n) => n !== last.from);
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
      p.sprite.scale.setScalar(0.05 * Math.min(a.group.scale.x, b.group.scale.x) / a.flatScale);
      const m = p.sprite.material as THREE.SpriteMaterial;
      m.color.copy(a.color).lerp(b.color, k).lerp(WHITE, 0.35);
      m.opacity = a.muted ? 0.2 : 1;
    }
  }

  private drawLines(): void {
    writeEdges(this.lines, this.edges, this.pieces, (a) => {
      const c = this.cycleOfPiece.get(a);
      if (!c) return 0.5;
      if (c.constellation?.muted) return 0.12;
      return c === this.hoveredCycle ? 1.8 : 1;
    });
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
const _seg = new THREE.Line3();

function planEquals(a: Plan, b: Plan): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

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
  const max = pos.count / 2;
  let i = 0;
  for (const [a, b] of edges.slice(0, max)) {
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
