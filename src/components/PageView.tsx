import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { commitFrom, pendingText, useEditor } from '../store/store';
import { pageCanvases, useUi } from '../store/ui';
import { getTextItems, renderPageToCanvas, type TextItem } from '../lib/pdfjs';
import { getBounds, hitTest, normRect, pageSize, pointInRect, resizeTo, translate, uid } from '../lib/geometry';
import type { Annotation, PageSpec, Point, Rect, TextAnnot } from '../lib/types';
import { BASELINE, guessFamily, measureText, LINE_HEIGHT, cssFont } from '../lib/textLayout';
import { sampleColors } from '../lib/sampleColor';
import { AnnotationView, VectorLayer, isVector } from './AnnotationView';
import { HANDLES, resizeBounds, snapToText, type Handle } from '../lib/interaction';

const RECT_TOOLS = new Set(['redact', 'whiteout', 'highlight', 'underline', 'strikeout', 'shape']);
const TEXT_ITEM_TOOLS = new Set(['editText', 'highlight', 'underline', 'strikeout']);

type Drag =
  // editOnClick: a click without dragging opens the text for typing
  // live: moving the text being typed (recorded when typing ends)
  | { kind: 'move'; id: string; start: Point; orig: Annotation; moved: boolean; editOnClick?: boolean; live?: boolean }
  | { kind: 'resize'; id: string; handle: Handle; start: Point; orig: Annotation; ob: Rect }
  | { kind: 'lineEnd'; id: string; end: 1 | 2 }
  | { kind: 'create'; start: Point; cur: Point }
  | { kind: 'ink'; points: Point[]; color?: string; width?: number; erase?: boolean }
  | { kind: 'erase'; erased: boolean };

export function PageView({ spec, index }: { spec: PageSpec; index: number }) {
  const z = useEditor((s) => s.zoom);
  const { w, h } = pageSize(spec);
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(index < 2);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const el = ref.current!;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Render the page bitmap; debounced so zooming stays smooth.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let cancelTask = () => {};
    const timer = setTimeout(async () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = z * dpr;
      const off = document.createElement('canvas');
      try {
        const t = await renderPageToCanvas(spec, scale, off);
        cancelTask = t.cancel;
        await t.promise;
        if (cancelled || !canvasRef.current) return;
        const c = canvasRef.current;
        c.width = off.width; c.height = off.height;
        c.getContext('2d')!.drawImage(off, 0, 0);
        pageCanvases.set(spec.id, { canvas: c, scale });
        setRendered(true);
      } catch (e) {
        if ((e as Error)?.name !== 'RenderingCancelledException') console.error(e);
      }
    }, rendered ? 120 : 0);
    return () => { cancelled = true; clearTimeout(timer); cancelTask(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, z, spec.srcId, spec.srcIndex, spec.rotation, spec.baseRotation]);

  useEffect(() => () => { pageCanvases.delete(spec.id); }, [spec.id]);

  return (
    <div ref={ref} className="page" data-page-id={spec.id} data-page-index={index} style={{ width: w * z, height: h * z }}>
      <canvas ref={canvasRef} className="page-canvas" style={{ width: w * z, height: h * z }} />
      {!rendered && visible && <div className="page-loading" />}
      <PageOverlay spec={spec} z={z} w={w} h={h} />
      <div className="page-number">{index + 1}</div>
    </div>
  );
}

