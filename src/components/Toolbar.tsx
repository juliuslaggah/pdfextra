import { useRef, useState } from 'react';
import {
  Bold, Copy, Eraser, EyeOff, FileDown, FolderOpen, Highlighter, ImagePlus, Italic, LayoutGrid, Maximize2, Minus,
  MousePointer2, Pencil, Plus, Redo2, Replace, Shapes, Signature, Square, Stamp, Strikethrough, TextCursor, Trash2,
  Type, Underline, Undo2,
} from 'lucide-react';
import { hasUnsavedEdits, useEditor } from '../store/store';
import { Modal } from './Panels';
import { useUi } from '../store/ui';
import type { Annotation, FontFamily, ShapeKind, Tool } from '../lib/types';
import { openFile, readImageFile, saveDoc } from '../lib/actions';
import { placeImage } from '../lib/place';
import { fitWidthZoom } from './Viewer';
import { measureText } from '../lib/textLayout';
import { translate, uid } from '../lib/geometry';
import { textEditorControl } from './PageView';
import type { TextAnnot } from '../lib/types';

const TOOLS: { id: Tool; label: string; icon: React.ElementType; key?: string }[] = [
  { id: 'select', label: 'Select', icon: MousePointer2, key: 'V' },
  { id: 'editText', label: 'Edit Text', icon: TextCursor, key: 'E' },
  { id: 'text', label: 'Add Text', icon: Type, key: 'T' },
  { id: 'redact', label: 'Redact', icon: EyeOff, key: 'R' },
  { id: 'whiteout', label: 'Whiteout', icon: Square, key: 'W' },
  { id: 'highlight', label: 'Highlight', icon: Highlighter, key: 'H' },
  { id: 'underline', label: 'Underline', icon: Underline, key: 'U' },
  { id: 'strikeout', label: 'Strikeout', icon: Strikethrough, key: 'K' },
  { id: 'stamp', label: 'Stamp', icon: Stamp },
  { id: 'shape', label: 'Shapes', icon: Shapes, key: 'S' },
  { id: 'draw', label: 'Draw', icon: Pencil, key: 'D' },
  { id: 'eraser', label: 'Eraser', icon: Eraser, key: 'X' },
];
export const TOOL_KEYS = Object.fromEntries(TOOLS.filter((t) => t.key).map((t) => [t.key!.toLowerCase(), t.id]));

export function Header() {
  const [confirmHome, setConfirmHome] = useState(false);
  const goHome = () => {
    if (hasUnsavedEdits()) setConfirmHome(true);
    else useEditor.getState().closeDoc();
  };
  const fileName = useEditor((s) => s.fileName);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const zoom = useEditor((s) => s.zoom);
  const { undo, redo, setZoom } = useEditor.getState();
  const busy = useUi((s) => s.busy);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <header className="header">
      <button className="brand" onClick={goHome} title="Home" aria-label="Home" data-testid="home">
        <Logo /> <span>pdf<b>extra</b></span>
      </button>
      {confirmHome && (
        <Modal title="Leave this document?" onClose={() => setConfirmHome(false)}>
          <p className="confirm-text">You have edits you haven't downloaded. If you go home now, they will be lost.</p>
          <div className="modal-foot">
            <button className="btn ghost" onClick={() => setConfirmHome(false)}>Keep editing</button>
            <span className="spacer" />
            <button className="btn ghost" onClick={async () => { setConfirmHome(false); if (await saveDoc()) useEditor.getState().closeDoc(); }}>Download, then leave</button>
            <button className="btn danger" onClick={() => { setConfirmHome(false); useEditor.getState().closeDoc(); }} data-testid="discard">Leave without saving</button>
          </div>
        </Modal>
      )}
      <div className="file-name" title={fileName}>{fileName}</div>
      <div className="header-actions">
        <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={18} /></button>
        <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 size={18} /></button>
        <span className="sep" />
        <button className="icon-btn" onClick={() => setZoom(zoom / 1.2)} title="Zoom out" aria-label="Zoom out"><Minus size={18} /></button>
        <button className="zoom-label" onClick={() => setZoom(1)} title="Reset zoom" data-testid="zoom">{Math.round(zoom * 100)}%</button>
        <button className="icon-btn" onClick={() => setZoom(zoom * 1.2)} title="Zoom in" aria-label="Zoom in"><Plus size={18} /></button>
        <button className="icon-btn hide-sm" onClick={() => setZoom(fitWidthZoom())} title="Fit width" aria-label="Fit width"><Maximize2 size={17} /></button>
        <span className="sep" />
        <button className="btn ghost hide-sm" onClick={() => fileRef.current?.click()}><FolderOpen size={17} /> Open</button>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} />
        <button className="btn primary" onClick={() => saveDoc()} disabled={!!busy} data-testid="save">
          <FileDown size={17} /> <span className="btn-label">{busy === 'Saving PDF…' ? 'Saving…' : 'Download PDF'}</span><span className="btn-label-sm">Save</span>
        </button>
      </div>
    </header>
  );
}

