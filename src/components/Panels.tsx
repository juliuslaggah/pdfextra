import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, FilePlus2, FileOutput, RotateCcw, RotateCw, Trash2, X, Plus } from 'lucide-react';
import { useEditor } from '../store/store';
import { useUi, pageCanvases, type FindMatch } from '../store/ui';
import { Thumbnail } from './Thumbnail';
import { mergeFiles, readImageFile, saveDoc } from '../lib/actions';
import { getTextItems } from '../lib/pdfjs';
import { placeImage } from '../lib/place';
import { sampleColors } from '../lib/sampleColor';
import { guessFamily, measureText, BASELINE } from '../lib/textLayout';
import { uid } from '../lib/geometry';
import type { Annotation, TextAnnot } from '../lib/types';

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Organize */

export function OrganizePanel() {
  const pages = useEditor((s) => s.doc.pages);
  const s = useEditor.getState();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const mergeRef = useRef<HTMLInputElement>(null);
  const close = () => s.setPanel('none');
  const ids = [...sel].filter((id) => pages.some((p) => p.id === id));
  const toggle = (id: string) => setSel((old) => { const n = new Set(old); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const extract = () => {
    const d = useEditor.getState().doc;
    const keep = new Set(ids);
    saveDoc({ pages: d.pages.filter((p) => keep.has(p.id)), annots: d.annots.filter((a) => keep.has(a.pageId)) }, 'extract');
  };

  return (
    <Modal title="Organize pages" onClose={close} wide>
      <div className="org-actions">
        <span className="muted">{ids.length ? `${ids.length} selected` : 'Drag pages to reorder. Click to select.'}</span>
        <span className="spacer" />
        <button className="btn ghost sm" disabled={!ids.length} onClick={() => s.rotatePages(ids, -90)}><RotateCcw size={15} /> Rotate left</button>
        <button className="btn ghost sm" disabled={!ids.length} onClick={() => s.rotatePages(ids, 90)}><RotateCw size={15} /> Rotate right</button>
        <button className="btn ghost sm" disabled={!ids.length || ids.length >= pages.length} onClick={() => { s.deletePages(ids); setSel(new Set()); }}><Trash2 size={15} /> Delete</button>
        <button className="btn ghost sm" disabled={!ids.length} onClick={extract}><FileOutput size={15} /> Extract</button>
        <button className="btn ghost sm" onClick={() => mergeRef.current?.click()}><FilePlus2 size={15} /> Add PDF</button>
        <input ref={mergeRef} type="file" accept="application/pdf,.pdf" multiple hidden data-testid="merge-input"
          onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) mergeFiles(f); }} />
      </div>
      <div className="org-grid">
        {pages.map((p, i) => (
          <div
            key={p.id}
            className={`org-page ${sel.has(p.id) ? 'selected' : ''} ${dropAt === i && dragFrom !== null && dragFrom !== i ? (dragFrom < i ? 'drop-after' : 'drop-before') : ''}`}
            draggable
            data-testid={`org-page-${i}`}
            onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { e.preventDefault(); setDropAt(i); }}
            onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) s.movePage(dragFrom, i); setDragFrom(null); setDropAt(null); }}
            onDragEnd={() => { setDragFrom(null); setDropAt(null); }}
            onClick={() => toggle(p.id)}
          >
            <Thumbnail spec={p} width={130} />
            <div className="org-tools" onClick={(e) => e.stopPropagation()}>
              <button className="icon-btn" title="Rotate left" aria-label={`Rotate page ${i + 1} left`} onClick={() => s.rotatePages([p.id], -90)}><RotateCcw size={14} /></button>
              <button className="icon-btn" title="Rotate right" aria-label={`Rotate page ${i + 1} right`} onClick={() => s.rotatePages([p.id], 90)}><RotateCw size={14} /></button>
              <button className="icon-btn" title="Duplicate" aria-label={`Duplicate page ${i + 1}`} onClick={() => s.duplicatePage(p.id)}><Copy size={14} /></button>
              <button className="icon-btn" title="Insert blank page after" aria-label={`Insert blank page after ${i + 1}`} onClick={() => s.insertBlank(i)}><Plus size={14} /></button>
              <button className="icon-btn danger" title="Delete" aria-label={`Delete page ${i + 1}`} disabled={pages.length < 2} onClick={() => s.deletePages([p.id])}><Trash2 size={14} /></button>
            </div>
            <div className="org-num">{i + 1}</div>
          </div>
        ))}
      </div>
      <div className="modal-foot">
        <span className="muted">Changes can be undone with Ctrl+Z.</span>
        <button className="btn primary" onClick={close}>Done</button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Signature */

const SAVED_KEY = 'pagecraft.signatures';
function loadSaved(): string[] {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]'); } catch { return []; }
}
function storeSaved(list: string[]) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 6))); } catch { /* storage unavailable */ }
}

