import * as THREE from 'three';
import { COLORS, HALO, MUSIC, PIECES, SHAPE_COLOR, type ColorName, type ShapeKind } from './config';
import { heightToNote, type AudioEngine, type Channel } from './audio';

// Piezas planas y huecas: un contorno fino de neón con el interior negro,
// siempre de cara al usuario. Geometrías y materiales compartidos; solo el
// halo y la onda de cada nota tienen material propio.

let haloTexture: THREE.Texture | null = null;

export function getHaloTexture(): THREE.Texture {
  if (haloTexture) return haloTexture;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  haloTexture = new THREE.CanvasTexture(c);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

// ---- Contornos 2D (plano XY, metros) --------------------------------------

const LINE = 0.0018; // grosor del trazo

export function circle(r: number, n = 64): THREE.Vector2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
  });
}

// Polígono regular con esquinas redondeadas.
export function roundedPolygon(sides: number, r: number, corner: number, perCorner = 10): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const inner = r - corner / Math.cos(Math.PI / sides);
  for (let i = 0; i < sides; i++) {
    const a = Math.PI / 2 + (i / sides) * Math.PI * 2;
    const cx = Math.cos(a) * inner;
    const cy = Math.sin(a) * inner;
    for (let k = 0; k <= perCorner; k++) {
      const b = a - Math.PI / sides + (k / perCorner) * ((Math.PI * 2) / sides);
      pts.push(new THREE.Vector2(cx + Math.cos(b) * corner, cy + Math.sin(b) * corner));
    }
  }
  return pts;
}

function stadium(halfLength: number, r: number, n = 24): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    pts.push(new THREE.Vector2(Math.cos(a) * r, halfLength + Math.sin(a) * r));
  }
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI;
    pts.push(new THREE.Vector2(Math.cos(a) * r, -halfLength + Math.sin(a) * r));
  }
  return pts;
}

