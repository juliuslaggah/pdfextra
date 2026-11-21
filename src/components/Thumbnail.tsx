import { useEffect, useRef, useState } from 'react';
import type { PageSpec } from '../lib/types';
import { renderPageToCanvas } from '../lib/pdfjs';
import { pageSize } from '../lib/geometry';

const cache = new Map<string, string>();

export function Thumbnail({ spec, width = 120 }: { spec: PageSpec; width?: number }) {
  const key = `${spec.srcId}:${spec.srcIndex}:${spec.rotation}:${width}`;
  const [url, setUrl] = useState(cache.get(key));
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = pageSize(spec);
  const height = (h / w) * width;

  useEffect(() => {
    if (cache.has(key)) { setUrl(cache.get(key)); return; }
    let alive = true;
    let cancel = () => {};
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const c = document.createElement('canvas');
      try {
        const t = await renderPageToCanvas(spec, (width * 2) / w, c);
        cancel = t.cancel;
        await t.promise;
        const u = c.toDataURL('image/jpeg', 0.8);
        cache.set(key, u);
        if (alive) setUrl(u);
      } catch { /* cancelled */ }
    }, { rootMargin: '300px' });
    io.observe(ref.current!);
    return () => { alive = false; io.disconnect(); cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div ref={ref} className="thumb-img" style={{ width, height }}>
      {url && <img src={url} alt="" draggable={false} />}
    </div>
  );
}