function PageOverlay({ spec, z, w, h }: { spec: PageSpec; z: number; w: number; h: number }) {
  const annotsAll = useEditor((s) => s.doc.annots);
  const annots = useMemo(() => annotsAll.filter((a) => a.pageId === spec.id), [annotsAll, spec.id]);
  const tool = useEditor((s) => s.tool);
  const selectedId = useEditor((s) => s.selectedId);
  const editingId = useEditor((s) => s.editingId);
  const matches = useUi((s) => s.matches);
  const activeMatch = useUi((s) => s.activeMatch);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [items, setItems] = useState<TextItem[]>([]);
  const [hoverItem, setHoverItem] = useState<number>(-1);
  const [eraserPos, setEraserPos] = useState<Point | null>(null);
  const [overText, setOverText] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!TEXT_ITEM_TOOLS.has(tool)) return;
    let alive = true;
    getTextItems(spec).then((it) => alive && setItems(it)).catch(() => {});
    return () => { alive = false; };
  }, [tool, spec]);

  const setD = (d: Drag | null) => { dragRef.current = d; setDrag(d); };
  const toPt = (e: React.PointerEvent | PointerEvent): Point => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: Math.min(w, Math.max(0, (e.clientX - r.left) / z)), y: Math.min(h, Math.max(0, (e.clientY - r.top) / z)) };
  };
  /** The item under the pointer. The selected item wins when it is hit, and
   *  eraser strokes (invisible paper-coloured paint) are skipped unless asked for. */
  const topHit = (p: Point, includeErase = false) => {
    const sel = annots.find((a) => a.id === selectedId);
    if (sel && (includeErase || !(sel.type === 'ink' && sel.erase)) && hitTest(sel, p, 4 / z)) return sel;
    for (let i = annots.length - 1; i >= 0; i--) {
      const a = annots[i];
      if (!includeErase && a.type === 'ink' && a.erase) continue;
      if (hitTest(a, p, 4 / z)) return a;
    }
    return null;
  };
  /** An added item the current tool should pick up and move instead of creating something new. */
  const grabTarget = (p: Point) => {
    if (tool === 'draw' || tool === 'eraser') return null;
    const a = topHit(p);
    if (!a) return null;
    if (a.id === selectedId || tool === 'select') return a;
    // dragging across text with these tools marks it, so only the selected item moves
    if (tool === 'highlight' || tool === 'underline' || tool === 'strikeout') return null;
    // the patch behind edited text stays put
    if ((tool === 'text' || tool === 'editText') && a.type === 'whiteout') return null;
    return a;
  };
  const st = useEditor.getState;

  function startText(p: Point, text = '', o?: Partial<TextAnnot>, cover?: Annotation) {
    const { opts } = st();
    const base = st().doc;
    const fontSize = o?.fontSize ?? opts.fontSize;
    const fam = o?.fontFamily ?? opts.fontFamily;
    const bold = o?.bold ?? opts.bold, italic = o?.italic ?? opts.italic;
    const m = measureText(text || ' ', fontSize, fam, bold, italic);
    const t: TextAnnot = {
      id: uid('an'), pageId: spec.id, type: 'text', x: p.x, y: p.y, w: Math.max(m.w, 20), h: m.h,
      text, fontSize, fontFamily: fam, bold, italic, color: o?.color ?? opts.color,
    };
    pendingText.set(t.id, { base, coverId: cover?.id, original: cover ? text : undefined });
    st().mutate((d) => ({ ...d, annots: [...d.annots, ...(cover ? [cover] : []), t] }));
    st().setEditing(t.id);
  }

  function editExistingText(item: TextItem) {
    const pc = pageCanvases.get(spec.id);
    const { bg, fg } = pc ? sampleColors(pc.canvas, item.rect, pc.scale) : { bg: '#ffffff', fg: '#000000' };
    const pad = 0.5;
    const cover: Annotation = {
      id: uid('an'), pageId: spec.id, type: 'whiteout', color: bg,
      x: item.rect.x - pad, y: item.rect.y - pad, w: item.rect.w + pad * 2, h: item.rect.h + pad * 2,
    };
    const fs = Math.round(item.fontSize * 10) / 10;
    const family = guessFamily(item.fontFamily, item.fontName);
    const bold = /bold|black|heavy|semibold/i.test(item.fontName + item.fontFamily);
    const italic = /italic|oblique/i.test(item.fontName + item.fontFamily);
    // align the new text's baseline with the original's
    const baselineY = item.rect.y + item.rect.h - fs * 0.22;
    const y = baselineY - fs * BASELINE[family];
    startText({ x: item.rect.x, y }, item.str, { fontSize: fs, fontFamily: family, bold, italic, color: fg }, cover);
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('textarea')) return;
    const p = toPt(e);
    const { opts } = st();
    // dragging the move grip of the text being typed keeps it open
    if (target.dataset.handle === 'grip' && st().editingId) {
      const a = annots.find((x) => x.id === st().editingId);
      if (a) {
        overlayRef.current!.setPointerCapture(e.pointerId);
        setD({ kind: 'move', id: a.id, start: p, orig: a, moved: false, live: true });
        return;
      }
    }
    // finish any text editing first; the editor's blur handler commits it
    if (st().editingId) {
      if (textEditorControl.finish) textEditorControl.finish();
      else (document.activeElement as HTMLElement | null)?.blur();
      if (tool === 'text' || tool === 'editText') return;
    }
    overlayRef.current!.setPointerCapture(e.pointerId);
    const handle = target.dataset.handle as Handle | 'p1' | 'p2' | undefined;
    if (handle && selectedId) {
      const a = annots.find((x) => x.id === selectedId);
      if (a) {
        st().checkpoint();
        if (handle === 'p1' || handle === 'p2') setD({ kind: 'lineEnd', id: a.id, end: handle === 'p1' ? 1 : 2 });
        else setD({ kind: 'resize', id: a.id, handle, start: p, orig: a, ob: getBounds(a) });
        return;
      }
    }
    // any tool except Draw and Eraser picks up an item it is pressed on
    if (tool !== 'select') {
      const g = grabTarget(p);
      if (g) {
        st().select(g.id);
        setD({ kind: 'move', id: g.id, start: p, orig: g, moved: false, editOnClick: g.type === 'text' && (tool === 'text' || tool === 'editText') });
        return;
      }
    }
    switch (tool) {
      case 'select': {
        const a = topHit(p);
        st().select(a?.id ?? null);
        if (a) setD({ kind: 'move', id: a.id, start: p, orig: a, moved: false });
        return;
      }
      case 'text': {
        startText({ x: p.x, y: p.y - st().opts.fontSize * 0.6 });
        return;
      }
      case 'editText': {
        const item = items.find((it) => pointInRect(p, it.rect, 1));
        if (item) editExistingText(item);
        else useUi.getState().notify('No editable text here. Use Add Text to place new text.');
        return;
      }
      case 'stamp': {
        const label = opts.stampLabel || 'STAMP';
        const sh = 40, sw = Math.max(80, label.length * 15 + 30);
        st().addAnnot({ id: uid('an'), pageId: spec.id, type: 'stamp', label, color: opts.stampColor, x: p.x - sw / 2, y: p.y - sh / 2, w: sw, h: sh });
        return;
      }
      case 'draw':
        setD({ kind: 'ink', points: [p] });
        return;
      case 'eraser':
        if (opts.eraserMode === 'content') {
          // paint over the page in its own background colour
          const pc = pageCanvases.get(spec.id);
          const r = opts.eraserSize * 1.5;
          const color = pc ? sampleColors(pc.canvas, { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 }, pc.scale).bg : '#ffffff';
          setD({ kind: 'ink', points: [p], color, width: opts.eraserSize, erase: true });
          return;
        }
        st().checkpoint();
        setD({ kind: 'erase', erased: false });
        erase(p);
        return;
      default:
        if (RECT_TOOLS.has(tool)) setD({ kind: 'create', start: p, cur: p });
    }
  };

  function erase(p: Point) {
    const hit = topHit(p, true);
    if (hit) {
      st().mutate((d) => ({ ...d, annots: d.annots.filter((x) => x.id !== hit.id) }));
      if (dragRef.current?.kind === 'erase') dragRef.current.erased = true;
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toPt(e);
    if (tool === 'eraser') setEraserPos(p);
    if (!dragRef.current) {
      const over = !!grabTarget(p);
      if (over !== overText) setOverText(over);
    }
    if (tool === 'editText' && !dragRef.current) {
      const i = items.findIndex((it) => pointInRect(p, it.rect, 1));
      if (i !== hoverItem) setHoverItem(i);
    }
    const d = dragRef.current;
    if (!d) return;
    switch (d.kind) {
      case 'move': {
        const dx = p.x - d.start.x, dy = p.y - d.start.y;
        if (!d.moved && Math.hypot(dx, dy) * z < 3) return;
        if (!d.moved) { if (!d.live) st().checkpoint(); d.moved = true; }
        const moved = translate(d.orig, dx, dy);
        st().mutate((doc) => ({ ...doc, annots: doc.annots.map((a) => (a.id === d.id ? moved : a)) }));
        return;
      }
      case 'resize': {
        const nb = resizeBounds(d.ob, d.handle, p.x - d.start.x, p.y - d.start.y, d.orig.type === 'image' && d.handle.length === 2);
        let next = resizeTo(d.orig, nb);
        if (next.type === 'text') {
          const m = measureText(next.text, next.fontSize, next.fontFamily, next.bold, next.italic);
          next = { ...next, w: m.w, h: m.h };
        }
        st().mutate((doc) => ({ ...doc, annots: doc.annots.map((a) => (a.id === d.id ? next : a)) }));
        return;
      }
      case 'lineEnd':
        st().mutate((doc) => ({
          ...doc,
          annots: doc.annots.map((a) => (a.id === d.id ? ({ ...a, ...(d.end === 1 ? { x1: p.x, y1: p.y } : { x2: p.x, y2: p.y }) } as Annotation) : a)),
        }));
        return;
      case 'create':
        setD({ ...d, cur: e.shiftKey && tool === 'shape' ? constrain(d.start, p, st().opts.shape) : p });
        return;
      case 'ink': {
        const last = d.points[d.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * z < 1.5) return;
        setD({ ...d, points: [...d.points, p] });
        return;
      }
      case 'erase':
        erase(p);
        return;
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    setD(null);
    if (!d) return;
    const { opts } = st();
    if (d.kind === 'move' && d.editOnClick && !d.moved) { st().setEditing(d.id); return; }
    if (d.kind === 'move' && d.live) { textEditorControl.focus?.(); return; }
    if (d.kind === 'ink') {
      st().addAnnot({ id: uid('an'), pageId: spec.id, type: 'ink', paths: [d.points], stroke: d.color ?? opts.color, strokeWidth: d.width ?? opts.strokeWidth, opacity: 1, ...(d.erase ? { erase: true } : {}) }, false);
    } else if (d.kind === 'erase' && !d.erased) {
      // nothing erased: drop the checkpoint we pushed
      const s = st();
      if (s.past[s.past.length - 1] === s.doc) useEditor.setState({ past: s.past.slice(0, -1) });
    } else if (d.kind === 'create') {
      createFromDrag(d.start, d.cur);
    }
  };

  function createFromDrag(a: Point, b: Point) {
    const { opts } = st();
    const r = normRect(a, b);
    const id = uid('an');
    if (tool === 'highlight' || tool === 'underline' || tool === 'strikeout') {
      let rects = snapToText(items, r.w < 2 && r.h < 2 ? { ...r, x: r.x - 1, y: r.y - 1, w: 2, h: 2 } : r);
      if (!rects.length) {
        if (r.w < 3 || r.h < 3) return;
        rects = [r];
      }
      const color = tool === 'highlight' ? opts.highlightColor : tool === 'underline' ? '#2563eb' : '#dc2626';
      st().addAnnot({ id, pageId: spec.id, type: tool, rects, color }, false);
      return;
    }
    if (tool === 'shape' && (opts.shape === 'line' || opts.shape === 'arrow')) {
      if (Math.hypot(b.x - a.x, b.y - a.y) < 3) return;
      st().addAnnot({ id, pageId: spec.id, type: opts.shape, x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: opts.color, strokeWidth: opts.strokeWidth });
      return;
    }
    if (r.w < 3 || r.h < 3) return;
    if (tool === 'redact') st().addAnnot({ id, pageId: spec.id, type: 'redact', color: '#000000', ...r }, false);
    else if (tool === 'whiteout') st().addAnnot({ id, pageId: spec.id, type: 'whiteout', color: '#ffffff', ...r }, false);
    else if (tool === 'shape') {
      const kind = opts.shape === 'ellipse' ? 'ellipse' : 'rect';
      st().addAnnot({ id, pageId: spec.id, type: kind, ...r, stroke: opts.color, strokeWidth: opts.strokeWidth, fill: opts.fill });
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool !== 'select') return;
    const r = overlayRef.current!.getBoundingClientRect();
    const a = topHit({ x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z });
    if (a?.type === 'text') st().setEditing(a.id);
  };

  const selected = annots.find((a) => a.id === selectedId);
  const pageMatches = matches.map((m, i) => ({ m, i })).filter(({ m }) => m.pageId === spec.id);

  let preview: React.ReactNode = null;
  if (drag?.kind === 'create') {
    const r = normRect(drag.start, drag.cur);
    const opts = st().opts;
    if (tool === 'shape' && (opts.shape === 'line' || opts.shape === 'arrow')) {
      preview = <VectorLayer z={z} w={w} h={h} annots={[{ id: 'pv', pageId: spec.id, type: opts.shape, x1: drag.start.x, y1: drag.start.y, x2: drag.cur.x, y2: drag.cur.y, stroke: opts.color, strokeWidth: opts.strokeWidth }]} />;
    } else if (tool === 'shape') {
      preview = <VectorLayer z={z} w={w} h={h} annots={[{ id: 'pv', pageId: spec.id, type: opts.shape === 'ellipse' ? 'ellipse' : 'rect', ...r, stroke: opts.color, strokeWidth: opts.strokeWidth, fill: opts.fill }]} />;
    } else if (TEXT_ITEM_TOOLS.has(tool)) {
      const snapped = snapToText(items, r);
      preview = (
        <>
          <div className="drag-box" style={{ left: r.x * z, top: r.y * z, width: r.w * z, height: r.h * z }} />
          {snapped.map((s, i) => <div key={i} className="snap-box" style={{ left: s.x * z, top: s.y * z, width: s.w * z, height: s.h * z }} />)}
        </>
      );
    } else {
      preview = <div className={`drag-box ${tool}`} style={{ left: r.x * z, top: r.y * z, width: r.w * z, height: r.h * z }} />;
    }
  } else if (drag?.kind === 'ink') {
    const o = st().opts;
    preview = <VectorLayer z={z} w={w} h={h} annots={[{ id: 'pv', pageId: spec.id, type: 'ink', paths: [drag.points], stroke: drag.color ?? o.color, strokeWidth: drag.width ?? o.strokeWidth, opacity: 1 }]} />;
  }

  return (
    <div
      ref={overlayRef}
      className={`overlay tool-${tool} ${overText ? 'over-text' : ''}`}
      data-testid={`overlay-${spec.id}`}
      onPointerDown={onPointerDown}
      // keep focus in the text editor; we blur it explicitly when needed
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('textarea')) e.preventDefault(); }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => { setEraserPos(null); setHoverItem(-1); }}
      onDoubleClick={onDoubleClick}
    >
      {annots.map((a) =>
        isVector(a)
          ? <VectorLayer key={a.id} annots={[a]} z={z} w={w} h={h} />
          : <AnnotationView key={a.id} a={a} z={z} hidden={a.id === editingId} />)}
      {pageMatches.map(({ m, i }) => (
        <div key={i} className={`find-match ${i === activeMatch ? 'active' : ''}`} style={{ left: m.rect.x * z, top: m.rect.y * z, width: m.rect.w * z, height: m.rect.h * z }} />
      ))}
      {tool === 'editText' && items.map((it, i) => (
        <div key={i} className={`text-item ${i === hoverItem ? 'hover' : ''}`} style={{ left: it.rect.x * z, top: it.rect.y * z, width: it.rect.w * z, height: it.rect.h * z }} />
      ))}
      {preview}
      {selected && selected.id !== editingId && tool !== 'draw' && tool !== 'eraser' && <SelectionBox a={selected} z={z} />}
      {editingId && annots.some((a) => a.id === editingId) && (
        <>
          <TextEditor a={annots.find((a) => a.id === editingId) as TextAnnot} z={z} />
          {(() => {
            const a = annots.find((x) => x.id === editingId)!;
            const b = getBounds(a);
            return (
              <div className="text-grip" data-handle="grip" data-testid="text-grip" title="Drag to move"
                // left of the text, or above it when the text is at the page edge
                style={b.x * z >= 28
                  ? { left: b.x * z - 26, top: b.y * z + Math.max(0, (b.h * z - 22) / 2) }
                  : { left: b.x * z, top: Math.max(0, b.y * z - 26) }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
                  <path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3" />
                </svg>
              </div>
            );
          })()}
        </>
      )}
      {tool === 'eraser' && eraserPos && (
        <EraserCursor x={eraserPos.x * z} y={eraserPos.y * z}
          size={st().opts.eraserMode === 'content' ? st().opts.eraserSize * z : 16} shape={st().opts.eraserCursor} />
      )}
    </div>
  );
}

