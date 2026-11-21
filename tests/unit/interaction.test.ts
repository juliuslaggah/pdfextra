import { describe, expect, it } from 'vitest';
import { resizeBounds, snapToText } from '../../src/lib/interaction';

const run = (x: number, y: number, w: number, h = 14) => ({ rect: { x, y, w, h } });

describe('snapToText', () => {
  const items = [run(72, 100, 150), run(222, 100, 100), run(72, 120, 300), run(72, 140, 200)];
  it('clips a single-line drag to the dragged range and merges runs on the line', () => {
    expect(snapToText(items, { x: 100, y: 104, w: 200, h: 4 })).toEqual([{ x: 100, y: 100, w: 200, h: 14 }]);
  });
  it('selects whole runs for a multi-line drag, one rect per line', () => {
    const r = snapToText(items, { x: 80, y: 102, w: 100, h: 40 });
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ x: 80, y: 100, w: 242, h: 14 }); // from drag start to line end
    expect(r[1]).toEqual({ x: 72, y: 120, w: 300, h: 14 }); // whole middle line
    expect(r[2]).toEqual({ x: 72, y: 140, w: 108, h: 14 }); // line start to drag end
  });
  it('returns nothing away from text', () => {
    expect(snapToText(items, { x: 400, y: 400, w: 50, h: 50 })).toEqual([]);
  });
});

describe('resizeBounds', () => {
  const b = { x: 100, y: 100, w: 100, h: 50 };
  it('moves the right edge with the east handle', () => {
    expect(resizeBounds(b, 'e', 20, 99, false)).toEqual({ x: 100, y: 100, w: 120, h: 50 });
  });
  it('moves the origin with the north-west handle', () => {
    expect(resizeBounds(b, 'nw', 10, 10, false)).toEqual({ x: 110, y: 110, w: 90, h: 40 });
  });
  it('keeps aspect ratio when asked', () => {
    const r = resizeBounds(b, 'se', 100, 0, true);
    expect(r.w / r.h).toBeCloseTo(2);
  });
  it('never collapses below the minimum size', () => {
    const r = resizeBounds(b, 'w', 500, 0, false);
    expect(r.w).toBe(4);
  });
});
