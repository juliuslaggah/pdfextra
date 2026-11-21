import { exportPdf } from './exportPdf';
import { renderPageToCanvas, sources } from './pdfjs';
import type { DocState, InkAnnot, PageSpec, Rect } from './types';

const RASTER_DPI_SCALE = 2.5; // ~180 dpi
const MAX_SIDE = 5000;

async function rasterize(spec: PageSpec, blackout: Rect[], erase: InkAnnot[]): Promise<Uint8Array> {
  const longest = Math.max(spec.width, spec.height);
  const scale = Math.min(RASTER_DPI_SCALE, MAX_SIDE / longest);
  const canvas = document.createElement('canvas');
  const r = await renderPageToCanvas(spec, scale, canvas);
  await r.promise;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  // eraser strokes, painted exactly as the editor draws them
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const a of erase) {
    ctx.strokeStyle = a.stroke;
    ctx.fillStyle = a.stroke;
    ctx.lineWidth = a.strokeWidth * scale;
    for (const path of a.paths) {
      if (!path.length) continue;
      ctx.beginPath();
      if (path.length === 1) {
        ctx.arc(path[0].x * scale, path[0].y * scale, (a.strokeWidth * scale) / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.moveTo(path[0].x * scale, path[0].y * scale);
      for (const p of path.slice(1)) ctx.lineTo(p.x * scale, p.y * scale);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#000';
  for (const b of blackout) ctx.fillRect(Math.floor(b.x * scale), Math.floor(b.y * scale), Math.ceil(b.w * scale) + 1, Math.ceil(b.h * scale) + 1);
  // JPEG keeps scanned pages small; redaction boxes stay solid black either way
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.92));
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
