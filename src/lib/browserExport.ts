import { exportPdf } from './exportPdf';
import { renderPageToCanvas, sources } from './pdfjs';
import type { DocState, PageSpec, Rect } from './types';

const RASTER_DPI_SCALE = 2.5; // ~180 dpi
const MAX_SIDE = 5000;

async function rasterize(spec: PageSpec, blackout: Rect[]): Promise<Uint8Array> {
  const longest = Math.max(spec.width, spec.height);
  const scale = Math.min(RASTER_DPI_SCALE, MAX_SIDE / longest);
  const canvas = document.createElement('canvas');
  const r = await renderPageToCanvas(spec, scale, canvas);
  await r.promise;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  for (const b of blackout) ctx.fillRect(Math.floor(b.x * scale), Math.floor(b.y * scale), Math.ceil(b.w * scale) + 1, Math.ceil(b.h * scale) + 1);
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  canvas.width = canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

const fontCache = new Map<string, Promise<ArrayBuffer>>();
function loadFont(name: string) {
  let p = fontCache.get(name);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}fonts/${name}.ttf`).then((r) => {
      if (!r.ok) throw new Error(`Font ${name} failed to load`);
      return r.arrayBuffer();
    });
    fontCache.set(name, p);
  }
  return p;
}

export function buildPdf(state: DocState, title: string) {
  return exportPdf(state, {
    getSource: (id) => sources.get(id),
    rasterize,
    loadFont,
    title,
  });
}

export function downloadBytes(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function editedName(name: string) {
  const base = name.replace(/\.pdf$/i, '') || 'document';
  return `${base}-edited.pdf`;
}