export function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M10 7h8l5 5v12a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" fill="#fff" />
      <path d="M12 19l6-6 2 2-6 6h-2z" fill="var(--accent)" />
    </svg>
  );
}

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const panel = useEditor((s) => s.panel);
  const { setTool, setPanel } = useEditor.getState();
  const imgRef = useRef<HTMLInputElement>(null);
  return (
    <nav className="toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <button key={t.id} className={`tool ${tool === t.id ? 'active' : ''}`} onClick={() => setTool(t.id)}
          title={t.key ? `${t.label} (${t.key})` : t.label} data-tool={t.id} aria-pressed={tool === t.id}>
          <t.icon size={19} />
          <span>{t.label}</span>
        </button>
      ))}
      <span className="tool-sep" />
      <button className="tool" onClick={() => imgRef.current?.click()} data-tool="image" title="Add image">
        <ImagePlus size={19} /><span>Image</span>
      </button>
      <input ref={imgRef} type="file" accept="image/*" hidden data-testid="image-input"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try { const img = await readImageFile(f); placeImage(img.src, img.w, img.h); }
          catch (err) { useUi.getState().notify((err as Error).message, 'error'); }
        }} />
      <button className={`tool ${panel === 'sign' ? 'active' : ''}`} onClick={() => setPanel('sign')} data-tool="sign" title="Sign">
        <Signature size={19} /><span>Sign</span>
      </button>
      <button className={`tool ${panel === 'find' ? 'active' : ''}`} onClick={() => setPanel(panel === 'find' ? 'none' : 'find')} data-tool="find" title="Find & Replace (Ctrl+F)">
        <Replace size={19} /><span>Find</span>
      </button>
      <button className={`tool ${panel === 'organize' ? 'active' : ''}`} onClick={() => setPanel('organize')} data-tool="organize" title="Organize pages">
        <LayoutGrid size={19} /><span>Pages</span>
      </button>
    </nav>
  );
}

const SWATCHES = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ea580c'];
const HIGHLIGHTS = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74'];
export const STAMPS: [string, string][] = [
  ['APPROVED', '#16a34a'], ['REJECTED', '#dc2626'], ['DRAFT', '#2563eb'], ['CONFIDENTIAL', '#dc2626'],
  ['FINAL', '#111827'], ['PAID', '#16a34a'], ['VOID', '#6b7280'], ['RECEIVED', '#9333ea'],
];

