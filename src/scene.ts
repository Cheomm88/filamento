import * as THREE from 'three';
import { ATMOSPHERE } from './config';

// Escena oscura: fondo negro, niebla exponencial, polvo instanciado y el
// resplandor de la niebla que aparece con los circuitos cerrados.

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  // Todo lo interactivo cuelga de `world`, anclado a la cabeza al entrar en VR.
  readonly world = new THREE.Group();

  private fog: THREE.FogExp2;
  private background = new THREE.Color(0x000000);
  private glow = new THREE.Color(0x000000); // tono actual de la niebla
  private glowLevel = 0;
  private dust: THREE.InstancedMesh;
  private dustMat: THREE.MeshBasicMaterial;
  private title: THREE.Mesh | null = null;
  private titleTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local');
    this.renderer.xr.setFoveation(1);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
    this.scene.background = this.background;
    this.fog = new THREE.FogExp2(0x000000, ATMOSPHERE.fogDensity);
    this.scene.fog = this.fog;
    this.scene.add(this.world);

    this.dustMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setScalar(ATMOSPHERE.dustBrightness),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.dust = makeDust(this.dustMat);
    this.world.add(this.dust);

    window.addEventListener('resize', () => {
      if (this.renderer.xr.isPresenting) return;
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // Coloca `world` en la cabeza del usuario (solo la orientación horizontal).
  anchorAt(pos: THREE.Vector3, q: THREE.Quaternion): void {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    this.world.position.copy(pos);
    this.world.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
    this.world.updateMatrixWorld(true);
  }

  // Cada nota de un circuito da un pulso a la niebla. El tono se desliza
  // hacia el color de la nota (en vez de sumar colores, que con varios bucles
  // tendería a gris) y la intensidad se acumula y cae.
  pulseGlow(color: THREE.Color, amount = 1): void {
    this.glow.lerp(color, 0.5);
    this.glowLevel = Math.min(1.5, this.glowLevel + amount);
  }

  showTitle(text: string, position?: THREE.Vector3, scale = 1): void {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 192;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.font = '200 120px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.letterSpacing = '40px';
    g.shadowColor = '#00f0ff';
    g.shadowBlur = 24;
    g.fillText(text, 532, 100);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.title = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.12), mat);
    this.title.scale.setScalar(scale);
    if (position) this.title.position.copy(position);
    else this.title.position.set(0, -0.02, -0.9);
    this.world.add(this.title);
    this.titleTime = 0;
  }

  update(dt: number, time: number): void {
    this.glowLevel *= Math.exp(-dt / ATMOSPHERE.glowDecay);
    const level = Math.min(1, this.glowLevel);
    this.background.copy(this.glow).multiplyScalar(level * ATMOSPHERE.glowStrength);
    this.fog.color.copy(this.background);
    this.dustMat.color.setScalar(ATMOSPHERE.dustBrightness * (1 + 1.5 * level));

    this.dust.rotation.y = time * 0.004;
    this.dust.position.y = Math.sin(time * 0.05) * 0.05;

    if (this.title) {
      this.titleTime += dt;
      const t = this.titleTime;
      const d = ATMOSPHERE.titleDuration;
      const fade = 0.5;
      const o = t < fade ? t / fade : t > d - fade ? Math.max(0, (d - t) / fade) : 1;
      (this.title.material as THREE.MeshBasicMaterial).opacity = o * 0.9;
      if (t >= d) {
        this.world.remove(this.title);
        this.title.geometry.dispose();
        (this.title.material as THREE.MeshBasicMaterial).map?.dispose();
        (this.title.material as THREE.MeshBasicMaterial).dispose();
        this.title = null;
      }
    }
  }

  get titleVisible(): boolean {
    return this.title !== null;
  }
}

function makeDust(mat: THREE.Material): THREE.InstancedMesh {
  const n = ATMOSPHERE.dustCount;
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, n);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const r = THREE.MathUtils.lerp(ATMOSPHERE.dustRadiusMin, ATMOSPHERE.dustRadiusMax, Math.pow(Math.random(), 0.7));
    p.randomDirection().multiplyScalar(r);
    p.y *= 0.6;
    const s = ATMOSPHERE.dustSize * (0.5 + Math.random()) * (r * 0.5);
    m.makeScale(s, s, s).setPosition(p);
    mesh.setMatrixAt(i, m);
  }
  mesh.frustumCulled = false;
  return mesh;
}
