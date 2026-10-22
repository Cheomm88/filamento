import * as THREE from 'three';

// Contador de FPS de desarrollo. Se activa con ?fps en la URL (o siempre en
// `npm run dev`). En VR se dibuja en un pequeño panel pegado a la vista.

export class FpsMeter {
  private frames = 0;
  private acc = 0;
  private min = Infinity;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private dom: HTMLDivElement;
  readonly mesh: THREE.Mesh;

  constructor(camera: THREE.Camera) {
    this.canvas.width = 256;
    this.canvas.height = 64;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, 0.02),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, fog: false }),
    );
    this.mesh.position.set(0.09, -0.08, -0.4);
    this.mesh.renderOrder = 10;
    camera.add(this.mesh);
    this.dom = document.createElement('div');
    this.dom.className = 'fps';
    document.body.appendChild(this.dom);
  }

  update(dt: number): void {
    this.frames++;
    this.acc += dt;
    if (dt > 0) this.min = Math.min(this.min, 1 / dt);
    if (this.acc < 0.5) return;
    const fps = Math.round(this.frames / this.acc);
    const text = `${fps} fps · min ${Math.round(this.min)}`;
    this.frames = 0;
    this.acc = 0;
    this.min = Infinity;
    this.dom.textContent = text;
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 64);
    g.fillStyle = fps >= 70 ? '#7dffb0' : fps >= 60 ? '#ffd166' : '#ff5c7a';
    g.font = '32px monospace';
    g.textBaseline = 'middle';
    g.fillText(text, 8, 32);
    this.tex.needsUpdate = true;
  }
}
