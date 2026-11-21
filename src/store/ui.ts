import { create } from 'zustand';
import type { Rect } from '../lib/types';

export interface FindMatch { pageId: string; pageIndex: number; itemIndex: number; rect: Rect; context: string }

interface UiState {
  toast: { msg: string; kind: 'info' | 'error'; n: number } | null;
  busy: string | null;
  matches: FindMatch[];
  activeMatch: number;
  notify(msg: string, kind?: 'info' | 'error'): void;
  setBusy(b: string | null): void;
  setMatches(m: FindMatch[], active?: number): void;
  setActiveMatch(i: number): void;
}

export const useUi = create<UiState>((set, get) => ({
  toast: null,
  busy: null,
  matches: [],
  activeMatch: -1,
  notify: (msg, kind = 'info') => set({ toast: { msg, kind, n: (get().toast?.n ?? 0) + 1 } }),
  setBusy: (busy) => set({ busy }),
  setMatches: (matches, active = matches.length ? 0 : -1) => set({ matches, activeMatch: active }),
  setActiveMatch: (activeMatch) => set({ activeMatch }),
}));

/** Rendered page canvases (used to sample colors under text being edited). */
export const pageCanvases = new Map<string, { canvas: HTMLCanvasElement; scale: number }>();
