import type { Rect } from './types';

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/** Estimate the background colour around `rect` and the text colour inside it
 *  from a rendered page canvas (`scale` = canvas pixels per PDF point). */
export function sampleColors(canvas: HTMLCanvasElement, rect: Rect, scale: number): { bg: string; fg: string } {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const x = Math.max(0, Math.floor((rect.x - 2) * scale));
    const y = Math.max(0, Math.floor((rect.y - 2) * scale));
    const w = Math.min(canvas.width - x, Math.ceil((rect.w + 4) * scale));
    const h = Math.min(canvas.height - y, Math.ceil((rect.h + 4) * scale));
    if (w <= 0 || h <= 0) return { bg: '#ffffff', fg: '#000000' };
    const data = ctx.getImageData(x, y, w, h).data;
    // background: most common colour on the border of the sampled box
    const counts = new Map<string, number>();
    const px = (i: number, j: number) => {
      const k = (j * w + i) * 4;
      return [data[k], data[k + 1], data[k + 2]] as const;
    };
    const bump = (i: number, j: number) => {
      const [r, g, b] = px(i, j);
      const key = hex(r & 0xf8, g & 0xf8, b & 0xf8);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    };
    for (let i = 0; i < w; i++) { bump(i, 0); bump(i, h - 1); }
    for (let j = 0; j < h; j++) { bump(0, j); bump(w - 1, j); }
    let bgKey = '#ffffff', best = -1;
    for (const [k, c] of counts) if (c > best) { best = c; bgKey = k; }
    const bgN = parseInt(bgKey.slice(1), 16);
    const bg = [(bgN >> 16) & 255, (bgN >> 8) & 255, bgN & 255];
    const bgExact = bg.map((v) => Math.min(255, v + (v >= 0xf8 ? 7 : 4)));
    // foreground: the pixel furthest from the background
    let fg = [0, 0, 0], far = -1;
    for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) {
      const [r, g, b] = px(i, j);
      const d = (r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2;
      if (d > far) { far = d; fg = [r, g, b]; }
    }
    return { bg: hex(bgExact[0], bgExact[1], bgExact[2]), fg: far < 900 ? '#000000' : hex(fg[0], fg[1], fg[2]) };
  } catch {
    return { bg: '#ffffff', fg: '#000000' };
  }
}
