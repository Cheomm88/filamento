import * as THREE from 'three';
import { PIECES, TOUCH } from './config';
import { arcPosition, type FlatLayout, type Piece } from './pieces';
import type { InputRig, Pointer } from './input';
import type { Stage } from './scene';

// Modo pantalla: cámara fija frente a un plano, toques (o ratón) como punteros
// y un leve paralaje con el giroscopio para conservar la sensación de espacio.

// Dónde viven la cúpula de bucles guardados y la fuente de piezas, y cómo
// se escalan las distancias. VR y pantalla lo definen cada uno a su manera.
export interface SongSpace {
  readonly domeSlots: THREE.Vector3[];
  readonly dispenserSlots: THREE.Vector3[];
  readonly shrinkStartY: number; // el bucle empieza a encogerse por encima
  readonly storeY: number; // soltado por encima, se guarda
  readonly scale: number; // factor de distancias respecto a VR
}

export class ScreenLayout implements SongSpace {
  readonly flat: FlatLayout;
  readonly distanceScale: number;
  readonly grabRadius: number;
  readonly titlePosition: THREE.Vector3;
  readonly titleScale: number;
  readonly bounds: { x: number; yLow: number; yHigh: number };
  readonly domeSlots: THREE.Vector3[] = [];
  readonly dispenserSlots: THREE.Vector3[] = [];
  readonly shrinkStartY: number;
  readonly storeY: number;
  private box: { w: number; h: number };
  private distance = 1;
  private tilt = new THREE.Vector2(); // objetivo de paralaje (-1..1)
  private tiltSmooth = new THREE.Vector2();
  private baseline: THREE.Vector2 | null = null;

  get scale(): number {
    return this.distanceScale;
  }

  // De arriba abajo: dos filas de bucles guardados, la franja de notas
  // (arco de piezas) y la fila de la fuente.
  constructor(private stage: Stage) {
    const aspect = window.innerWidth / window.innerHeight;
    const fit = aspect >= 1 ? TOUCH.fitLandscape : TOUCH.fitPortrait;
    const tan = Math.tan(THREE.MathUtils.degToRad(TOUCH.fov / 2));
    const d = Math.max(fit.h / 2 / tan, fit.w / 2 / (tan * aspect));
    const hVis = 2 * d * tan;
    const wVis = hVis * aspect;
    const cy = TOUCH.centerY;
    const top = cy + hVis / 2;
    const bottom = cy - hVis / 2;
    const maxArcX = Math.max(...PIECES.layout.map((l) => Math.abs(arcPosition(l.angle, 0).x)));

    this.flat = {
      planeZ: TOUCH.planeZ,
      spread: (TOUCH.margin * wVis) / maxArcX,
      yLow: bottom + 0.17 * hVis,
      yHigh: top - 0.3 * hVis,
      pieceScale: TOUCH.pieceScale,
    };
    const minSide = Math.min(wVis, hVis);
    this.distanceScale = THREE.MathUtils.clamp(minSide / 0.9, 0.5, 1.2);
    this.grabRadius = 0.11 * minSide;
    this.bounds = { x: 0.46 * wVis, yLow: bottom + 0.03 * hVis, yHigh: top - 0.03 * hVis };
    this.box = { w: wVis, h: hVis };
    this.titlePosition = new THREE.Vector3(0, cy + TOUCH.titleOffsetY, TOUCH.planeZ);
    this.titleScale = Math.min(1, (wVis * 0.8) / 0.64); // 0.64: ancho del título

    const perRow = aspect >= 1 ? 6 : 4;
    for (const rowY of [top - 0.08 * hVis, top - 0.19 * hVis]) {
      for (let i = 0; i < perRow; i++) {
        const x = (i - (perRow - 1) / 2) * ((0.84 * wVis) / perRow);
        this.domeSlots.push(new THREE.Vector3(x, rowY, TOUCH.planeZ));
      }
    }
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * Math.min(0.13 * wVis, 0.11);
      this.dispenserSlots.push(new THREE.Vector3(x, bottom + 0.075 * hVis, TOUCH.planeZ));
    }
    this.shrinkStartY = this.flat.yHigh;
    this.storeY = top - 0.25 * hVis;

