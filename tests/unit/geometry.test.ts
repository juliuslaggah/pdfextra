import { describe, expect, it } from 'vitest';
import { addRotation, getBounds, hitTest, normRect, pageSize, rectsIntersect, resizeTo, rotateAnnot, rotatePoint, translate, unionRects } from '../../src/lib/geometry';
import type { InkAnnot, LineAnnot, MarkupAnnot, PageSpec, ShapeAnnot, TextAnnot } from '../../src/lib/types';

const shape: ShapeAnnot = { id: 's', pageId: 'p', type: 'rect', x: 10, y: 20, w: 100, h: 50, stroke: '#000', fill: null, strokeWidth: 2 };
const line: LineAnnot = { id: 'l', pageId: 'p', type: 'line', x1: 0, y1: 0, x2: 100, y2: 0, stroke: '#000', strokeWidth: 2 };
const ink: InkAnnot = { id: 'i', pageId: 'p', type: 'ink', paths: [[{ x: 5, y: 5 }, { x: 25, y: 45 }]], stroke: '#000', strokeWidth: 2, opacity: 1 };
const mark: MarkupAnnot = { id: 'm', pageId: 'p', type: 'highlight', rects: [{ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 20, w: 30, h: 10 }], color: '#ff0' };
const text: TextAnnot = { id: 't', pageId: 'p', type: 'text', x: 10, y: 10, w: 40, h: 12, text: 'hi', fontSize: 10, fontFamily: 'Helvetica', bold: false, italic: false, color: '#000' };

describe('rect helpers', () => {
  it('normalizes rects from any drag direction', () => {
    expect(normRect({ x: 50, y: 60 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 40, h: 40 });
  });
  it('detects intersection and union', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(unionRects(mark.rects)).toEqual({ x: 0, y: 0, w: 30, h: 30 });
  });
});

describe('bounds and hit testing', () => {
  it('computes bounds for every geometry kind', () => {
    expect(getBounds(shape)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(getBounds(line)).toEqual({ x: 0, y: 0, w: 100, h: 0 });
    expect(getBounds(ink)).toEqual({ x: 5, y: 5, w: 20, h: 40 });
    expect(getBounds(mark)).toEqual({ x: 0, y: 0, w: 30, h: 30 });
  });
  it('hits lines near the segment only', () => {
    expect(hitTest(line, { x: 50, y: 3 })).toBe(true);
    expect(hitTest(line, { x: 50, y: 20 })).toBe(false);
  });
  it('hits markup rects but not the gap between lines', () => {
    expect(hitTest(mark, { x: 5, y: 25 })).toBe(true);
    expect(hitTest(mark, { x: 25, y: 5 })).toBe(false);
  });
});

describe('transforms', () => {
  it('translates all kinds', () => {
    expect(getBounds(translate(shape, 5, -5))).toEqual({ x: 15, y: 15, w: 100, h: 50 });
    expect(translate(line, 1, 2)).toMatchObject({ x1: 1, y1: 2, x2: 101, y2: 2 });
    expect(getBounds(translate(ink, 10, 10))).toEqual({ x: 15, y: 15, w: 20, h: 40 });
  });
  it('resizes to a target rect and scales font size', () => {
    expect(getBounds(resizeTo(ink, { x: 0, y: 0, w: 40, h: 80 }))).toEqual({ x: 0, y: 0, w: 40, h: 80 });
    const t = resizeTo(text, { x: 10, y: 10, w: 80, h: 24 });
    expect(t.fontSize).toBe(20);
  });
});

describe('page rotation', () => {
  const spec: PageSpec = { id: 'p', srcId: null, srcIndex: 0, width: 600, height: 800, baseRotation: 0, rotation: 90 };
  it('swaps displayed size for 90/270', () => {
    expect(pageSize(spec)).toEqual({ w: 800, h: 600 });
    expect(pageSize({ ...spec, rotation: 180 })).toEqual({ w: 600, h: 800 });
  });
  it('rotates points clockwise and round-trips after 4 turns', () => {
    expect(rotatePoint({ x: 0, y: 0 }, 600, 800, 90)).toEqual({ x: 800, y: 0 });
    let p = { x: 12, y: 34 };
    let [w, h] = [600, 800];
    for (let i = 0; i < 4; i++) { p = rotatePoint(p, w, h, 90); [w, h] = [h, w]; }
    expect(p).toEqual({ x: 12, y: 34 });
  });
  it('keeps a rotated shape inside the new page frame', () => {
    const r = getBounds(rotateAnnot(shape, 600, 800, 90));
    expect(r).toEqual({ x: 800 - 70, y: 10, w: 50, h: 100 });
  });
  it('normalizes rotation arithmetic', () => {
    expect(addRotation(270, 90)).toBe(0);
    expect(addRotation(0, -90)).toBe(270);
  });
});