/** Crop transparent borders off a canvas and return a PNG data URL with its size. */
function trimCanvas(c: HTMLCanvasElement): { src: string; w: number; h: number } | null {
  const ctx = c.getContext('2d')!;
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x1 = width, y1 = height, x2 = -1, y2 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 8) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  }
  if (x2 < 0) return null;
  const pad = 6;
  x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad); x2 = Math.min(width - 1, x2 + pad); y2 = Math.min(height - 1, y2 + pad);
  const out = document.createElement('canvas');
  out.width = x2 - x1 + 1; out.height = y2 - y1 + 1;
  out.getContext('2d')!.drawImage(c, x1, y1, out.width, out.height, 0, 0, out.width, out.height);
  return { src: out.toDataURL('image/png'), w: out.width / 2, h: out.height / 2 };
}

export function SignPanel() {
  const s = useEditor.getState();
  const [tab, setTab] = useState<'draw' | 'type' | 'upload'>('draw');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#1e3a8a');
  const [saved, setSaved] = useState(loadSaved);
  const padRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);
  const close = () => s.setPanel('none');

  useEffect(() => {
    if (tab !== 'draw') return;
    const c = padRef.current!;
    c.width = 1000; c.height = 320;
    setEmpty(true);
  }, [tab]);

  const pos = (e: React.PointerEvent) => {
    const r = padRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 1000, y: ((e.clientY - r.top) / r.height) * 320 };
  };

  const place = (img: { src: string; w: number; h: number } | null) => {
    if (!img) { useUi.getState().notify('Signature is empty', 'error'); return; }
    const list = [img.src, ...saved.filter((x) => x !== img.src)];
    storeSaved(list);
    placeImage(img.src, img.w, img.h, 180);
    close();
  };

  const typed = () => {
    if (!name.trim()) return null;
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 300;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.font = 'italic 150px "Segoe Script", "Brush Script MT", "Apple Chancery", "URW Chancery L", cursive';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 20, 150, 1160);
    return trimCanvas(c);
  };

  return (
    <Modal title="Add signature" onClose={close}>
      <div className="tabs" role="tablist">
        {(['draw', 'type', 'upload'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
        <span className="spacer" />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Ink color" />
      </div>
      {tab === 'draw' && (
        <>
          <canvas
            ref={padRef}
            className="sign-pad"
            data-testid="sign-pad"
            onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drawing.current = pos(e); }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const p = pos(e);
              const ctx = padRef.current!.getContext('2d')!;
              ctx.strokeStyle = color; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
              ctx.beginPath(); ctx.moveTo(drawing.current.x, drawing.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
              drawing.current = p;
              setEmpty(false);
            }}
            onPointerUp={() => { drawing.current = null; }}
          />
          <div className="modal-foot">
            <button className="btn ghost" onClick={() => { const c = padRef.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setEmpty(true); }}>Clear</button>
            <button className="btn primary" disabled={empty} onClick={() => place(trimCanvas(padRef.current!))}>Place signature</button>
          </div>
        </>
      )}
      {tab === 'type' && (
        <>
          <input className="sign-type" placeholder="Type your name" value={name} onChange={(e) => setName(e.target.value)} autoFocus style={{ color }} />
          <div className="modal-foot"><span /><button className="btn primary" disabled={!name.trim()} onClick={() => place(typed())}>Place signature</button></div>
        </>
      )}
      {tab === 'upload' && (
        <label className="drop-small">
          Choose an image of your signature (PNG with transparency works best)
          <input type="file" accept="image/*" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try { const img = await readImageFile(f); placeImage(img.src, img.w, img.h, 180); close(); }
            catch (err) { useUi.getState().notify((err as Error).message, 'error'); }
          }} />
        </label>
      )}
      {saved.length > 0 && (
        <div className="saved-sigs">
          <div className="muted">Saved on this device</div>
          <div className="saved-row">
            {saved.map((src) => (
              <div key={src} className="saved-sig">
                <button onClick={() => { const im = new Image(); im.onload = () => { placeImage(src, im.width / 2, im.height / 2, 180); close(); }; im.src = src; }}>
                  <img src={src} alt="Saved signature" />
                </button>
                <button className="icon-btn" aria-label="Remove saved signature" onClick={() => { const l = saved.filter((x) => x !== src); storeSaved(l); setSaved(l); }}><X size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------- Find & Replace */

export async function findAll(query: string, matchCase: boolean): Promise<FindMatch[]> {
  if (!query) return [];
  const { pages } = useEditor.getState().doc;
  const q = matchCase ? query : query.toLowerCase();
  const out: FindMatch[] = [];
  for (let pi = 0; pi < pages.length; pi++) {
    const items = await getTextItems(pages[pi]);
    items.forEach((it, ii) => {
      const s = matchCase ? it.str : it.str.toLowerCase();
      let from = 0, at: number;
      while ((at = s.indexOf(q, from)) >= 0) {
        // approximate the sub-run position by character share
        const cw = it.rect.w / Math.max(1, it.str.length);
        out.push({
          pageId: pages[pi].id, pageIndex: pi, itemIndex: ii,
          rect: { x: it.rect.x + at * cw, y: it.rect.y, w: Math.max(2, q.length * cw), h: it.rect.h },
          context: it.str,
        });
        from = at + Math.max(1, q.length);
      }
    });
  }
  return out;
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function FindPanel() {
  const s = useEditor.getState();
  const matches = useUi((u) => u.matches);
  const active = useUi((u) => u.activeMatch);
  const pages = useEditor((st) => st.doc.pages);
  const [query, setQuery] = useState('');
  const [replace, setReplace] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); return () => useUi.getState().setMatches([]); }, []);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const m = await findAll(query, matchCase);
      if (alive) useUi.getState().setMatches(m);
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [query, matchCase, pages]);

  const go = (i: number) => {
    if (!matches.length) return;
    const n = (i + matches.length) % matches.length;
    useUi.getState().setActiveMatch(n);
    s.scrollTo(matches[n].pageId, matches[n].rect.y);
  };

  /** Replace every match inside the given runs: cover each run and retype it. */
  const doReplace = async (targets: FindMatch[]) => {
    if (!targets.length) return;
    const doc = useEditor.getState().doc;
    const byRun = new Map<string, FindMatch>();
    for (const m of targets) byRun.set(`${m.pageId}:${m.itemIndex}`, m);
    const added: Annotation[] = [];
    const re = new RegExp(escapeRe(query), matchCase ? 'g' : 'gi');
    for (const m of byRun.values()) {
      const spec = doc.pages.find((p) => p.id === m.pageId)!;
      const it = (await getTextItems(spec))[m.itemIndex];
      const pc = pageCanvases.get(spec.id);
      const { bg, fg } = pc ? sampleColors(pc.canvas, it.rect, pc.scale) : { bg: '#ffffff', fg: '#000000' };
      const fam = guessFamily(it.fontFamily, it.fontName);
      const bold = /bold|black|heavy/i.test(it.fontName + it.fontFamily);
      const text = it.str.replace(re, replace);
      const fs = Math.round(it.fontSize * 10) / 10;
      const mt = measureText(text, fs, fam, bold, false);
      const baseline = it.rect.y + it.rect.h - fs * 0.22;
      added.push({ id: uid('an'), pageId: spec.id, type: 'whiteout', color: bg, x: it.rect.x - 0.5, y: it.rect.y - 0.5, w: it.rect.w + 1, h: it.rect.h + 1 });
      if (text.trim()) {
        const t: TextAnnot = { id: uid('an'), pageId: spec.id, type: 'text', text, x: it.rect.x, y: baseline - fs * BASELINE[fam], w: mt.w, h: mt.h, fontSize: fs, fontFamily: fam, bold, italic: false, color: fg };
        added.push(t);
      }
    }
    s.commit((d) => ({ ...d, annots: [...d.annots, ...added] }));
    useUi.getState().notify(`Replaced ${targets.length} match${targets.length > 1 ? 'es' : ''}`);
    // the original text is still in the PDF under the cover; don't match it again
    useUi.getState().setMatches(useUi.getState().matches.filter((m) => !byRun.has(`${m.pageId}:${m.itemIndex}`)));
  };

  const summary = useMemo(() => (query ? (matches.length ? `${active + 1} of ${matches.length}` : 'No matches') : ''), [query, matches.length, active]);

  return (
    <div className="find-panel" role="search">
      <div className="find-row">
        <input ref={inputRef} placeholder="Find text" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="find-input"
          onKeyDown={(e) => { if (e.key === 'Enter') go(active + (e.shiftKey ? -1 : 1)); if (e.key === 'Escape') s.setPanel('none'); }} />
        <span className="muted find-count" data-testid="find-count">{summary}</span>
        <button className="icon-btn" onClick={() => go(active - 1)} disabled={!matches.length} aria-label="Previous match"><ChevronUp size={16} /></button>
        <button className="icon-btn" onClick={() => go(active + 1)} disabled={!matches.length} aria-label="Next match"><ChevronDown size={16} /></button>
        <label className="opt-label"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Aa</label>
        <button className="icon-btn" onClick={() => s.setPanel('none')} aria-label="Close find"><X size={16} /></button>
      </div>
      <div className="find-row">
        <input placeholder="Replace with" value={replace} onChange={(e) => setReplace(e.target.value)} data-testid="replace-input" />
        <button className="btn ghost sm" disabled={active < 0} onClick={() => doReplace([matches[active]])}>Replace</button>
        <button className="btn ghost sm" disabled={!matches.length} onClick={() => doReplace(matches)} data-testid="replace-all">Replace all</button>
      </div>
    </div>
  );
}