    stage.camera.fov = TOUCH.fov;
    this.fit();
    window.addEventListener('resize', () => this.fit());
    window.addEventListener('deviceorientation', (e) => this.onOrientation(e));
  }

  // Ajusta la distancia de cámara para que todo el espacio de juego quepa.
  private fit(): void {
    const cam = this.stage.camera;
    const aspect = window.innerWidth / window.innerHeight;
    const tan = Math.tan(THREE.MathUtils.degToRad(TOUCH.fov / 2));
    this.distance = Math.max(this.box.h / 2 / tan, this.box.w / 2 / (tan * aspect));
    this.stage.world.position.set(0, -TOUCH.centerY, -this.distance - TOUCH.planeZ);
    this.stage.world.rotation.set(0, 0, 0);
    this.stage.world.updateMatrixWorld(true);
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
  }

  private onOrientation(e: DeviceOrientationEvent): void {
    if (e.beta === null || e.gamma === null) return;
    // Gira los ejes según la orientación de la pantalla.
    const angle = THREE.MathUtils.degToRad(screen.orientation?.angle ?? 0);
    const g = e.gamma;
    const b = e.beta;
    const x = g * Math.cos(angle) + b * Math.sin(angle);
    const y = b * Math.cos(angle) - g * Math.sin(angle);
    if (!this.baseline) this.baseline = new THREE.Vector2(x, y);
    // La referencia se recentra despacio: sostener el móvil inclinado no
    // deja la escena desplazada para siempre.
    this.baseline.lerp(new THREE.Vector2(x, y), 0.01);
    this.tilt.set(
      THREE.MathUtils.clamp((x - this.baseline.x) / 20, -1, 1),
      THREE.MathUtils.clamp((y - this.baseline.y) / 20, -1, 1),
    );
  }

  update(dt: number): void {
    this.tiltSmooth.lerp(this.tilt, Math.min(1, dt * 4));
    const cam = this.stage.camera;
    cam.position.set(this.tiltSmooth.x * TOUCH.parallax, -this.tiltSmooth.y * TOUCH.parallax, 0);
    cam.lookAt(0, 0, -this.distance);
  }
}

// iOS pide permiso para el giroscopio; debe llamarse dentro de un gesto.
export function requestMotionPermission(): void {
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  DOE?.requestPermission?.().catch(() => {});
}

class TouchPointer implements Pointer {
  readonly isHand = false;
  tracked = false;
  pinching = false;
  pinchAge = 0;
  squeezing = false;
  readonly point = new THREE.Vector3();
  readonly palm = this.point;
  readonly tips = [this.point];
  grabbed: Piece | null = null;
  readonly grabOffset = new THREE.Vector3();
  pointerId: number | null = null;
  readonly ndc = new THREE.Vector2();

  constructor(
    readonly index: number,
    readonly grabRadius: number,
  ) {}
}

export class TouchRig implements InputRig {
  readonly pointers: TouchPointer[];
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane();
  private hit = new THREE.Vector3();

  constructor(
    private stage: Stage,
    private layout: ScreenLayout,
  ) {
    this.pointers = [0, 1].map((i) => new TouchPointer(i, layout.grabRadius));
    const el = stage.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      const p = this.pointers.find((p) => p.pointerId === null);
      if (!p) return;
      p.pointerId = e.pointerId;
      this.setNdc(p, e);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // puntero sintético o ya liberado: se sigue sin captura
      }
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.find((p) => p.pointerId === e.pointerId);
      if (p) this.setNdc(p, e);
    });
    const up = (e: PointerEvent) => {
      const p = this.pointers.find((p) => p.pointerId === e.pointerId);
      if (p) p.pointerId = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private setNdc(p: TouchPointer, e: PointerEvent): void {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    p.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  update(world: THREE.Object3D, dt: number): void {
    // Plano de juego en coordenadas de escena.
    const origin = world.localToWorld(new THREE.Vector3(0, 0, TOUCH.planeZ));
    this.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), origin);
    this.stage.camera.updateMatrixWorld();
    for (const p of this.pointers) {
      const down = p.pointerId !== null;
      if (down) {
        this.raycaster.setFromCamera(p.ndc, this.stage.camera);
        if (this.raycaster.ray.intersectPlane(this.plane, this.hit)) world.worldToLocal(p.point.copy(this.hit));
      }
      p.tracked = down;
      p.pinching = down;
      p.squeezing = down;
      p.pinchAge = down ? p.pinchAge + dt : 0;
    }
  }

  constrain(target: THREE.Vector3): void {
    const b = this.layout.bounds;
    target.x = THREE.MathUtils.clamp(target.x, -b.x, b.x);
    target.y = THREE.MathUtils.clamp(target.y, b.yLow, b.yHigh);
    target.z = TOUCH.planeZ;
  }
}
