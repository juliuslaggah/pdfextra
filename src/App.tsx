import { useEffect, useRef, useState } from 'react';
import { FileUp, Lock, Sparkles, Zap } from 'lucide-react';
import { useEditor } from './store/store';
import { useUi } from './store/ui';
import { Header, Logo, OptionsBar, TOOL_KEYS, Toolbar } from './components/Toolbar';
import { Viewer } from './components/Viewer';
import { Sidebar } from './components/Sidebar';
import { FindPanel, OrganizePanel, SignPanel } from './components/Panels';
import { mergeFiles, openFile, openSample, readImageFile, saveDoc } from './lib/actions';
import { placeImage } from './lib/place';
import { translate, uid } from './lib/geometry';
import type { Tool } from './lib/types';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      const s = useEditor.getState();
      if (!s.doc.pages.length) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && k === 's') { e.preventDefault(); saveDoc(); return; }
      if (mod && k === 'f') { e.preventDefault(); s.setPanel('find'); return; }
      const sel = s.doc.annots.find((a) => a.id === s.selectedId);
      if (mod && k === 'd' && sel) {
        e.preventDefault();
        const copy = { ...translate(sel, 12, 12), id: uid('an') };
        s.addAnnot(copy);
        return;
      }
      if (mod) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); s.deleteAnnot(sel.id); return; }
      if (e.key === 'Escape') { s.select(null); if (s.tool !== 'select') s.setTool('select'); return; }
      if (e.key === 'Enter' && sel?.type === 'text') { e.preventDefault(); s.setEditing(sel.id); return; }
      if (sel && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        s.commit((d) => ({ ...d, annots: d.annots.map((a) => (a.id === sel.id ? translate(a, dx, dy) : a)) }));
        return;
      }
      if (k === '+' || k === '=') { s.setZoom(s.zoom * 1.2); return; }
      if (k === '-') { s.setZoom(s.zoom / 1.2); return; }
      const tool = TOOL_KEYS[k] as Tool | undefined;
      if (tool) s.setTool(tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Paste images from the clipboard straight onto the page. */
function usePaste() {
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.closest?.('input, textarea')) return;
      if (!useEditor.getState().doc.pages.length) return;
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (!f) return;
      e.preventDefault();
      try { const img = await readImageFile(f); placeImage(img.src, img.w, img.h); } catch (err) { useUi.getState().notify((err as Error).message, 'error'); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
}

function useFileDrop(hasDoc: boolean) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const isFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => { if (!isFiles(e)) return; depth++; setOver(true); };
    const leave = (e: DragEvent) => { if (!isFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setOver(false); };
    const overH = (e: DragEvent) => { if (isFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault(); depth = 0; setOver(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
      const imgs = files.filter((f) => f.type.startsWith('image/'));
      if (pdfs.length) {
        if (hasDoc) mergeFiles(pdfs);
        else openFile(pdfs[0]).then(() => { if (pdfs.length > 1) mergeFiles(pdfs.slice(1)); });
      } else if (imgs.length && hasDoc) {
        imgs.forEach((f) => readImageFile(f).then((i) => placeImage(i.src, i.w, i.h)).catch(() => {}));
      } else useUi.getState().notify('Drop a PDF file', 'error');
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overH);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overH);
      window.removeEventListener('drop', drop);
    };
  }, [hasDoc]);
  return over;
}

function Toast() {
  const toast = useUi((s) => s.toast);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setShown(true);
    const t = setTimeout(() => setShown(false), toast.kind === 'error' ? 6000 : 2800);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || !shown) return null;
  return <div className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} onClick={() => setShown(false)}>{toast.msg}</div>;
}

function Landing() {
  const ref = useRef<HTMLInputElement>(null);
  const busy = useUi((s) => s.busy);
  return (
    <div className="landing">
      <div className="landing-brand"><Logo /> <span>Page<b>Craft</b></span></div>
      <h1>Edit any PDF, right in your browser</h1>
      <p className="lead">Change text, highlight, redact, sign, draw, add images and reorganize pages. Your file never leaves your device.</p>
      <button className="dropzone" onClick={() => ref.current?.click()} disabled={!!busy} data-testid="dropzone">
        <FileUp size={40} strokeWidth={1.5} />
        <strong>{busy ?? 'Choose a PDF or drop it here'}</strong>
        <span className="muted">Up to 200 MB · password-protected files supported</span>
      </button>
      <input ref={ref} type="file" accept="application/pdf,.pdf" hidden data-testid="open-input"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} />
      <button className="link-btn" onClick={() => openSample()} data-testid="sample">or try it with a sample document</button>
      <ul className="features">
        <li><Lock size={18} /> Private: processed locally, nothing is uploaded</li>
        <li><Sparkles size={18} /> True redaction that removes the content underneath</li>
        <li><Zap size={18} /> Keeps text and vector graphics sharp</li>
      </ul>
    </div>
  );
}

export default function App() {
  const hasDoc = useEditor((s) => s.doc.pages.length > 0);
  const panel = useEditor((s) => s.panel);
  const busy = useUi((s) => s.busy);
  const dropping = useFileDrop(hasDoc);
  useShortcuts();
  usePaste();

  useEffect(() => {
    if (!hasDoc) return;
    const warn = (e: BeforeUnloadEvent) => { if (useEditor.getState().past.length) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDoc]);

  return (
    <>
      {hasDoc ? (
        <div className="app">
          <Header />
          <Toolbar />
          <OptionsBar />
          <div className="workspace">
            <Sidebar />
            <main className="main">
              {panel === 'find' && <FindPanel />}
              <Viewer />
            </main>
          </div>
          {panel === 'organize' && <OrganizePanel />}
          {panel === 'sign' && <SignPanel />}
        </div>
      ) : <Landing />}
      {dropping && <div className="drop-overlay">{hasDoc ? 'Drop PDFs to add pages, or images to place them' : 'Drop your PDF to open it'}</div>}
      {busy && hasDoc && <div className="busy" role="status">{busy}</div>}
      <Toast />
    </>
  );
}