function ColorPick({ value, onChange, swatches = SWATCHES, label = 'Color' }: { value: string; onChange: (c: string) => void; swatches?: string[]; label?: string }) {
  return (
    <div className="opt-group" role="group" aria-label={label}>
      {swatches.map((c) => (
        <button key={c} className={`swatch ${value.toLowerCase() === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={`${label} ${c}`} />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Custom ${label.toLowerCase()}`} />
    </div>
  );
}

function FontControls({ family, size, bold, italic, onChange }: {
  family: FontFamily; size: number; bold: boolean; italic: boolean;
  onChange: (p: { fontFamily?: FontFamily; fontSize?: number; bold?: boolean; italic?: boolean }) => void;
}) {
  return (
    <>
      <select value={family} onChange={(e) => onChange({ fontFamily: e.target.value as FontFamily })} aria-label="Font">
        <option value="Helvetica">Sans (Helvetica)</option>
        <option value="Times">Serif (Times)</option>
        <option value="Courier">Mono (Courier)</option>
      </select>
      <input type="number" min={4} max={200} step={1} value={size} aria-label="Font size" className="num"
        onChange={(e) => { const v = parseFloat(e.target.value); if (v >= 4 && v <= 200) onChange({ fontSize: v }); }} />
      <button className={`icon-btn ${bold ? 'on' : ''}`} onClick={() => onChange({ bold: !bold })} aria-label="Bold" aria-pressed={bold}><Bold size={16} /></button>
      <button className={`icon-btn ${italic ? 'on' : ''}`} onClick={() => onChange({ italic: !italic })} aria-label="Italic" aria-pressed={italic}><Italic size={16} /></button>
    </>
  );
}

function Width({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <label className="opt-label">Width
      <input type="range" min={0.5} max={16} step={0.5} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <span className="mono">{value}</span>
    </label>
  );
}

/** Edits the selected annotation, or the current tool's defaults. */
export function OptionsBar() {
  const tool = useEditor((s) => s.tool);
  const opts = useEditor((s) => s.opts);
  const selectedId = useEditor((s) => s.selectedId);
  const sel = useEditor((s) => s.doc.annots.find((a) => a.id === s.selectedId));
  const { setOpts } = useEditor.getState();
  void selectedId;

  const textTool = tool === 'text' || tool === 'editText';
  if (sel && (tool === 'select' || (textTool && sel.type === 'text'))) return <SelectedOptions a={sel} />;

  let body: React.ReactNode;
  switch (tool) {
    case 'text': case 'editText':
      body = (
        <>
          {tool === 'editText' && <span className="hint">Click any line of text on the page to change it.</span>}
          {tool === 'text' && <span className="hint">Click on the page to type.</span>}
          <FontControls family={opts.fontFamily} size={opts.fontSize} bold={opts.bold} italic={opts.italic} onChange={setOpts} />
          {tool === 'text' && <ColorPick value={opts.color} onChange={(color) => setOpts({ color })} />}
        </>
      );
      break;
    case 'highlight':
      body = <><span className="hint">Drag across text to highlight.</span><ColorPick value={opts.highlightColor} swatches={HIGHLIGHTS} onChange={(highlightColor) => setOpts({ highlightColor })} /></>;
      break;
    case 'underline': case 'strikeout':
      body = <span className="hint">Drag across text to {tool === 'underline' ? 'underline' : 'strike out'} it.</span>;
      break;
    case 'redact':
      body = <span className="hint">Drag over content to redact. On download, everything under the box is permanently removed (the page is flattened to an image).</span>;
      break;
    case 'whiteout':
      body = <span className="hint">Drag to cover content with a white box.</span>;
      break;
    case 'shape':
      body = (
        <>
          <div className="opt-group" role="group" aria-label="Shape">
            {(['rect', 'ellipse', 'line', 'arrow'] as ShapeKind[]).map((k) => (
              <button key={k} className={`chip ${opts.shape === k ? 'on' : ''}`} onClick={() => setOpts({ shape: k })}>{k === 'rect' ? 'Rectangle' : k[0].toUpperCase() + k.slice(1)}</button>
            ))}
          </div>
          <ColorPick value={opts.color} onChange={(color) => setOpts({ color })} label="Stroke" />
          <Width value={opts.strokeWidth} onChange={(strokeWidth) => setOpts({ strokeWidth })} />
          {(opts.shape === 'rect' || opts.shape === 'ellipse') && (
            <label className="opt-label"><input type="checkbox" checked={!!opts.fill} onChange={(e) => setOpts({ fill: e.target.checked ? '#e5e7eb' : null })} /> Fill
              {opts.fill && <input type="color" value={opts.fill} onChange={(e) => setOpts({ fill: e.target.value })} aria-label="Fill color" />}
            </label>
          )}
          <span className="hint hide-sm">Hold Shift for squares, circles and straight angles.</span>
        </>
      );
      break;
    case 'draw':
      body = <><ColorPick value={opts.color} onChange={(color) => setOpts({ color })} /><Width value={opts.strokeWidth} onChange={(strokeWidth) => setOpts({ strokeWidth })} /></>;
      break;
    case 'stamp':
      body = (
        <>
          <div className="opt-group" role="group" aria-label="Stamp">
            {STAMPS.map(([l, c]) => (
              <button key={l} className={`chip stamp-chip ${opts.stampLabel === l ? 'on' : ''}`} style={{ color: c, borderColor: c }} onClick={() => setOpts({ stampLabel: l, stampColor: c })}>{l}</button>
            ))}
          </div>
          <input className="stamp-input" value={opts.stampLabel} maxLength={30} onChange={(e) => setOpts({ stampLabel: e.target.value.toUpperCase() })} aria-label="Custom stamp text" />
          <span className="hint">Click on the page to place.</span>
        </>
      );
      break;
    case 'eraser':
      body = (
        <>
          <div className="opt-group" role="group" aria-label="Eraser mode">
            <button className={`chip ${opts.eraserMode === 'content' ? 'on' : ''}`} onClick={() => setOpts({ eraserMode: 'content' })}>Erase page content</button>
            <button className={`chip ${opts.eraserMode === 'annots' ? 'on' : ''}`} onClick={() => setOpts({ eraserMode: 'annots' })}>Remove my edits</button>
          </div>
          {opts.eraserMode === 'content' ? (
            <>
              <label className="opt-label">Size
                <input type="range" min={4} max={60} step={1} value={opts.eraserSize} onChange={(e) => setOpts({ eraserSize: parseFloat(e.target.value) })} aria-label="Eraser size" />
                <span className="mono">{opts.eraserSize}</span>
              </label>
              <CursorPicker />
              <span className="hint hide-sm">Drag over anything to paint it out. Pages you erase on are saved as images, so the erased content is gone for good.</span>
            </>
          ) : <span className="hint">Click or drag over anything you added to remove it.</span>}
        </>
      );
      break;
    default:
      body = <span className="hint">Select an item to move, resize or style it. Double-click text to edit it.</span>;
  }
  return <div className="options-bar">{body}</div>;
}

function SelectedOptions({ a }: { a: Annotation }) {
  const { updateAnnot, deleteAnnot, addAnnot, select } = useEditor.getState();
  const editing = useEditor((s) => s.editingId === a.id);
  const tool = useEditor((s) => s.tool);
  const up = (p: Partial<Annotation>) => {
    // while typing, the whole edit is one undo step, recorded when it ends
    updateAnnot(a.id, p, !editing);
    if (a.type === 'text' && tool === 'text') {
      // the next text box starts with the same style
      const { fontFamily, fontSize, bold, italic, color } = p as Partial<TextAnnot>;
      const o = Object.fromEntries(Object.entries({ fontFamily, fontSize, bold, italic, color }).filter(([, v]) => v !== undefined));
      if (Object.keys(o).length) useEditor.getState().setOpts(o);
    }
    if (editing) setTimeout(() => textEditorControl.focus?.(), 0);
  };
  const dup = () => {
    const copy = { ...translate(a, 12, 12), id: uid('an') };
    addAnnot(copy);
    select(copy.id);
  };
  let body: React.ReactNode = null;
  switch (a.type) {
    case 'text':
      body = (
        <>
          <FontControls family={a.fontFamily} size={a.fontSize} bold={a.bold} italic={a.italic}
            onChange={(p) => {
              const n = { ...a, ...p };
              const m = measureText(n.text, n.fontSize, n.fontFamily, n.bold, n.italic);
              up({ ...p, w: m.w, h: m.h } as Partial<Annotation>);
            }} />
          <ColorPick value={a.color} onChange={(color) => up({ color })} />
          {!editing && <button className="btn ghost sm" onClick={() => useEditor.getState().setEditing(a.id)}>Edit text</button>}
        </>
      );
      break;
    case 'highlight':
      body = <ColorPick value={a.color} swatches={HIGHLIGHTS} onChange={(color) => up({ color })} />;
      break;
    case 'underline': case 'strikeout': case 'stamp':
      body = <ColorPick value={a.color} onChange={(color) => up({ color })} />;
      break;
    case 'whiteout':
      body = <label className="opt-label">Cover color <input type="color" value={a.color} onChange={(e) => up({ color: e.target.value })} /></label>;
      break;
    case 'rect': case 'ellipse':
      body = (
        <>
          <ColorPick value={a.stroke} onChange={(stroke) => up({ stroke })} label="Stroke" />
          <Width value={a.strokeWidth} onChange={(strokeWidth) => up({ strokeWidth })} />
          <label className="opt-label"><input type="checkbox" checked={!!a.fill} onChange={(e) => up({ fill: e.target.checked ? '#e5e7eb' : null })} /> Fill
            {a.fill && <input type="color" value={a.fill} onChange={(e) => up({ fill: e.target.value })} aria-label="Fill color" />}
          </label>
        </>
      );
      break;
    case 'line': case 'arrow': case 'ink':
      body = <><ColorPick value={a.stroke} onChange={(stroke) => up({ stroke })} /><Width value={a.strokeWidth} onChange={(strokeWidth) => up({ strokeWidth })} /></>;
      break;
    case 'redact':
      body = <span className="hint">Redaction area: content underneath is removed when you download.</span>;
      break;
  }
  return (
    <div className="options-bar selected" data-testid="selected-options"
      // buttons here must not steal focus from the text being typed
      onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }}>
      <span className="sel-kind">{a.type === 'ink' ? 'drawing' : a.type}</span>
      {body}
      <span className="spacer" />
      <button className="icon-btn" onClick={dup} title="Duplicate (Ctrl+D)" aria-label="Duplicate"><Copy size={16} /></button>
      <button className="icon-btn danger" onClick={() => deleteAnnot(a.id)} title="Delete (Del)" aria-label="Delete"><Trash2 size={16} /></button>
    </div>
  );
}

const CURSORS: { id: 'circle' | 'square' | 'plus' | 'pencil'; label: string; icon: React.ReactNode }[] = [
  { id: 'circle', label: 'Circle', icon: <circle cx="10" cy="10" r="6.5" /> },
  { id: 'square', label: 'Square', icon: <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" /> },
  { id: 'plus', label: 'Plus', icon: <path d="M10 3v14M3 10h14" /> },
  { id: 'pencil', label: 'Pencil', icon: <path d="M3 17l1.2-4L13.5 3.7a1.7 1.7 0 0 1 2.4 0l.4.4a1.7 1.7 0 0 1 0 2.4L7 15.8z" /> },
];

function CursorPicker() {
  const cur = useEditor((s) => s.opts.eraserCursor);
  return (
    <div className="seg" role="radiogroup" aria-label="Eraser cursor">
      <span className="seg-label">Cursor</span>
      {CURSORS.map((c) => (
        <button key={c.id} role="radio" aria-checked={cur === c.id} aria-label={`${c.label} cursor`} title={c.label}
          className={`seg-btn ${cur === c.id ? 'on' : ''}`} onClick={() => useEditor.getState().setOpts({ eraserCursor: c.id })}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{c.icon}</svg>
        </button>
      ))}
    </div>
  );
}
