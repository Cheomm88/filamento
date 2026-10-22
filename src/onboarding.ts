import { PIECES } from './config';
import type { AudioEngine } from './audio';
import type { Piece } from './pieces';

// Onboarding sin texto: título 2 s → una sola pieza que respira (y suena muy
// suave de vez en cuando) → al tocarla, las demás se despliegan en arco.

export type Phase = 'title' | 'waiting' | 'open';

export class Onboarding {
  phase: Phase = 'title';
  private t = 0;
  private breaths = 0;

  constructor(
    private pieces: Piece[],
    private audio: AudioEngine,
  ) {}

  get seed(): Piece {
    return this.pieces[PIECES.onboardingIndex];
  }

  // Llamado cuando termina el título.
  begin(): void {
    if (this.phase !== 'title') return;
    this.phase = 'waiting';
    this.t = 0;
    this.seed.show(null);
  }

  update(dt: number): void {
    if (this.phase !== 'waiting') return;
    this.t += dt;
    const period = PIECES.breathPeriod;
    const phase = (this.t % period) / period;
    this.seed.breath = 0.5 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
    const n = Math.floor(this.t / period + 0.5);
    if (n > this.breaths) {
      this.breaths = n;
      if (n % PIECES.breathNoteEvery === 1) {
        const s = this.seed;
        this.audio.play(s.kind, s.note, this.audio.ctx.currentTime, s.channel.input, 0.35);
      }
    }
  }

  // Al tocar la pieza inicial: las otras 6 salen de ella hacia el arco.
  unfold(): void {
    if (this.phase !== 'waiting') return;
    this.phase = 'open';
    const seed = this.seed;
    seed.breath = 0;
    const order = this.pieces
      .filter((p) => p !== seed)
      .sort((a, b) => Math.abs(a.id - seed.id) - Math.abs(b.id - seed.id) || a.id - b.id);
    const now = this.audio.ctx.currentTime;
    order.forEach((p, i) => {
      const delay = i * 0.09;
      p.show(seed.base, delay);
      // Arpegio de llegada: cada pieza suena al aterrizar.
      const land = delay + PIECES.unfoldDuration * 0.55;
      this.audio.play(p.kind, p.note, now + land, p.channel.input, 0.45);
      setTimeout(() => p.triggerFlash(0.8), land * 1000);
    });
  }
}
