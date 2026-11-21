import { useEditor } from '../store/store';
import { pageSize, uid } from './geometry';

/** Place an image (or signature) centred on the current page, scaled to fit. */
export function placeImage(src: string, natW: number, natH: number, maxW?: number) {
  const s = useEditor.getState();
  const page = s.doc.pages[s.currentPage] ?? s.doc.pages[0];
  if (!page) return;
  const { w: pw, h: ph } = pageSize(page);
  const limitW = maxW ?? pw * 0.5;
  const scale = Math.min(1, limitW / natW, (ph * 0.5) / natH);
  const w = natW * scale, h = natH * scale;
  const id = uid('an');
  s.addAnnot({ id, pageId: page.id, type: 'image', src, x: (pw - w) / 2, y: (ph - h) / 2, w, h });
  s.setTool('select');
  s.select(id);
}