function constrain(a: Point, b: Point, shape: string): Point {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (shape === 'line' || shape === 'arrow') {
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
  }
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + Math.sign(dx || 1) * s, y: a.y + Math.sign(dy || 1) * s };
}

function SelectionBox({ a, z }: { a: Annotation; z: number }) {
  if (a.type === 'line' || a.type === 'arrow') {
    return (
      <>
        <div className="handle round" data-handle="p1" style={{ left: a.x1 * z - 5, top: a.y1 * z - 5 }} />
        <div className="handle round" data-handle="p2" style={{ left: a.x2 * z - 5, top: a.y2 * z - 5 }} />
      </>
    );
  }
  const b = getBounds(a);
  const resizable = !(a.type === 'highlight' || a.type === 'underline' || a.type === 'strikeout');
  const handles = a.type === 'text' ? (['nw', 'ne', 'se', 'sw'] as Handle[]) : HANDLES;
  const pos: Record<Handle, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
  return (
    <div className="selection" style={{ left: b.x * z - 3, top: b.y * z - 3, width: b.w * z + 6, height: b.h * z + 6 }}>
      {resizable && handles.map((hd) => (
        <div key={hd} className={`handle h-${hd}`} data-handle={hd}
          style={{ left: `calc(${pos[hd][0] * 100}% - 5px)`, top: `calc(${pos[hd][1] * 100}% - 5px)` }} />
      ))}
    </div>
  );
}

