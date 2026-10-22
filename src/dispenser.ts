import * as THREE from 'three';
import { SHAPE_COLOR, type ShapeKind } from './config';
import { lineMaterial, shapeGeo } from './pieces';

// La fuente: una fila de siluetas apagadas, una por forma. Pellizcar una
// saca una pieza nueva; soltar una pieza encima la retira. Aparece después
// del primer bucle cerrado (segundo descubrimiento).

export const KINDS: ShapeKind[] = ['sphere', 'ring', 'tube', 'prism', 'dot'];

interface Slot {
  kind: ShapeKind;
  position: THREE.Vector3;
  group: THREE.Group;
  line: THREE.Mesh;
  hot: number;
}

const fillMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, fog: false });

export class Dispenser {
  readonly object = new THREE.Group();
  private slots: Slot[];
  private reveal = 0;
  private visible = false;
  hot: ShapeKind | 'all' | null = null; // silueta resaltada (agarre o retirada)
  full = false; // límite de piezas alcanzado

  constructor(
    positions: THREE.Vector3[],
    private scale: number,
  ) {
    this.slots = KINDS.map((kind, i) => {
      const geo = shapeGeo(kind);
      const group = new THREE.Group();
      const line = new THREE.Mesh(geo.line, lineMaterial(SHAPE_COLOR[kind], true));
      line.position.z = 0.0005;
      const glyph = new THREE.Group();
      glyph.add(new THREE.Mesh(geo.fill, fillMaterial), line);
      if (kind === 'tube') glyph.rotation.z = -0.5;
      group.add(glyph);
      group.position.copy(positions[i]);
      group.scale.setScalar(1e-4);
      this.object.add(group);
      return { kind, position: positions[i].clone(), group, line, hot: 0 };
    });
    this.object.visible = false;
  }

  get shown(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.object.visible = true;
  }

  kindAt(point: THREE.Vector3, radius: number): ShapeKind | null {
    if (!this.visible || this.full) return null;
    let best: Slot | null = null;
    let bestD = radius;
    for (const s of this.slots) {
      const d = s.position.distanceTo(point);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best?.kind ?? null;
  }

  near(point: THREE.Vector3, radius: number): boolean {
    return this.visible && this.slots.some((s) => s.position.distanceTo(point) < radius);
  }

  positionOf(kind: ShapeKind): THREE.Vector3 {
    return this.slots.find((s) => s.kind === kind)!.position;
  }

  update(dt: number, time: number, eye: THREE.Vector3): void {
    if (!this.visible) return;
    this.reveal = Math.min(1, this.reveal + dt / 1.2);
    const r = 1 - Math.pow(1 - this.reveal, 3);
    this.slots.forEach((s, i) => {
      const target = this.hot === 'all' || this.hot === s.kind ? 1 : 0;
      s.hot += (target - s.hot) * Math.min(1, dt * 10);
      const breathe = 1 + 0.05 * Math.sin(time * 1.6 + i * 0.9);
      s.group.scale.setScalar(Math.max(1e-4, this.scale * r * breathe * (1 + 0.25 * s.hot) * (this.full ? 0.8 : 1)));
      s.group.lookAt(eye);
      s.line.material = lineMaterial(SHAPE_COLOR[s.kind], s.hot < 0.5);
    });
  }
}

// Posiciones de la fuente en VR: una fila bajo el arco, más cerca del cuerpo.
export function dispenserPositionsVR(cfg: { y: number; z: number; spacing: number }): THREE.Vector3[] {
  return KINDS.map((_, i) => new THREE.Vector3((i - (KINDS.length - 1) / 2) * cfg.spacing, cfg.y, cfg.z));
}
