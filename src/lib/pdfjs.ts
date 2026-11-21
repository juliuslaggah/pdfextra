import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageSpec, Rect, Rotation } from './types';
import { uid } from './geometry';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface Source {
  id: string;
  name: string;
  bytes: Uint8Array;
  doc: PDFDocumentProxy;
  password?: string;
}

/** Loaded source documents. Kept outside React state: they are immutable and large. */
export const sources = new Map<string, Source>();

export class PasswordError extends Error {
  constructor(public incorrect: boolean) { super(incorrect ? 'Incorrect password' : 'Password required'); }
}

export async function openPdf(bytes: Uint8Array, name: string, password?: string): Promise<{ source: Source; pages: PageSpec[] }> {
  // pdf.js transfers the buffer to its worker, so hand it a copy
  const task = pdfjs.getDocument({
    data: bytes.slice(), password, isEvalSupported: false,
    standardFontDataUrl: '/pdfjs/standard_fonts/', cMapUrl: '/pdfjs/cmaps/', cMapPacked: true,
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e: unknown) {
    const err = e as { name?: string; code?: number };
    if (err?.name === 'PasswordException') throw new PasswordError(err.code === 2);
    throw e;
  }
  const source: Source = { id: uid('src'), name, bytes, doc, password };
  sources.set(source.id, source);
  const pages: PageSpec[] = [];
  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    pages.push({
      id: uid('pg'), srcId: source.id, srcIndex: i,
      width: vp.width, height: vp.height,
      baseRotation: (((page.rotate % 360) + 360) % 360) as Rotation, rotation: 0,
    });
  }
  return { source, pages };
}

export function getPdfPage(spec: PageSpec): Promise<PDFPageProxy> | null {
  if (!spec.srcId) return null;
  const s = sources.get(spec.srcId);
  return s ? s.doc.getPage(spec.srcIndex + 1) : null;
}

export function viewportFor(page: PDFPageProxy, spec: PageSpec, scale: number) {
  return page.getViewport({ scale, rotation: (spec.baseRotation + spec.rotation) % 360 });
}

/** Render a page (no annotations) to a canvas. Blank pages render white. */
export async function renderPageToCanvas(spec: PageSpec, scale: number, canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const rotW = spec.rotation % 180 === 0 ? spec.width : spec.height;
  const rotH = spec.rotation % 180 === 0 ? spec.height : spec.width;
  canvas.width = Math.max(1, Math.floor(rotW * scale));
  canvas.height = Math.max(1, Math.floor(rotH * scale));
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const pp = getPdfPage(spec);
  if (!pp) return { cancel() {}, promise: Promise.resolve() };
  const page = await pp;
  const task = page.render({ canvasContext: ctx, viewport: viewportFor(page, spec, scale) });
  return { cancel: () => task.cancel(), promise: task.promise };
}

export interface TextItem {
  str: string;
  rect: Rect;
  fontSize: number;
  fontName: string;
  /** css font-family pdf.js resolved for this font, used to guess serif/mono */
  fontFamily: string;
}

const textCache = new Map<string, Promise<TextItem[]>>();

/** Text runs on a page, in displayed coordinates (scale 1). */
export function getTextItems(spec: PageSpec): Promise<TextItem[]> {
  const key = `${spec.srcId}:${spec.srcIndex}:${spec.rotation}`;
  let p = textCache.get(key);
  if (!p) {
    p = (async () => {
      const pp = getPdfPage(spec);
      if (!pp) return [];
      const page = await pp;
      const vp = viewportFor(page, spec, 1);
      const content = await page.getTextContent();
      const styles = content.styles as Record<string, { fontFamily: string }>;
      const out: TextItem[] = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const [a, b, c, d, e, f] = it.transform as number[];
        const size = Math.hypot(c, d) || Math.hypot(a, b);
        const width = it.width || size * it.str.length * 0.5;
        // only upright text (relative to the PDF) gets a reliable box
        const rad = Math.atan2(b, a);
        if (Math.abs(rad) > 0.01) continue;
        const descent = size * 0.22;
        const [x1, y1, x2, y2] = vp.convertToViewportRectangle([e, f - descent, e + width, f + size * 0.95]);
        out.push({
          str: it.str,
          rect: { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) },
          fontSize: size,
          fontName: it.fontName,
          fontFamily: styles[it.fontName]?.fontFamily ?? 'sans-serif',
        });
      }
      return out;
    })();
    textCache.set(key, p);
  }
  return p;
}
