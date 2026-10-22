import type { ShapeKind } from './config';
import { KINDS } from './dispenser';

// Un tema = los bucles guardados en la cúpula. Se codifica en la URL
// (#t=...) para compartirlo: quien abre el enlace lo escucha en VR o en
// pantalla. Solo se guarda lo musical (formas, notas, ritmo, silencios) y la
// forma del bucle; la posición en la cúpula la decide cada modo.

export interface SongLoop {
  kinds: ShapeKind[];
  notes: number[];
  steps: number[]; // pasos de cada tramo (miembro i → i+1)
  offsets: [number, number, number][]; // forma del bucle a tamaño real, en m (VR)
  muted: boolean;
}

interface Packed {
  v: 1;
  c: { k: number[]; n: number[]; s: number[]; o: number[]; m: 0 | 1 }[];
}

export function encodeSong(loops: SongLoop[]): string {
  const packed: Packed = {
    v: 1,
    c: loops.map((l) => ({
      k: l.kinds.map((k) => KINDS.indexOf(k)),
      n: l.notes,
      s: l.steps,
      o: l.offsets.flat().map((v) => Math.round(v * 1000)), // mm
      m: l.muted ? 1 : 0,
    })),
  };
  const b64 = btoa(JSON.stringify(packed));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSong(text: string): SongLoop[] | null {
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const packed = JSON.parse(atob(b64)) as Packed;
    if (packed.v !== 1 || !Array.isArray(packed.c)) return null;
    return packed.c.map((c) => {
      const n = c.k.length;
      if (n < 3 || c.n.length !== n || c.s.length !== n || c.o.length !== n * 3) throw new Error('bad loop');
      return {
        kinds: c.k.map((i) => KINDS[i] ?? 'sphere'),
        notes: c.n.map((x) => Math.max(0, Math.min(10, x | 0))),
        steps: c.s.map((x) => Math.max(1, Math.min(32, x | 0))),
        offsets: Array.from({ length: n }, (_, i) => [c.o[i * 3] / 1000, c.o[i * 3 + 1] / 1000, c.o[i * 3 + 2] / 1000]),
        muted: c.m === 1,
      };
    });
  } catch {
    return null;
  }
}

export function songFromUrl(): SongLoop[] | null {
  const m = location.hash.match(/[#&]t=([A-Za-z0-9_-]+)/);
  return m ? decodeSong(m[1]) : null;
}

export function writeSongToUrl(loops: SongLoop[]): void {
  const url = new URL(location.href);
  url.hash = loops.length ? `t=${encodeSong(loops)}` : '';
  history.replaceState(null, '', url.toString());
}