/** Lets other parts of the UI end or resume the active text edit. */
export const textEditorControl: { finish: (() => void) | null; focus: (() => void) | null } = { finish: null, focus: null };

function TextEditor({ a, z }: { a: TextAnnot; z: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const baseRef = useRef(pendingText.get(a.id)?.base ?? useEditor.getState().doc);
  const doneRef = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    if (pendingText.get(a.id)?.original) el.select();
  }, [a.id]);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const s = useEditor.getState();
    const cur = s.doc.annots.find((x) => x.id === a.id) as TextAnnot | undefined;
    const pend = pendingText.get(a.id);
    pendingText.delete(a.id);
    s.setEditing(null);
    if (!cur) return;
    const base = baseRef.current;
    if (pend?.original !== undefined && cur.text === pend.original) {
      // edit-text session with no change: restore the page as it was
      s.mutate((d) => ({ ...d, annots: d.annots.filter((x) => x.id !== a.id && x.id !== pend.coverId) }));
      s.select(null);
      return;
    }
    if (!cur.text.trim()) {
      s.mutate((d) => ({ ...d, annots: d.annots.filter((x) => x.id !== a.id) }));
      s.select(null);
    } else {
      s.select(a.id);
    }
    commitFrom(base);
  };

  useEffect(() => {
    textEditorControl.finish = finish;
    textEditorControl.focus = () => ref.current?.focus();
    return () => {
      textEditorControl.finish = null;
      textEditorControl.focus = null;
      finish();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    const m = measureText(text || ' ', a.fontSize, a.fontFamily, a.bold, a.italic);
    useEditor.getState().updateAnnot(a.id, { text, w: Math.max(m.w, 20), h: m.h } as Partial<TextAnnot>, false);
  };

  return (
    <textarea
      ref={ref}
      className="text-editor"
      data-testid="text-editor"
      value={a.text}
      spellCheck
      onChange={onChange}
      onBlur={(e) => {
        // picking a font, size or colour in the options bar keeps the edit open
        const to = e.relatedTarget as HTMLElement | null;
        if (to?.closest('.options-bar')) return;
        finish();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') ref.current?.blur();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        left: a.x * z, top: a.y * z, width: Math.max(a.w, 20) * z + 12, height: a.h * z + 2,
        font: cssFont(a.fontSize * z, a.fontFamily, a.bold, a.italic, a.text), lineHeight: LINE_HEIGHT, color: a.color,
      }}
    />
  );
}

/** Pointer shown while erasing. Circle and square outline the brush; plus and
 *  pencil mark the exact point (the plus sign's arms scale with brush size). */
function EraserCursor({ x, y, size, shape }: { x: number; y: number; size: number; shape: 'circle' | 'square' | 'plus' | 'pencil' }) {
  const box = { left: x - size / 2, top: y - size / 2, width: size, height: size };
  if (shape === 'circle' || shape === 'square') {
    return <div className={`eraser-cursor ${shape}`} data-testid="eraser-cursor" data-shape={shape} style={box} />;
  }
  const arm = Math.max(10, size / 2 + 4);
  return (
    <>
      {shape === 'plus' ? (
        <svg className="eraser-mark" data-testid="eraser-cursor" data-shape="plus" width={arm * 2} height={arm * 2}
          style={{ left: x - arm, top: y - arm }} viewBox={`0 0 ${arm * 2} ${arm * 2}`}>
          <path d={`M${arm} 0V${arm * 2}M0 ${arm}H${arm * 2}`} className="mark-halo" />
          <path d={`M${arm} 0V${arm * 2}M0 ${arm}H${arm * 2}`} className="mark-line" />
        </svg>
      ) : (
        <svg className="eraser-mark" data-testid="eraser-cursor" data-shape="pencil" width="26" height="26"
          style={{ left: x, top: y - 26 }} viewBox="0 0 26 26">
          {/* pencil tip sits exactly on the pointer (bottom-left corner) */}
          <path d="M1 25l2-7L18 3a2.8 2.8 0 0 1 4 0l1 1a2.8 2.8 0 0 1 0 4L8 23z" className="pencil-body" />
          <path d="M1 25l2-7 5 5z" className="pencil-tip" />
          <path d="M16 5l5 5" className="pencil-band" />
        </svg>
      )}
    </>
  );
}
