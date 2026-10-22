// Todas las constantes de diseño en un solo sitio para afinar rápido.
// Unidades: metros, segundos, hercios. Coordenadas relativas a la cabeza del
// usuario al entrar en VR (x derecha, y arriba, -z delante).

export type ColorName = 'cyan' | 'magenta' | 'amber';
export type ShapeKind = 'sphere' | 'ring' | 'tube' | 'prism' | 'dot';

export const COLORS: Record<ColorName, number> = {
  cyan: 0x00f0ff,
  magenta: 0xff2bd6,
  amber: 0xffb000,
};

// Cada forma tiene un timbre y un color fijos.
export const SHAPE_COLOR: Record<ShapeKind, ColorName> = {
  sphere: 'cyan',
  ring: 'magenta',
  dot: 'magenta',
  tube: 'amber',
  prism: 'amber',
};

export const PIECES = {
  // Orden de izquierda a derecha en el arco. El índice ONBOARDING_INDEX es la
  // pieza que respira sola al principio.
  layout: [
    { kind: 'ring', angle: -72, y: -0.42 },
    { kind: 'prism', angle: -48, y: -0.5 },
    { kind: 'dot', angle: -24, y: -0.2 },
    { kind: 'sphere', angle: 0, y: -0.3 },
    { kind: 'tube', angle: 24, y: -0.14 },
    { kind: 'sphere', angle: 48, y: -0.36 },
    { kind: 'ring', angle: 72, y: -0.24 },
  ] as { kind: ShapeKind; angle: number; y: number }[],
  onboardingIndex: 3,
  arcRadius: 0.4, // distancia horizontal desde la cabeza
  onboardingDistance: 0.34, // la primera pieza, algo más cerca
  unfoldDuration: 1.4,
  swayAmplitude: 0.003,
  swaySpeed: 0.7,
  spinSpeed: 0.25,
  breathPeriod: 3.2, // respiración de la pieza inicial
  breathNoteEvery: 2, // suena cada N respiraciones mientras espera
  resetDuration: 1.8,
  maxDistanceFromHead: 0.75, // las piezas no se pueden alejar más de esto
};

export const HALO = {
  baseScale: 0.085,
  hoverScale: 1.3,
  flashScale: 1.6,
  baseOpacity: 0.22,
  flashDecay: 0.11, // constante de tiempo; ~400 ms hasta apagarse
  coreFlashScale: 0.12,
  rippleDuration: 0.7, // onda que se expande desde el contorno en cada nota
  rippleScale: 2.4,
};

export const INPUT = {
  grabRadiusHand: 0.06,
  grabRadiusController: 0.08,
  grabGrace: 0.3, // s tras empezar el pinch en los que aún se puede agarrar
  hoverRadius: 0.1,
  pinchStart: 0.02, // distancia pulgar-índice para empezar el pinch
  pinchEnd: 0.04, // histéresis para soltar
  touchRadius: 0.06, // tocar la pieza inicial con cualquier dedo
  palmsDistance: 0.11,
  palmsHold: 1.5,
  fingertipSize: 0.0045,
  fingertipOpacity: 0.35,
};

export const GRAPH = {
  connectDistance: 0.35,
  maxNeighbors: 2,
  pulseSpeed: 0.7, // m/s
  bpm: 96,
  stepsPerBeat: 4, // semicorcheas: el tiempo de cada tramo se cuantiza a esto
  maxStepsPerSegment: 4,
  lookahead: 0.12, // s de antelación al programar audio
  maxPulses: 24,
  previewOpacity: 0.18,
  lineOpacity: 0.75,
};

export const MUSIC = {
  // Pentatónica menor de La, 2 octavas: La3 → La5.
  rootHz: 220,
  scale: [0, 3, 5, 7, 10],
  octaves: 2,
  // Franja de altura (y relativa a la cabeza) que recorre la escala.
  yLow: -0.62,
  yHigh: -0.04,
  hysteresis: 0.25, // fracción de un escalón para no oscilar entre notas
};

export const AUDIO = {
  masterGain: 0.8,
  reverbSeconds: 4.5,
  reverbWet: 0.5,
  droneGain: 0.035,
  droneHz: [55, 82.41],
  loopDroneHz: [110, 164.81, 220],
  loopDroneGain: 0.018,
  previewGain: 0.5,
};

export const ATMOSPHERE = {
  fogDensity: 0.22,
  dustCount: 160,
  dustRadiusMin: 0.9,
  dustRadiusMax: 6,
  dustSize: 0.006,
  dustBrightness: 0.1,
  glowDecay: 0.55, // s; caída del resplandor de la niebla tras cada nota
  glowStrength: 0.012, // brillo máximo del fondo (lineal) con un circuito sonando
  titleDuration: 2.4,
};

// Modo pantalla (móvil/tablet/escritorio sin VR): las piezas viven en un plano
// frontal. Las medidas se reescalan al tamaño visible de la pantalla.
export const TOUCH = {
  planeZ: -0.36,
  centerY: -0.33,
  fov: 50,
  // Caja mínima que debe verse (m) en apaisado y en vertical.
  fitLandscape: { w: 1.0, h: 0.78 },
  fitPortrait: { w: 0.62, h: 0.78 },
  margin: 0.42, // fracción de media pantalla que ocupan arco y escala
  pieceScale: 1.35,
  grabRadius: 0.075,
  parallax: 0.045, // desplazamiento máximo de cámara con el giroscopio
  titleOffsetY: 0.08,
};
