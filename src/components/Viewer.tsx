import { useEffect, useRef } from 'react';
import { useEditor } from '../store/store';
import { PageView } from './PageView';
import { pageSize } from '../lib/geometry';

export function Viewer() {
  const pages = useEditor((s) => s.doc.pages);
  const zoom = useEditor((s) => s.zoom);
  const scrollTarget = useEditor((s) => s.scrollTarget);
  const ref = useRef<HTMLDivElement>(null);

  // Track the page nearest the middle of the viewport.
  useEffect(() => {
    const el = ref.current!;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mid = el.getBoundingClientRect().top + el.clientHeight / 2;
        let best = 0, bestD = Infinity;
        el.querySelectorAll<HTMLElement>('.page').forEach((p, i) => {
          const r = p.getBoundingClientRect();
          const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
          if (d < bestD) { bestD = d; best = i; }
        });
        if (useEditor.getState().currentPage !== best) useEditor.getState().setCurrentPage(best);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [pages.length]);

  useEffect(() => {
    if (!scrollTarget) return;
    const el = ref.current!;
    const page = el.querySelector<HTMLElement>(`[data-page-id="${scrollTarget.pageId}"]`);
    if (!page) return;
    const top = page.offsetTop - 16 + (scrollTarget.y !== undefined ? scrollTarget.y * zoom - el.clientHeight / 3 : 0);
    el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTarget]);

  // Ctrl/Cmd + wheel zoom
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const s = useEditor.getState();
      s.setZoom(s.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div ref={ref} className="viewer" data-testid="viewer">
      <div className="pages">
        {pages.map((p, i) => <PageView key={p.id} spec={p} index={i} />)}
      </div>
    </div>
  );
}

/** Zoom that makes the widest page fit the viewer. */
export function fitWidthZoom(): number {
  const el = document.querySelector('.viewer') as HTMLElement | null;
  const pages = useEditor.getState().doc.pages;
  if (!el || !pages.length) return 1;
  const maxW = Math.max(...pages.map((p) => pageSize(p).w));
  return (el.clientWidth - 64) / maxW;
}
