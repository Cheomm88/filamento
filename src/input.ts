import * as THREE from 'three';
import { INPUT } from './config';
import type { Piece } from './pieces';

// Une manos (pinch índice-pulgar) y mandos (gatillo) en una sola interfaz.
// Todas las posiciones se expresan en coordenadas de `world` (relativas a la
// cabeza al entrar en VR).

const TIP_JOINTS = [
  'thumb-tip',
  'index-finger-tip',
  'middle-finger-tip',
  'ring-finger-tip',
  'pinky-finger-tip',
] as const;

export class Hand {
  readonly index: number;
  connected = false;
  isHand = false;
  tracked = false;
  pinching = false;
  justPinched = false;
  justReleased = false;
  pinchAge = 0; // segundos desde que empezó el pinch actual
  squeezing = false; // botón de agarre del mando (reset con mandos)
  readonly point = new THREE.Vector3();
  readonly palm = new THREE.Vector3();
  readonly tips = TIP_JOINTS.map(() => new THREE.Vector3());
  grabbed: Piece | null = null;
  readonly grabOffset = new THREE.Vector3();
  lastNote = -1;

  controller: THREE.XRTargetRaySpace;
  hand: THREE.XRHandSpace;
  private selectDown = false;

  constructor(index: number, renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.index = index;
    this.controller = renderer.xr.getController(index);
    this.hand = renderer.xr.getHand(index);
    scene.add(this.controller, this.hand);

    this.controller.addEventListener('connected', (e) => {
      const src = (e as unknown as { data: XRInputSource }).data;
      this.connected = true;
      this.isHand = !!src.hand;
    });
    this.controller.addEventListener('disconnected', () => {
      this.connected = false;
      this.tracked = false;
      this.selectDown = false;
      this.squeezing = false;
    });
    this.controller.addEventListener('selectstart', () => (this.selectDown = true));
    this.controller.addEventListener('selectend', () => (this.selectDown = false));
    this.controller.addEventListener('squeezestart', () => (this.squeezing = true));
    this.controller.addEventListener('squeezeend', () => (this.squeezing = false));
  }

  get grabRadius(): number {
    return this.isHand ? INPUT.grabRadiusHand : INPUT.grabRadiusController;
  }

  update(world: THREE.Object3D, dt: number): void {
    const wasPinching = this.pinching;
    this.tracked = false;

    if (this.connected && this.isHand) {
      const j = this.hand.joints;
      const thumb = j['thumb-tip'];
      const index = j['index-finger-tip'];
      const palm = j['middle-finger-metacarpal'];
      if (thumb?.visible && index?.visible && palm?.visible) {
        this.tracked = true;
        TIP_JOINTS.forEach((name, i) => {
          const joint = j[name];
          if (joint) world.worldToLocal(this.tips[i].copy(joint.position));
        });
        world.worldToLocal(this.palm.copy(palm.position));
        const d = this.tips[0].distanceTo(this.tips[1]);
        if (!this.pinching && d < INPUT.pinchStart) this.pinching = true;
        else if (this.pinching && d > INPUT.pinchEnd) this.pinching = false;
        this.point.addVectors(this.tips[0], this.tips[1]).multiplyScalar(0.5);
      }
    } else if (this.connected && this.controller.visible) {
      this.tracked = true;
      world.worldToLocal(this.point.copy(this.controller.position));
      this.palm.copy(this.point);
      this.pinching = this.selectDown;
    }

    if (!this.tracked) this.pinching = false;
    this.justPinched = this.pinching && !wasPinching;
    this.justReleased = !this.pinching && wasPinching;
    this.pinchAge = this.pinching ? this.pinchAge + dt : 0;
  }
}

// Puntas de los dedos (o punta del mando) como puntos de luz tenues.
export class HandVisuals {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();

  constructor() {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, 10);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    for (let i = 0; i < 10; i++) this.mesh.setColorAt(i, this.c.setScalar(0));
  }

  // `charge` 0..1: progreso del gesto de reset, ilumina todas las puntas.
  update(hands: Hand[], charge: number): void {
    const s = INPUT.fingertipSize;
    for (let h = 0; h < 2; h++) {
      const hand = hands[h];
      for (let t = 0; t < 5; t++) {
        const i = h * 5 + t;
        let size = 0;
        let bright = 0;
        if (hand.tracked && hand.isHand) {
          const active = hand.pinching && t < 2;
          size = s * (active ? 1.4 : 1) * (1 + charge * 0.8);
          bright = INPUT.fingertipOpacity + (active ? 0.5 : 0) + charge * 0.6;
          this.m.makeScale(size, size, size).setPosition(hand.tips[t]);
        } else if (hand.tracked && t === 0) {
          size = s * 1.6 * (hand.pinching ? 1.4 : 1) * (1 + charge * 0.8);
          bright = INPUT.fingertipOpacity + (hand.pinching ? 0.5 : 0) + charge * 0.6;
          this.m.makeScale(size, size, size).setPosition(hand.point);
        }
        if (size === 0) this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
        this.mesh.setColorAt(i, this.c.setScalar(Math.min(1, bright)));
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