// Banda de grosor constante a lo largo de un contorno cerrado.
export function outline(contours: THREE.Vector2[][], width = LINE): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const pts of contours) {
    const base = pos.length / 3;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      const t = next.clone().sub(prev).normalize();
      const nx = t.y;
      const ny = -t.x;
      const p = pts[i];
      pos.push(p.x + (nx * width) / 2, p.y + (ny * width) / 2, 0);
      pos.push(p.x - (nx * width) / 2, p.y - (ny * width) / 2, 0);
      const a = base + i * 2;
      const b = base + ((i + 1) % n) * 2;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

interface ShapeDef {
  lines: THREE.Vector2[][];
  fill: THREE.Vector2[];
  radius: number; // dónde terminan los hilos
}

const shapes: Record<ShapeKind, () => ShapeDef> = {
  sphere: () => ({ lines: [circle(0.02)], fill: circle(0.02), radius: 0.02 }),
  ring: () => ({ lines: [circle(0.024), circle(0.0165)], fill: circle(0.024), radius: 0.024 }),
  tube: () => ({ lines: [stadium(0.024, 0.0075)], fill: stadium(0.024, 0.0075), radius: 0.016 }),
  prism: () => {
    const tri = roundedPolygon(3, 0.026, 0.004);
    return { lines: [tri], fill: tri, radius: 0.018 };
  },
  dot: () => ({ lines: [circle(0.0065, 32)], fill: circle(0.0065, 32), radius: 0.0065 }),
};

interface ShapeGeo {
  line: THREE.BufferGeometry;
  fill: THREE.BufferGeometry;
  radius: number;
}

const shapeCache = new Map<ShapeKind, ShapeGeo>();
export function shapeGeo(kind: ShapeKind): ShapeGeo {
  let s = shapeCache.get(kind);
  if (!s) {
    const d = shapes[kind]();
    s = { line: outline(d.lines), fill: new THREE.ShapeGeometry(new THREE.Shape(d.fill)), radius: d.radius };
    shapeCache.set(kind, s);
  }
  return s;
}

// `dim`: variante apagada para piezas silenciadas y siluetas de la fuente.
const lineMaterials = new Map<string, THREE.MeshBasicMaterial>();
export function lineMaterial(name: ColorName, dim = false): THREE.MeshBasicMaterial {
  const key = name + (dim ? ':dim' : '');
  let m = lineMaterials.get(key);
  if (!m) {
    const c = new THREE.Color(COLORS[name]).lerp(new THREE.Color(0xffffff), 0.12);
    if (dim) c.multiplyScalar(0.22);
    m = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, fog: false });
    lineMaterials.set(key, m);
  }
  return m;
}
const fillMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, fog: false });

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Piece {
  readonly id: number;
  readonly kind: ShapeKind;
  readonly colorName: ColorName;
  readonly color: THREE.Color;
  private baseRadius: number;
  readonly group = new THREE.Group(); // mira siempre a la cámara
  readonly glyph = new THREE.Group(); // contorno + relleno, gira en su plano
  readonly halo: THREE.Sprite;
  readonly ripple: THREE.Mesh;
  private line: THREE.Mesh;
  readonly home: THREE.Vector3;
  readonly base = new THREE.Vector3(); // posición de reposo
  readonly channel: Channel;

  moved = false; // solo entra en el grafo de conexiones tras moverla una vez
  active = false; // visible e interactuable
  frozen = false; // forma parte de una constelación guardada
  disposed = false; // retirada; su hueco en el array se puede reutilizar
  muted = false;
  flatScale = 1; // escala base (modo pantalla)
  shrink = 1; // escala de miniatura (constelaciones)
  grabbedBy: number | null = null;
  hoverTarget = 0;
  breath = 0; // usado por el onboarding
  lastPreview = -Infinity; // hora de audio de la última vista previa de altura
  silentOnce = false; // la próxima nota no suena (ya sonó en la vista previa)
  note = 0;

  private hover = 0;
  private flash = 0;
  private rippleT = 1;
  private reveal = 0; // 0..1 aparición
  private phase = Math.random() * Math.PI * 2;
  private baseRoll: number;
  private tween: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; ease: (t: number) => number } | null = null;

  constructor(id: number, kind: ShapeKind, home: THREE.Vector3, audio: AudioEngine) {
    this.id = id;
    this.kind = kind;
    this.colorName = SHAPE_COLOR[kind];
    this.color = new THREE.Color(COLORS[this.colorName]);
    this.home = home.clone();
    this.base.copy(home);

    const geo = shapeGeo(kind);
    this.baseRadius = geo.radius;
    const line = new THREE.Mesh(geo.line, lineMaterial(this.colorName));
    line.position.z = 0.0005;
    this.line = line;
    const fill = new THREE.Mesh(geo.fill, fillMaterial);
    this.glyph.add(fill, line);
    this.baseRoll = kind === 'tube' ? -0.5 : 0;
    this.glyph.rotation.z = this.baseRoll;

    this.ripple = new THREE.Mesh(
      geo.line,
      new THREE.MeshBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    this.ripple.visible = false;
    this.ripple.renderOrder = 3;

    // El halo queda detrás del relleno negro: solo brilla alrededor del trazo.
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getHaloTexture(),
        color: this.color,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.halo.position.z = -0.004;
    this.halo.renderOrder = 2;

    this.group.add(this.halo, this.glyph, this.ripple);
    this.group.position.copy(home);
    this.group.visible = false;

    this.channel = audio.createChannel();
    this.note = heightToNote(home.y);
  }

  show(from: THREE.Vector3 | null, delay = 0): void {
    this.active = true;
    this.group.visible = true;
    this.reveal = -delay / (PIECES.unfoldDuration * 0.6);
    if (from) this.moveTo(this.home, PIECES.unfoldDuration, from, easeOutCubic, delay);
  }

  moveTo(target: THREE.Vector3, dur: number, from: THREE.Vector3 = this.base, ease = easeInOut, delay = 0): void {
    this.tween = { from: from.clone(), to: target.clone(), t: -delay, dur, ease };
    this.base.copy(from);
  }

  get radius(): number {
    return this.baseRadius * this.group.scale.x;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.line.material = lineMaterial(this.colorName, muted);
  }

  // Retira la pieza de la escena y libera su canal de audio.
  dispose(): void {
    this.active = false;
    this.disposed = true;
    this.group.removeFromParent();
    (this.halo.material as THREE.Material).dispose();
    (this.ripple.material as THREE.Material).dispose();
    this.channel.input.disconnect();
    this.channel.panner.disconnect();
  }

  get animating(): boolean {
    return this.tween !== null;
  }

  triggerFlash(strength = 1): void {
    if (this.muted) strength *= 0.25;
    this.flash = Math.max(this.flash, strength);
    if (strength >= 0.5) this.rippleT = 0;
  }

  // `eye`: posición de la cámara en coordenadas de escena.
  update(dt: number, time: number, eye: THREE.Vector3): void {
    if (!this.group.visible) return;

    if (this.tween) {
      const tw = this.tween;
      tw.t += dt;
      const k = tw.ease(THREE.MathUtils.clamp(tw.t / tw.dur, 0, 1));
      this.base.lerpVectors(tw.from, tw.to, k);
      if (tw.t >= tw.dur) this.tween = null;
    }
    this.reveal = Math.min(1, this.reveal + dt / (PIECES.unfoldDuration * 0.6));

    const p = this.group.position.copy(this.base);
    const s = time * PIECES.swaySpeed + this.phase;
    if (this.grabbedBy === null) {
      const a = PIECES.swayAmplitude;
      p.x += Math.sin(s) * a;
      p.y += Math.sin(s * 1.3 + 1.1) * a;
      p.z += Math.cos(s * 0.8) * a;
    }
    this.group.lookAt(eye);
    this.group.scale.setScalar(this.flatScale * this.shrink);
    this.glyph.rotation.z = this.baseRoll + Math.sin(s * 0.5) * 0.08;

    this.hover += (this.hoverTarget - this.hover) * Math.min(1, dt * 12);
    this.flash *= Math.exp(-dt / HALO.flashDecay);
    if (this.flash < 0.001) this.flash = 0;

    const r = Math.max(0, this.reveal);
    const glow = this.flash + this.breath * 0.6;
    const scale =
      HALO.baseScale * r * (1 + (HALO.hoverScale - 1) * this.hover) * (1 + (HALO.flashScale - 1) * glow);
    this.halo.scale.setScalar(Math.max(scale, 1e-4));
    (this.halo.material as THREE.SpriteMaterial).opacity = Math.min(
      1,
      (HALO.baseOpacity + 0.2 * this.hover + (1 - HALO.baseOpacity) * glow) * r * (this.muted ? 0.3 : 1),
    );
    const g = Math.max(r * (1 + HALO.coreFlashScale * this.flash + 0.08 * this.hover), 1e-4);
    this.glyph.scale.setScalar(g);

    // Onda: una copia del contorno que se expande y se apaga en cada nota.
    if (this.rippleT < 1) {
      this.rippleT = Math.min(1, this.rippleT + dt / HALO.rippleDuration);
      const k = easeOutCubic(this.rippleT);
      this.ripple.visible = true;
      this.ripple.scale.setScalar(1 + k * (HALO.rippleScale - 1));
      this.ripple.rotation.z = this.glyph.rotation.z;
      (this.ripple.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
    } else {
      this.ripple.visible = false;
    }
  }
}

// Posiciones del arco (en coordenadas relativas a la cabeza).
export function arcPosition(angleDeg: number, y: number, radius = PIECES.arcRadius): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(angleDeg);
  return new THREE.Vector3(Math.sin(a) * radius, y, -Math.cos(a) * radius);
}

// Modo pantalla: el arco se aplana sobre un plano y se reescala a la pantalla.
export interface FlatLayout {
  planeZ: number;
  spread: number; // factor horizontal
  yLow: number; // franja vertical equivalente a MUSIC.yLow..yHigh
  yHigh: number;
  pieceScale: number;
}

export function createPieces(audio: AudioEngine, flat: FlatLayout | null = null): Piece[] {
  return PIECES.layout.map((l, i) => {
    const r = i === PIECES.onboardingIndex ? PIECES.onboardingDistance : PIECES.arcRadius;
    const home = arcPosition(l.angle, l.y, r);
    if (flat) {
      const t = (l.y - MUSIC.yLow) / (MUSIC.yHigh - MUSIC.yLow);
      home.set(home.x * flat.spread, THREE.MathUtils.lerp(flat.yLow, flat.yHigh, t), flat.planeZ);
    }
    const piece = new Piece(i, l.kind, home, audio);
    if (flat) piece.flatScale = flat.pieceScale;
    return piece;
  });
}
