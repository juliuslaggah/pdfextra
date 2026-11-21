import { create } from 'zustand';
import type { Annotation, DocState, PageSpec, Rotation, ShapeKind, Tool } from '../lib/types';
import { addRotation, pageSize, rotateAnnot, uid } from '../lib/geometry';

const HISTORY_LIMIT = 200;

export interface ToolOptions {
  color: string;
  highlightColor: string;
  strokeWidth: number;
  fontSize: number;
  fontFamily: 'Helvetica' | 'Times' | 'Courier';
  bold: boolean;
  italic: boolean;
  shape: ShapeKind;
  fill: string | null;
  stampLabel: string;
  stampColor: string;
  eraserMode: 'content' | 'annots';
  eraserSize: number;
  eraserCursor: 'circle' | 'square' | 'plus' | 'pencil';
}

export interface EditorState {
  fileName: string;
  doc: DocState;
  past: DocState[];
  future: DocState[];
  tool: Tool;
  zoom: number;
  selectedId: string | null;
  editingId: string | null;
  currentPage: number;
  /** id of a page the viewer should scroll to (consumed by the viewer) */
  scrollTarget: { pageId: string; y?: number; n: number } | null;
  opts: ToolOptions;
  panel: 'none' | 'organize' | 'find' | 'sign';

  loadDoc(fileName: string, pages: PageSpec[]): void;
  /** Apply a change and record it for undo. */
  commit(fn: (d: DocState) => DocState): void;
  /** Apply a change without recording (use after `checkpoint` for drags). */
  mutate(fn: (d: DocState) => DocState): void;
  checkpoint(): void;
  undo(): void;
  redo(): void;

  addAnnot(a: Annotation, select?: boolean): void;
  updateAnnot(id: string, patch: Partial<Annotation>, record?: boolean): void;
  deleteAnnot(id: string): void;

  rotatePages(ids: string[], deg: number): void;
  deletePages(ids: string[]): void;
  movePage(from: number, to: number): void;
  insertBlank(afterIndex: number): void;
  duplicatePage(id: string): void;
  appendPages(pages: PageSpec[]): void;

  setTool(t: Tool): void;
  setZoom(z: number): void;
  select(id: string | null): void;
  setEditing(id: string | null): void;
  setCurrentPage(i: number): void;
  scrollTo(pageId: string, y?: number): void;
  setOpts(p: Partial<ToolOptions>): void;
  setPanel(p: EditorState['panel']): void;
}

const emptyDoc: DocState = { pages: [], annots: [] };

export const defaultOpts: ToolOptions = {
  color: '#111827',
  highlightColor: '#fde047',
  strokeWidth: 2,
  fontSize: 14,
  fontFamily: 'Helvetica',
  bold: false,
  italic: false,
  shape: 'rect',
  fill: null,
  stampLabel: 'APPROVED',
  stampColor: '#16a34a',
  eraserMode: 'content',
  eraserSize: 16,
  eraserCursor: 'circle',
};

