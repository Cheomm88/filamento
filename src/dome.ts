import * as THREE from 'three';
import { SONG } from './config';
import { circle, outline, roundedPolygon } from './pieces';

// Guías de la cúpula, sin texto:
// - huecos libres marcados con círculos diminutos y tenues;
// - una "pista fantasma": la silueta de un bucle sube sola hasta un hueco,
//   encogiéndose, para enseñar que los bucles se guardan arriba;
// - en VR, una puerta (cuadrado hueco) que, manteniendo el pellizco, saca de
//   la experiencia a la página de entrada para compartir el tema.

const GHOST_DURATION = 2.2;
const DOOR_HOLD = 0.9;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class DomeGuide {
  readonly object = new THREE.Group();
  private markers: THREE.Mesh[];
  private markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false, side: THREE.DoubleSide });
  private hotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false, side: THREE.DoubleSide });
  private ghost: THREE.LineLoop;
  private ghostMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private ghostT = 1;
  private ghostFrom: THREE.Vector3[] = [];
  private ghostTo = new THREE.Vector3();
  private ghostCenter = new THREE.Vector3();
  private visible = 0;
  private shown = false;

  readonly door: THREE.Group | null;
  private doorFill: THREE.Mesh | null = null;
  private doorShown = 0;
  doorProgress = 0;

  constructor(
    slots: THREE.Vector3[],
    private scale: number,
    doorPosition: THREE.Vector3 | null,
  ) {
    const ring = outline([circle(0.006, 24)], 0.0012);
    this.markers = slots.map((p) => {
      const m = new THREE.Mesh(ring, this.markerMat);
      m.position.copy(p);
      m.scale.setScalar(scale);
      this.object.add(m);
      return m;
    });

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SONG.maxPieces * 3), 3));
    this.ghost = new THREE.LineLoop(g, this.ghostMat);
    this.ghost.frustumCulled = false;
    this.ghost.visible = false;
    this.object.add(this.ghost);

    if (doorPosition) {
      const square = roundedPolygon(4, 0.022, 0.004);
      const frame = new THREE.Mesh(outline([square], 0.0016), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, side: THREE.DoubleSide }));
      this.doorFill = new THREE.Mesh(
        new THREE.ShapeGeometry(new THREE.Shape(square)),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, fog: false, side: THREE.DoubleSide }),
      );
      const glyph = new THREE.Group();
      glyph.rotation.z = Math.PI / 4; // el rombo de roundedPolygon, girado a cuadrado
      glyph.add(this.doorFill, frame);
      this.door = new THREE.Group();
      this.door.add(glyph);
      this.door.position.copy(doorPosition);
      this.door.visible = false;
      this.object.add(this.door);
    } else {
      this.door = null;
    }
  }

  show(): void {
    this.shown = true;
  }

  get shownGuides(): boolean {
    return this.shown;
  }

  // La silueta del bucle (puntos en orden) sube a `target` encogiéndose.
  playGhost(points: THREE.Vector3[], target: THREE.Vector3): void {
    if (this.ghostT < 1) return;
    this.ghostFrom = points.map((p) => p.clone());
    this.ghostCenter = points.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(points.length);
    this.ghostTo.copy(target);
    this.ghostT = 0;
    this.ghost.geometry.setDrawRange(0, points.length);
    this.ghost.visible = true;
  }

  get ghostPlaying(): boolean {
    return this.ghostT < 1;
  }

  update(dt: number, eye: THREE.Vector3, free: (i: number) => boolean, hot: number, doorVisible: boolean): void {
    this.visible += ((this.shown ? 1 : 0) - this.visible) * Math.min(1, dt * 2);
    this.markerMat.opacity = 0.22 * this.visible;
    this.hotMat.opacity = 0.9 * this.visible;
    this.markers.forEach((m, i) => {
      m.visible = this.visible > 0.01 && free(i);
      m.material = i === hot ? this.hotMat : this.markerMat;
      m.lookAt(eye);
    });

    if (this.ghostT < 1) {
      this.ghostT = Math.min(1, this.ghostT + dt / GHOST_DURATION);
      const k = easeInOut(this.ghostT);
      const shrink = THREE.MathUtils.lerp(1, SONG.miniScale, k);
      const pos = this.ghost.geometry.getAttribute('position') as THREE.BufferAttribute;
      const center = this.ghostCenter.clone().lerp(this.ghostTo, k);
      this.ghostFrom.forEach((p, i) => {
        const v = p.clone().sub(this.ghostCenter).multiplyScalar(shrink).add(center);
        pos.setXYZ(i, v.x, v.y, v.z);
      });
      pos.needsUpdate = true;
      this.ghostMat.opacity = 0.55 * Math.sin(Math.PI * this.ghostT);
      if (this.ghostT >= 1) this.ghost.visible = false;
    }

    if (this.door && this.doorFill) {
      this.doorShown += ((doorVisible ? 1 : 0) - this.doorShown) * Math.min(1, dt * 2);
      this.door.visible = this.doorShown > 0.01;
      this.door.lookAt(eye);
      const breathe = 1 + 0.06 * Math.sin(performance.now() / 600);
      this.door.scale.setScalar(this.scale * this.doorShown * breathe * (1 + 0.3 * this.doorProgress));
      this.doorFill.scale.setScalar(Math.max(1e-4, this.doorProgress));
    }
  }

  doorNear(point: THREE.Vector3, radius: number): boolean {
    return !!this.door && this.door.visible && this.door.position.distanceTo(point) < radius;
  }

  get doorHold(): number {
    return DOOR_HOLD;
  }
}
