import { BlendMode, LineCapStyle, PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Annotation, BoxAnnot, DocState, FontFamily, InkAnnot, PageSpec, Rect, TextAnnot } from './types';
import { getBounds, pageSize, rectsIntersect } from './geometry';
import { BASELINE, LINE_HEIGHT, isWinAnsi } from './textLayout';

export interface ExportDeps {
  /** Original bytes of a source document */
  getSource(srcId: string): { bytes: Uint8Array; password?: string } | undefined;
  /** Render a source page (displayed frame) to PNG with the given rects blacked out.
   *  Needed for redaction and for pages pdf-lib cannot copy. */
  rasterize?(spec: PageSpec, blackout: Rect[], erase: InkAnnot[]): Promise<Uint8Array>;
  /** Bytes of the bundled Unicode font: 'DejaVuSans' | 'DejaVuSans-Bold' */
  loadFont(name: 'DejaVuSans' | 'DejaVuSans-Bold'): Promise<ArrayBuffer | Uint8Array>;
  title?: string;
}

export function hexToRgb(hex: string) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return rgb(0, 0, 0);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export function dataUrlToBytes(url: string): { bytes: Uint8Array; kind: 'png' | 'jpg' } {
  const [head, b64] = url.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const kind = /jpe?g/i.test(head) || (bytes[0] === 0xff && bytes[1] === 0xd8) ? 'jpg' : 'png';
  return { bytes, kind };
}

const STD: Record<FontFamily, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

class FontCache {
  private cache = new Map<string, Promise<PDFFont>>();
  constructor(private doc: PDFDocument, private deps: ExportDeps) {}
  get(t: Pick<TextAnnot, 'fontFamily' | 'bold' | 'italic' | 'text'>): Promise<PDFFont> {
    if (isWinAnsi(t.text)) {
      const name = STD[t.fontFamily][(t.bold ? 1 : 0) + (t.italic ? 2 : 0)];
      return this.memo(name, () => this.doc.embedFont(name));
    }
    const name = t.bold ? 'DejaVuSans-Bold' : 'DejaVuSans';
    return this.memo(name, async () => this.doc.embedFont(await this.deps.loadFont(name), { subset: true }));
  }
  private memo(k: string, f: () => Promise<PDFFont>) {
    let p = this.cache.get(k);
    if (!p) { p = f(); this.cache.set(k, p); }
    return p;
  }
}

/** Where to draw an embedded source page so that it appears rotated `r` degrees clockwise. */
export function placement(r: number, w: number, h: number) {
  switch (r) {
    case 90: return { x: 0, y: w, rotate: -90 };
    case 180: return { x: w, y: h, rotate: -180 };
    case 270: return { x: h, y: 0, rotate: -270 };
    default: return { x: 0, y: 0, rotate: 0 };
  }
}

export async function exportPdf(state: DocState, deps: ExportDeps): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const fonts = new FontCache(out, deps);
  const libDocs = new Map<string, Promise<PDFDocument | null>>();
  const loadLib = (srcId: string) => {
    let p = libDocs.get(srcId);
    if (!p) {
      p = (async () => {
        const s = deps.getSource(srcId);
        if (!s) return null;
        try {
          const d = await PDFDocument.load(s.bytes, { ignoreEncryption: true, updateMetadata: false });
          // encrypted content streams cannot be copied as vectors
          return d.isEncrypted ? null : d;
        } catch { return null; }
      })();
      libDocs.set(srcId, p);
    }
    return p;
  };

  for (const spec of state.pages) {
    const { w: W, h: H } = pageSize(spec);
    const page = out.addPage([W, H]);
    const annots = state.annots.filter((a) => a.pageId === spec.id);
    const redacts = annots.filter((a): a is BoxAnnot => a.type === 'redact').map(getBounds);
    // eraser strokes are burned into a flattened copy of the page so nothing underneath survives
    const erases = annots.filter((a): a is InkAnnot => a.type === 'ink' && !!a.erase);

    if (spec.srcId) {
      let drawn = false;
      if (!redacts.length && !erases.length) {
        const lib = await loadLib(spec.srcId);
        if (lib) {
          try {
            const src = lib.getPage(spec.srcIndex);
            const crop = src.getCropBox();
            const media = src.getMediaBox();
            const left = Math.max(crop.x, media.x), bottom = Math.max(crop.y, media.y);
            const right = Math.min(crop.x + crop.width, media.x + media.width);
            const top = Math.min(crop.y + crop.height, media.y + media.height);
            const emb = await out.embedPage(src, { left, bottom, right, top });
            const r = ((((src.getRotation().angle + spec.rotation) % 360) + 360) % 360);
            const pl = placement(r, right - left, top - bottom);
            page.drawPage(emb, { x: pl.x, y: pl.y, rotate: degrees(pl.rotate) });
            drawn = true;
          } catch (e) {
            console.warn('Vector copy failed, rasterizing page', e);
          }
        }
      }
      if (!drawn) {
        if (!deps.rasterize) throw new Error('This page needs rasterization, which is unavailable here');
        const raster = await deps.rasterize(spec, redacts, erases);
        const isJpg = raster[0] === 0xff && raster[1] === 0xd8;
        const img = isJpg ? await out.embedJpg(raster) : await out.embedPng(raster);
        page.drawImage(img, { x: 0, y: 0, width: W, height: H });
      }
    }

    for (const a of annots) {
      if (a.type === 'redact') continue;
      await drawAnnot(out, page, H, a, fonts, redacts);
    }
    // redaction boxes go on top of everything
    for (const r of redacts) page.drawRectangle({ x: r.x, y: H - r.y - r.h, width: r.w, height: r.h, color: rgb(0, 0, 0) });
  }

  if (deps.title) out.setTitle(deps.title);
  out.setProducer('PageCraft PDF Editor');
  out.setCreator('PageCraft PDF Editor');
  return out.save();
}