export const useEditor = create<EditorState>((set, get) => ({
  fileName: '',
  doc: emptyDoc,
  past: [],
  future: [],
  tool: 'select',
  zoom: 1,
  selectedId: null,
  editingId: null,
  currentPage: 0,
  scrollTarget: null,
  opts: defaultOpts,
  panel: 'none',

  loadDoc: (fileName, pages) =>
    set({ fileName, doc: { pages, annots: [] }, past: [], future: [], selectedId: null, editingId: null, currentPage: 0, tool: 'select' }),

  commit: (fn) => {
    const { doc, past } = get();
    const next = fn(doc);
    if (next === doc) return;
    set({ doc: next, past: [...past, doc].slice(-HISTORY_LIMIT), future: [] });
  },
  mutate: (fn) => set({ doc: fn(get().doc) }),
  checkpoint: () => {
    const { doc, past } = get();
    if (past[past.length - 1] === doc) return;
    set({ past: [...past, doc].slice(-HISTORY_LIMIT), future: [] });
  },
  undo: () => {
    const { past, doc, future } = get();
    if (!past.length) return;
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], editingId: null, selectedId: null });
  },
  redo: () => {
    const { past, doc, future } = get();
    if (!future.length) return;
    set({ doc: future[0], past: [...past, doc], future: future.slice(1), editingId: null, selectedId: null });
  },

  addAnnot: (a, select = true) => {
    get().commit((d) => ({ ...d, annots: [...d.annots, a] }));
    if (select) set({ selectedId: a.id });
  },
  updateAnnot: (id, patch, record = true) => {
    const fn = (d: DocState): DocState => ({
      ...d,
      annots: d.annots.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)),
    });
    if (record) get().commit(fn);
    else get().mutate(fn);
  },
  deleteAnnot: (id) => {
    get().commit((d) => ({ ...d, annots: d.annots.filter((a) => a.id !== id) }));
    const s = get();
    if (s.selectedId === id) set({ selectedId: null });
    if (s.editingId === id) set({ editingId: null });
  },

  rotatePages: (ids, deg) =>
    get().commit((d) => {
      const r = addRotation(0, deg);
      const pages = d.pages.map((p) => (ids.includes(p.id) ? { ...p, rotation: addRotation(p.rotation, r) } : p));
      const annots = d.annots.map((a) => {
        if (!ids.includes(a.pageId)) return a;
        const p = d.pages.find((pg) => pg.id === a.pageId)!;
        const { w, h } = pageSize(p);
        return rotateAnnot(a, w, h, r as Rotation);
      });
      return { pages, annots };
    }),
  deletePages: (ids) => {
    const d = get().doc;
    if (d.pages.length - ids.length < 1) return; // a PDF needs at least one page
    get().commit((doc) => ({
      pages: doc.pages.filter((p) => !ids.includes(p.id)),
      annots: doc.annots.filter((a) => !ids.includes(a.pageId)),
    }));
    set({ currentPage: Math.min(get().currentPage, get().doc.pages.length - 1), selectedId: null });
  },
  movePage: (from, to) =>
    get().commit((d) => {
      if (from === to || from < 0 || to < 0 || from >= d.pages.length || to >= d.pages.length) return d;
      const pages = [...d.pages];
      const [p] = pages.splice(from, 1);
      pages.splice(to, 0, p);
      return { ...d, pages };
    }),
  insertBlank: (afterIndex) =>
    get().commit((d) => {
      const ref = d.pages[afterIndex] ?? d.pages[d.pages.length - 1];
      const size = ref ? pageSize(ref) : { w: 612, h: 792 };
      const blank: PageSpec = { id: uid('pg'), srcId: null, srcIndex: 0, width: size.w, height: size.h, baseRotation: 0, rotation: 0 };
      const pages = [...d.pages];
      pages.splice(afterIndex + 1, 0, blank);
      return { ...d, pages };
    }),
  duplicatePage: (id) =>
    get().commit((d) => {
      const i = d.pages.findIndex((p) => p.id === id);
      if (i < 0) return d;
      const copy = { ...d.pages[i], id: uid('pg') };
      const pages = [...d.pages];
      pages.splice(i + 1, 0, copy);
      const annots = [
        ...d.annots,
        ...d.annots.filter((a) => a.pageId === id).map((a) => ({ ...a, id: uid('an'), pageId: copy.id })),
      ];
      return { pages, annots };
    }),
  appendPages: (pages) => get().commit((d) => ({ ...d, pages: [...d.pages, ...pages] })),

  setTool: (tool) => set({ tool, editingId: null, selectedId: tool === 'select' ? get().selectedId : null }),
  setZoom: (z) => set({ zoom: Math.min(4, Math.max(0.25, Math.round(z * 100) / 100)) }),
  select: (id) => set({ selectedId: id, editingId: get().editingId === id ? id : null }),
  setEditing: (id) => set({ editingId: id, selectedId: id ?? get().selectedId }),
  setCurrentPage: (i) => set({ currentPage: i }),
  scrollTo: (pageId, y) => set({ scrollTarget: { pageId, y, n: (get().scrollTarget?.n ?? 0) + 1 } }),
  setOpts: (p) => set({ opts: { ...get().opts, ...p } }),
  setPanel: (panel) => set({ panel }),
}));

/** Record `base` as the undo point for changes made with `mutate` since then. */
export function commitFrom(base: DocState) {
  const s = useEditor.getState();
  const same = s.doc.pages === base.pages && s.doc.annots.length === base.annots.length && s.doc.annots.every((a, i) => a === base.annots[i]);
  if (same) { useEditor.setState({ doc: base }); return; }
  useEditor.setState({ past: [...s.past, base].slice(-HISTORY_LIMIT), future: [] });
}

/** Text annotations being edited that were created by a tool (not yet in history). */
export const pendingText = new Map<string, { base: DocState; coverId?: string; original?: string }>();
