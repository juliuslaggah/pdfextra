// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf, hexToRgb, placement, stampFontSize, type ExportDeps } from '../../src/lib/exportPdf';
import { makeSamplePdf } from '../../src/lib/sample';
import type { Annotation, DocState, PageSpec } from '../../src/lib/types';

const fontDir = resolve(__dirname, '../../public/fonts');
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function textOf(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, standardFontDataUrl: resolve(__dirname, '../../node_modules/pdfjs-dist/standard_fonts') + '/' }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    pages.push(c.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  return pages;
}

async function setup(src?: Uint8Array) {
  const bytes = src ?? (await makeSamplePdf());
  const lib = await PDFDocument.load(bytes);
  const pages: PageSpec[] = lib.getPages().map((p, i) => {
    const { width, height } = p.getSize();
    return { id: `p${i}`, srcId: 'src', srcIndex: i, width, height, baseRotation: 0, rotation: 0 };
  });
  const rasterized: string[] = [];
  const deps: ExportDeps = {
    getSource: () => ({ bytes }),
    loadFont: async (n) => readFileSync(`${fontDir}/${n}.ttf`),
    rasterize: async (spec) => {
      rasterized.push(spec.id);
      return Uint8Array.from(Buffer.from(PNG_1PX.split(',')[1], 'base64'));
    },
  };
  return { pages, deps, rasterized };
}

const text = (pageId: string, t: string, extra: Partial<Annotation> = {}): Annotation => ({
  id: `t${Math.random()}`, pageId, type: 'text', x: 72, y: 72, w: 100, h: 20, text: t,
  fontSize: 14, fontFamily: 'Helvetica', bold: false, italic: false, color: '#ff0000', ...extra,
} as Annotation);