async function drawAnnot(doc: PDFDocument, page: PDFPage, H: number, a: Annotation, fonts: FontCache, redacts: Rect[]) {
  const Y = (y: number) => H - y;
  switch (a.type) {
    case 'text': {
      const font = await fonts.get(a);
      const color = hexToRgb(a.color);
      const fs = a.fontSize;
      a.text.split('\n').forEach((line, i) => {
        if (!line) return;
        const top = a.y + i * fs * LINE_HEIGHT;
        const lineBox = { x: a.x, y: top, w: font.widthOfTextAtSize(line, fs), h: fs * LINE_HEIGHT };
        // text under a redaction must not survive in the file
        if (redacts.some((r) => rectsIntersect(r, lineBox))) return;
        page.drawText(line, { x: a.x, y: Y(top + fs * BASELINE[a.fontFamily]), size: fs, font, color });
      });
      break;
    }
    case 'highlight':
      for (const r of a.rects)
        page.drawRectangle({ x: r.x, y: Y(r.y + r.h), width: r.w, height: r.h, color: hexToRgb(a.color), opacity: 0.4, blendMode: BlendMode.Multiply });
      break;
    case 'underline': case 'strikeout':
      for (const r of a.rects) {
        const t = Math.max(0.8, r.h * 0.07);
        const y = a.type === 'underline' ? r.y + r.h - t / 2 : r.y + r.h * 0.55;
        page.drawLine({ start: { x: r.x, y: Y(y) }, end: { x: r.x + r.w, y: Y(y) }, thickness: t, color: hexToRgb(a.color) });
      }
      break;
    case 'whiteout':
      page.drawRectangle({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, color: hexToRgb(a.color) });
      break;
    case 'rect':
      page.drawRectangle({
        x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h,
        borderColor: hexToRgb(a.stroke), borderWidth: a.strokeWidth,
        color: a.fill ? hexToRgb(a.fill) : undefined,
      });
      break;
    case 'ellipse':
      page.drawEllipse({
        x: a.x + a.w / 2, y: Y(a.y + a.h / 2), xScale: a.w / 2, yScale: a.h / 2,
        borderColor: hexToRgb(a.stroke), borderWidth: a.strokeWidth,
        color: a.fill ? hexToRgb(a.fill) : undefined,
      });
      break;
    case 'line': case 'arrow': {
      const color = hexToRgb(a.stroke);
      const opts = { thickness: a.strokeWidth, color, lineCap: LineCapStyle.Round };
      page.drawLine({ start: { x: a.x1, y: Y(a.y1) }, end: { x: a.x2, y: Y(a.y2) }, ...opts });
      if (a.type === 'arrow') {
        for (const [p1, p2] of arrowHead(a.x1, a.y1, a.x2, a.y2, a.strokeWidth))
          page.drawLine({ start: { x: p1.x, y: Y(p1.y) }, end: { x: p2.x, y: Y(p2.y) }, ...opts });
      }
      break;
    }
    case 'ink': {
      const color = hexToRgb(a.stroke);
      for (const path of a.paths) {
        if (!path.length) continue;
        if (path.length === 1) {
          page.drawCircle({ x: path[0].x, y: Y(path[0].y), size: a.strokeWidth / 2, color, opacity: a.opacity });
          continue;
        }
        const d = path.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
        page.drawSvgPath(d, { x: 0, y: H, borderColor: color, borderWidth: a.strokeWidth, borderOpacity: a.opacity, borderLineCap: LineCapStyle.Round });
      }
      break;
    }
    case 'image': {
      const { bytes, kind } = dataUrlToBytes(a.src);
      const img = kind === 'jpg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      page.drawImage(img, { x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h });
      break;
    }
    case 'stamp': {
      const color = hexToRgb(a.color);
      const bw = Math.max(1.5, a.h * 0.06);
      page.drawRectangle({ x: a.x + bw / 2, y: Y(a.y + a.h) + bw / 2, width: a.w - bw, height: a.h - bw, borderColor: color, borderWidth: bw, opacity: 0, borderOpacity: 0.9 });
      const font = await fonts.get({ fontFamily: 'Helvetica', bold: true, italic: false, text: a.label });
      const size = stampFontSize(a.label, a.w, a.h, (s, t) => font.widthOfTextAtSize(t, s));
      const tw = font.widthOfTextAtSize(a.label, size);
      page.drawText(a.label, { x: a.x + (a.w - tw) / 2, y: Y(a.y + a.h / 2) - size * 0.35, size, font, color, opacity: 0.9 });
      break;
    }
  }
}

export function stampFontSize(label: string, w: number, h: number, widthAt: (size: number, text: string) => number) {
  const byH = h * 0.5;
  const byW = ((w - h * 0.4) / Math.max(1, widthAt(1, label)));
  return Math.max(4, Math.min(byH, byW));
}

export function arrowHead(x1: number, y1: number, x2: number, y2: number, sw: number) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.max(8, sw * 4);
  const spread = Math.PI / 7;
  const tip = { x: x2, y: y2 };
  return [ang + Math.PI - spread, ang + Math.PI + spread].map(
    (t) => [tip, { x: x2 + Math.cos(t) * len, y: y2 + Math.sin(t) * len }] as const,
  );
}
