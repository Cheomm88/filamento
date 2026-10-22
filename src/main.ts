import * as THREE from 'three';
import './style.css';
import { Stage } from './scene';
import { Experience } from './experience';
import { FpsMeter } from './fps';
import { requestMotionPermission } from './touch';
import { songFromUrl, writeSongToUrl } from './song';
import qrcode from 'qrcode-generator';

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
const vrButton = document.querySelector<HTMLButtonElement>('#enter')!;
const screenButton = document.querySelector<HTMLButtonElement>('#screen')!;
const status = document.querySelector<HTMLElement>('#status')!;
const shareButton = document.querySelector<HTMLButtonElement>('#share')!;
const toast = document.querySelector<HTMLElement>('#toast')!;
const songPanel = document.querySelector<HTMLElement>('#song')!;
const qrCanvas = document.querySelector<HTMLCanvasElement>('#qr')!;
const copyButton = document.querySelector<HTMLButtonElement>('#copy')!;
const sendButton = document.querySelector<HTMLButtonElement>('#send')!;
const sharedSong = songFromUrl();
if (sharedSong?.length) {
  document.querySelector<HTMLElement>('.line')!.textContent =
    'Te han enviado un tema hecho de luz. Entra para escucharlo y seguir componiendo.';
}

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

  if (experience?.mode === 'xr' && xr.isPresenting) {
    experience.update(dt, time);
    experience.audio.updateListener(xr.getCamera());
  } else if (experience?.mode === 'screen') {
    experience.layout!.update(dt);
    experience.update(dt, time);
    experience.audio.updateListener(stage.camera);
  }
  stage.update(dt, time);
  if (fps) {
    fps.mesh.visible = xr.isPresenting;
    fps.update(dt);
  }
  stage.renderer.render(stage.scene, stage.camera);
});

async function init(): Promise<void> {
  screenButton.addEventListener('click', enterScreen);
  const xr = navigator.xr;
  const supported = xr ? await xr.isSessionSupported('immersive-vr').catch(() => false) : false;
  if (!supported) {
    // Sin VR, la versión de pantalla pasa a ser la principal.
    vrButton.hidden = true;
    screenButton.classList.add('primary');
    screenButton.textContent = 'Empezar';
    status.textContent = 'En Meta Quest 3, abre este enlace para la versión VR.';
    return;
  }
  vrButton.disabled = false;
  vrButton.addEventListener('click', enterVR);
}

function audio(): AudioContext {
  // El AudioContext se crea y reanuda dentro del gesto del usuario.
  audioCtx ??= new AudioContext({ latencyHint: 'interactive' });
  void audioCtx.resume();
  return audioCtx;
}

async function enterVR(): Promise<void> {
  const ctx = audio();
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
  if (!experience) {
    experience = new Experience(stage, ctx, 'xr');
    setupSong(experience);
  }
  screenButton.hidden = true;
  // La puerta de la cúpula termina la sesión y vuelve a la página de entrada.
  experience.onExitRequest = () => void stage.renderer.xr.getSession()?.end();
  if (import.meta.env.DEV) Object.assign(window, { filamento: { stage, experience } });
  await stage.renderer.xr.setSession(session);
  needsAnchor = true;
  landing.classList.add('hidden');
  session.addEventListener('end', () => {
    landing.classList.remove('hidden');
    updateShare();
    void audioCtx?.suspend();
  });
}

let wakeLock: WakeLockSentinel | null = null;

async function keepAwake(): Promise<void> {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}

function enterScreen(): void {
  const ctx = audio();
  requestMotionPermission();
  experience = new Experience(stage, ctx, 'screen');
  setupSong(experience);
  if (import.meta.env.DEV) Object.assign(window, { filamento: { stage, experience } });
  landing.classList.add('hidden');
  experience.start();
  void keepAwake();
  // Silencio y pausa del reloj de audio cuando la pestaña no se ve.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      void ctx.suspend();
    } else {
      void ctx.resume();
      if (!wakeLock || wakeLock.released) void keepAwake();
    }
  });
}

// El tema (bucles guardados) vive en la URL: copiarla ya es compartirlo.
function setupSong(ex: Experience): void {
  if (sharedSong?.length) ex.loadSong(sharedSong);
  ex.onSongChange = () => {
    writeSongToUrl(ex.songLoops);
    updateShare();
  };
}

// En pantalla: botón flotante. En la página de entrada (al salir de VR):
// panel con QR, copiar enlace y compartir.
function updateShare(): void {
  const hasSong = (experience?.songLoops.length ?? 0) > 0;
  const onLanding = !landing.classList.contains('hidden');
  shareButton.hidden = !(hasSong && experience?.mode === 'screen' && !onLanding);
  songPanel.hidden = !(hasSong && onLanding);
  if (!songPanel.hidden) drawQr(location.href);
  sendButton.hidden = !navigator.share;
}

function drawQr(text: string): void {
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 3;
  const size = qrCanvas.width;
  const cell = Math.floor(size / (n + quiet * 2));
  const offset = Math.floor((size - cell * n) / 2);
  const g = qrCanvas.getContext('2d')!;
  g.fillStyle = '#e8f6f8';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(offset + c * cell, offset + r * cell, cell, cell);
  }
}

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    showToast('Enlace copiado');
  } catch {
    showToast('No se pudo copiar');
  }
});

sendButton.addEventListener('click', () => {
  navigator.share?.({ title: 'Filamento', text: 'Escucha el tema que he hecho con luz', url: location.href }).catch(() => {});
});

let toastTimer = 0;
function showToast(text: string): void {
  toast.textContent = text;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2200);
}

shareButton.addEventListener('click', async () => {
  const url = location.href;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Filamento', text: 'Escucha el tema que he hecho con luz', url });
    } else {
      await navigator.clipboard.writeText(url);
      showToast('Enlace copiado');
    }
  } catch {
    // compartir cancelado
  }
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

void init();
