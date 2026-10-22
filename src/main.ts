import * as THREE from 'three';
import './style.css';
import { Stage } from './scene';
import { Experience } from './experience';
import { FpsMeter } from './fps';

// En desarrollo (fuera del casco) se instala IWER: emula un Quest 3 con manos
// para probar sin hardware. No entra en el build de producción.
if (import.meta.env.DEV && !/OculusBrowser/i.test(navigator.userAgent)) {
  const [{ XRDevice, metaQuest3 }, { DevUI }] = await Promise.all([import('iwer'), import('@iwer/devui')]);
  const device = new XRDevice(metaQuest3);
  device.primaryInputMode = 'hand';
  device.installRuntime({ forceInstall: true });
  device.installDevUI(DevUI);
  (window as unknown as { xrDevice: unknown }).xrDevice = device;
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const landing = document.querySelector<HTMLElement>('#landing')!;
const button = document.querySelector<HTMLButtonElement>('#enter')!;
const status = document.querySelector<HTMLElement>('#status')!;

const stage = new Stage(canvas);
stage.scene.add(stage.camera);
const params = new URLSearchParams(location.search);
const fps = import.meta.env.DEV || params.has('fps') ? new FpsMeter(stage.camera) : null;

let audioCtx: AudioContext | null = null;
let experience: Experience | null = null;
let needsAnchor = false;

const clock = new THREE.Clock();
const headPos = new THREE.Vector3();
const headQuat = new THREE.Quaternion();

stage.renderer.setAnimationLoop((_t, frame) => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const time = clock.elapsedTime;
  const xr = stage.renderer.xr;

  if (needsAnchor && frame && xr.isPresenting) {
    const pose = frame.getViewerPose(xr.getReferenceSpace()!);
    if (pose) {
      const { position: p, orientation: o } = pose.transform;
      stage.anchorAt(headPos.set(p.x, p.y, p.z), headQuat.set(o.x, o.y, o.z, o.w));
      needsAnchor = false;
      experience?.start();
    }
  }

  if (experience && xr.isPresenting) {
    experience.update(dt, time);
    experience.audio.updateListener(xr.getCamera());
  }
  stage.update(dt, time);
  if (fps) {
    fps.mesh.visible = xr.isPresenting;
    fps.update(dt);
  }
  stage.renderer.render(stage.scene, stage.camera);
});

async function init(): Promise<void> {
  const xr = navigator.xr;
  const supported = xr ? await xr.isSessionSupported('immersive-vr').catch(() => false) : false;
  if (!supported) {
    button.disabled = true;
    status.textContent = 'Abre este enlace en el navegador de Meta Quest 3.';
    return;
  }
  button.disabled = false;
  button.addEventListener('click', enter);
}

async function enter(): Promise<void> {
  // El AudioContext se crea y reanuda dentro del gesto del usuario.
  audioCtx ??= new AudioContext({ latencyHint: 'interactive' });
  void audioCtx.resume();
  let session: XRSession;
  try {
    session = await navigator.xr!.requestSession('immersive-vr', {
      optionalFeatures: ['hand-tracking', 'local-floor'],
    });
  } catch (e) {
    status.textContent = 'No se pudo iniciar la sesión VR.';
    console.error(e);
    return;
  }
  experience ??= new Experience(stage, audioCtx);
  if (import.meta.env.DEV) Object.assign(window, { filamento: { stage, experience } });
  await stage.renderer.xr.setSession(session);
  needsAnchor = true;
  landing.classList.add('hidden');
  session.addEventListener('end', () => {
    landing.classList.remove('hidden');
    void audioCtx?.suspend();
  });
}

void init();