describe('exportPdf', () => {
  it('keeps original vector text and page count', async () => {
    const { pages, deps } = await setup();
    const out = await exportPdf({ pages, annots: [] }, deps);
    const t = await textOf(out);
    expect(t).toHaveLength(3);
    expect(t[0]).toContain('Service Agreement');
  });

  it('adds text annotations in standard and unicode fonts', async () => {
    const { pages, deps } = await setup();
    const annots = [text('p0', 'Hello world'), text('p1', 'Привет мир'), text('p0', 'Line A\nLine B', { fontFamily: 'Times', bold: true })];
    const t = await textOf(await exportPdf({ pages, annots }, deps));
    expect(t[0]).toContain('Hello world');
    expect(t[0]).toContain('Line A');
    expect(t[0]).toContain('Line B');
    expect(t[1].replace(/\s/g, '')).toContain('Приветмир');
  });

  it('honors page order, deletion, blank pages and rotation', async () => {
    const { pages, deps } = await setup();
    const blank: PageSpec = { id: 'b', srcId: null, srcIndex: 0, width: 300, height: 400, baseRotation: 0, rotation: 0 };
    const state: DocState = { pages: [{ ...pages[2] }, blank, { ...pages[0], rotation: 90 }], annots: [] };
    const out = await exportPdf(state, deps);
    const lib = await PDFDocument.load(out);
    expect(lib.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])).toEqual([[792, 612], [300, 400], [792, 612]]);
    const t = await textOf(out);
    expect(t[0]).toContain('landscape appendix');
    expect(t[1]).toBe('');
    expect(t[2]).toContain('Service Agreement');
  });

  it('truly removes redacted content by rasterizing the page', async () => {
    const { pages, deps, rasterized } = await setup();
    const annots: Annotation[] = [
      { id: 'r', pageId: 'p0', type: 'redact', x: 60, y: 140, w: 300, h: 20, color: '#000' },
      text('p0', 'secret note', { x: 70, y: 145 }),
      text('p0', 'visible note', { x: 70, y: 400 }),
    ];
    const t = await textOf(await exportPdf({ pages, annots }, deps));
    expect(rasterized).toEqual(['p0']);
    expect(t[0]).not.toContain('Account number');
    expect(t[0]).not.toContain('secret note');
    expect(t[0]).toContain('visible note');
    expect(t[1]).toContain('Terms and conditions');
  });

  it('draws every annotation type without errors', async () => {
    const { pages, deps } = await setup();
    const P = 'p0';
    const annots: Annotation[] = [
      { id: '1', pageId: P, type: 'highlight', rects: [{ x: 72, y: 90, w: 200, h: 16 }], color: '#fde047' },
      { id: '2', pageId: P, type: 'underline', rects: [{ x: 72, y: 110, w: 200, h: 16 }], color: '#2563eb' },
      { id: '3', pageId: P, type: 'strikeout', rects: [{ x: 72, y: 130, w: 200, h: 16 }], color: '#dc2626' },
      { id: '4', pageId: P, type: 'whiteout', x: 72, y: 150, w: 100, h: 20, color: '#ffffff' },
      { id: '5', pageId: P, type: 'rect', x: 300, y: 300, w: 100, h: 50, stroke: '#000', fill: '#eeeeee', strokeWidth: 2 },
      { id: '6', pageId: P, type: 'ellipse', x: 300, y: 400, w: 100, h: 50, stroke: '#000', fill: null, strokeWidth: 2 },
      { id: '7', pageId: P, type: 'arrow', x1: 100, y1: 500, x2: 200, y2: 550, stroke: '#000', strokeWidth: 2 },
      { id: '8', pageId: P, type: 'ink', paths: [[{ x: 10, y: 10 }, { x: 50, y: 60 }, { x: 90, y: 20 }], [{ x: 5, y: 5 }]], stroke: '#000', strokeWidth: 3, opacity: 1 },
      { id: '9', pageId: P, type: 'image', x: 400, y: 600, w: 50, h: 50, src: PNG_1PX },
      { id: '10', pageId: P, type: 'stamp', x: 380, y: 60, w: 160, h: 50, label: 'APPROVED', color: '#16a34a' },
    ];
    const out = await exportPdf({ pages, annots }, deps);
    const t = await textOf(out);
    expect(t[0]).toContain('APPROVED');
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });

  it('handles source pages with their own /Rotate', async () => {
    const src = await PDFDocument.create();
    const f = await src.embedFont(StandardFonts.Helvetica);
    const p = src.addPage([600, 800]);
    p.drawText('rotated source', { x: 50, y: 700, font: f, size: 12 });
    p.setRotation(degrees(90));
    const bytes = await src.save();
    const { deps } = await setup(bytes);
    const spec: PageSpec = { id: 'p0', srcId: 'src', srcIndex: 0, width: 800, height: 600, baseRotation: 90, rotation: 0 };
    const out = await PDFDocument.load(await exportPdf({ pages: [spec], annots: [] }, deps));
    expect([out.getPage(0).getWidth(), out.getPage(0).getHeight()]).toEqual([800, 600]);
    expect((await textOf(await out.save()))[0]).toContain('rotated source');
  });
});

describe('export helpers', () => {
  it('parses hex colors', () => {
    expect(hexToRgb('#ff0000')).toMatchObject({ red: 1, green: 0, blue: 0 });
    expect(hexToRgb('#0f0')).toMatchObject({ red: 0, green: 1, blue: 0 });
  });
  it('places rotated pages inside the output box', () => {
    expect(placement(90, 600, 800)).toEqual({ x: 0, y: 600, rotate: -90 });
    expect(placement(180, 600, 800)).toEqual({ x: 600, y: 800, rotate: -180 });
    expect(placement(270, 600, 800)).toEqual({ x: 800, y: 0, rotate: -270 });
  });
  it('fits stamp text in its box', () => {
    const s = stampFontSize('APPROVED', 100, 40, (size, t) => size * t.length * 0.6);
    expect(s * 8 * 0.6).toBeLessThanOrEqual(100);
    expect(s).toBeLessThanOrEqual(20);
  });
});
