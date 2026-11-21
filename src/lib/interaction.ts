import type { Rect } from './types';
import { unionRects } from './geometry';

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type Handle = (typeof HANDLES)[number];

/** Turn a drag rectangle into per-line text-selection rects, like a text cursor
 *  selection: a one-line drag is clipped to the drag; across several lines the
 *  first line runs from the drag start to its end, middle lines are whole, and
 *  the last line runs from its start to the drag end. */
export function snapToText(items: { rect: Rect }[], r: Rect): Rect[] {
  // runs whose vertical extent overlaps the drag
  const rows = items
    .map((it) => it.rect)
    .filter((t) => t.y < r.y + r.h && r.y < t.y + t.h)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  // group into lines by vertical centre
  const lines: Rect[][] = [];
  for (const t of rows) {
    const line = lines.find((l) => Math.abs(l[0].y + l[0].h / 2 - (t.y + t.h / 2)) < Math.min(l[0].h, t.h) / 2);
    if (line) line.push(t); else lines.push([t]);
  }
  lines.sort((a, b) => a[0].y - b[0].y);
  const x1 = r.x, x2 = r.x + r.w;
  const out: Rect[] = [];
  lines.forEach((line, i) => {
    const first = i === 0, last = i === lines.length - 1, single = lines.length === 1;
    const lo = single || first ? x1 : -Infinity;
    const hi = single || last ? x2 : Infinity;
    const parts = line
      .map((t) => {
        const a = Math.max(t.x, lo), b = Math.min(t.x + t.w, hi);
        return b - a > 0.5 ? { x: a, y: t.y, w: b - a, h: t.h } : null;
      })
      .filter((x): x is Rect => !!x)
      .sort((a, b) => a.x - b.x);
    // merge neighbouring runs on the line, keep big gaps (columns) apart
    for (const p of parts) {
      const prev = out[out.length - 1];
      if (prev && Math.abs(prev.y + prev.h / 2 - (p.y + p.h / 2)) < p.h / 2 && p.x - (prev.x + prev.w) < p.h * 2) {
        out[out.length - 1] = unionRects([prev, p]);
      } else out.push(p);
    }
  });
  return out;
}

export function resizeBounds(b: Rect, handle: Handle, dx: number, dy: number, keepAspect: boolean): Rect {
  let { x, y, w, h } = b;
  if (handle.includes('w')) { x += dx; w -= dx; }
  if (handle.includes('e')) { w += dx; }
  if (handle.includes('n')) { y += dy; h -= dy; }
  if (handle.includes('s')) { h += dy; }
  if (keepAspect && b.w > 0 && b.h > 0) {
    const ratio = b.w / b.h;
    const nh = w / ratio;
    if (handle.includes('n')) y += h - nh;
    h = nh;
  }
  const min = 4;
  if (w < min) { if (handle.includes('w')) x -= min - w; w = min; }
  if (h < min) { if (handle.includes('n')) y -= min - h; h = min; }
  return { x, y, w, h };
}

