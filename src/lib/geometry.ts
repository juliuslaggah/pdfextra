import type { Annotation, PageSpec, Point, Rect, Rotation } from './types';

export const uid = (() => {
  let n = 0;
  return (p = 'id') => `${p}_${Date.now().toString(36)}_${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
})();

export function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function unionRects(rs: Rect[]): Rect {
  const x1 = Math.min(...rs.map((r) => r.x));
  const y1 = Math.min(...rs.map((r) => r.y));
  const x2 = Math.max(...rs.map((r) => r.x + r.w));
  const y2 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function pointInRect(p: Point, r: Rect, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function getBounds(a: Annotation): Rect {
  switch (a.type) {
    case 'highlight': case 'underline': case 'strikeout':
      return unionRects(a.rects);
    case 'line': case 'arrow':
      return normRect({ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 });
    case 'ink': {
      const pts = a.paths.flat();
      if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
      return normRect(
        { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) },
        { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) },
      );
    }
    default:
      return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
}

/** Precise hit test used by pointer selection and the eraser. */
export function hitTest(a: Annotation, p: Point, tol = 4): boolean {
  switch (a.type) {
    case 'line': case 'arrow':
      return distToSegment(p, { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }) <= tol + a.strokeWidth / 2;
    case 'ink':
      return a.paths.some((path) =>
        path.length === 1
          ? Math.hypot(p.x - path[0].x, p.y - path[0].y) <= tol + a.strokeWidth
          : path.some((pt, i) => i > 0 && distToSegment(p, path[i - 1], pt) <= tol + a.strokeWidth / 2));
    case 'highlight': case 'underline': case 'strikeout':
      return a.rects.some((r) => pointInRect(p, r, tol / 2));
    default:
      return pointInRect(p, getBounds(a), tol / 2);
  }
}

export function translate<T extends Annotation>(a: T, dx: number, dy: number): T {
  switch (a.type) {
    case 'highlight': case 'underline': case 'strikeout':
      return { ...a, rects: a.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })) };
    case 'line': case 'arrow':
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case 'ink':
      return { ...a, paths: a.paths.map((pa) => pa.map((p) => ({ x: p.x + dx, y: p.y + dy }))) };
    default:
      return { ...a, x: (a as Rect).x + dx, y: (a as Rect).y + dy };
  }
}

/** Map every point of an annotation through `f` (used for resize/rotate). */
function mapPoints<T extends Annotation>(a: T, f: (p: Point) => Point, swapWH = false): T {
  const mapRect = (r: Rect): Rect => {
    const p1 = f({ x: r.x, y: r.y });
    const p2 = f({ x: r.x + r.w, y: r.y + r.h });
    return normRect(p1, p2);
  };
  switch (a.type) {
    case 'highlight': case 'underline': case 'strikeout':
      return { ...a, rects: a.rects.map(mapRect) };
    case 'line': case 'arrow': {
      const p1 = f({ x: a.x1, y: a.y1 }), p2 = f({ x: a.x2, y: a.y2 });
      return { ...a, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    }
    case 'ink':
      return { ...a, paths: a.paths.map((pa) => pa.map(f)) };
    case 'text': {
      // text keeps its size and orientation; only its anchor moves
      const r = mapRect(a);
      return swapWH ? { ...a, x: r.x + (r.w - a.w) / 2, y: r.y + (r.h - a.h) / 2 } : { ...a, ...r };
    }
    default:
      return { ...a, ...mapRect(a as unknown as Rect) };
  }
}

/** Scale an annotation so its bounds become `to`. */
export function resizeTo<T extends Annotation>(a: T, to: Rect): T {
  const from = getBounds(a);
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  const res = mapPoints(a, (p) => ({ x: to.x + (p.x - from.x) * sx, y: to.y + (p.y - from.y) * sy }));
  if (a.type === 'text') {
    const t = res as typeof a;
    return { ...t, fontSize: Math.max(4, Math.round(a.fontSize * sy * 10) / 10) } as T;
  }
  return res;
}

/** Displayed size of a page, accounting for user rotation. */
export function pageSize(p: PageSpec): { w: number; h: number } {
  return p.rotation % 180 === 0 ? { w: p.width, h: p.height } : { w: p.height, h: p.width };
}

/** Rotate a point inside a w×h frame by `deg` clockwise. Returns point in the rotated frame. */
export function rotatePoint(p: Point, w: number, h: number, deg: Rotation): Point {
  switch (deg) {
    case 90: return { x: h - p.y, y: p.x };
    case 180: return { x: w - p.x, y: h - p.y };
    case 270: return { x: p.y, y: w - p.x };
    default: return p;
  }
}

/** Re-position an annotation after its page (currently w×h) is rotated by `deg` clockwise. */
export function rotateAnnot<T extends Annotation>(a: T, w: number, h: number, deg: Rotation): T {
  if (deg === 0) return a;
  return mapPoints(a, (p) => rotatePoint(p, w, h, deg), deg % 180 !== 0);
}

export const addRotation = (a: Rotation, b: number): Rotation => ((((a + b) % 360) + 360) % 360) as Rotation;
