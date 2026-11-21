import { useEditor } from '../store/store';
import { Thumbnail } from './Thumbnail';

export function Sidebar() {
  const pages = useEditor((s) => s.doc.pages);
  const current = useEditor((s) => s.currentPage);
  const { scrollTo } = useEditor.getState();
  return (
    <aside className="sidebar" aria-label="Pages">
      <div className="sidebar-title">Pages <span className="muted">{pages.length}</span></div>
      <div className="thumb-list">
        {pages.map((p, i) => (
          <button key={p.id} className={`thumb ${i === current ? 'active' : ''}`} onClick={() => scrollTo(p.id)} aria-label={`Go to page ${i + 1}`}>
            <Thumbnail spec={p} width={110} />
            <span>{i + 1}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
