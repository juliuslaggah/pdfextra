import type { Annotation } from '../lib/types';
import { LINE_HEIGHT, cssFont } from '../lib/textLayout';
import { arrowHead } from '../lib/exportPdf';

/** Visual rendering of one annotation. All views ignore pointer events: the
 *  page overlay does hit testing so every tool behaves consistently. */
export function AnnotationView({ a, z, hidden }: { a: Annotation; z: number; hidden?: boolean }) {
  const pos = (x: number, y: number, w: number, h: number): React.CSSProperties => ({
    position: 'absolute', left: x * z, top: y * z, width: w * z, height: h * z, pointerEvents: 'none',
  });
  switch (a.type) {
    case 'text':
      return (
        <div
          data-annot={a.id}
          className="annot-text"
          style={{
            ...pos(a.x, a.y, a.w, a.h), font: cssFont(a.fontSize * z, a.fontFamily, a.bold, a.italic, a.text),
            lineHeight: LINE_HEIGHT, color: a.color, whiteSpace: 'pre', visibility: hidden ? 'hidden' : undefined,
          }}
        >
          {a.text}
        </div>
      );
    case 'highlight':
      return <>{a.rects.map((r, i) => <div key={i} data-annot={a.id} style={{ ...pos(r.x, r.y, r.w, r.h), background: a.color, opacity: 0.4, mixBlendMode: 'multiply' }} />)}</>;
    case 'underline': case 'strikeout':
      return (
        <>
          {a.rects.map((r, i) => {
            const t = Math.max(0.8, r.h * 0.07);
            const y = a.type === 'underline' ? r.y + r.h - t : r.y + r.h * 0.55 - t / 2;
            return <div key={i} data-annot={a.id} style={{ ...pos(r.x, y, r.w, t), background: a.color }} />;
          })}
        </>
      );
    case 'whiteout':
      return <div data-annot={a.id} style={{ ...pos(a.x, a.y, a.w, a.h), background: a.color }} />;
    case 'redact':
      return <div data-annot={a.id} className="annot-redact" style={pos(a.x, a.y, a.w, a.h)} title="Redaction: content here is removed on save" />;
    case 'image':
      return <img data-annot={a.id} src={a.src} alt="" draggable={false} style={{ ...pos(a.x, a.y, a.w, a.h), objectFit: 'fill' }} />;
    case 'stamp': {
      const bw = Math.max(1.5, a.h * 0.06) * z;
      return (
        <svg data-annot={a.id} style={pos(a.x, a.y, a.w, a.h)} viewBox={`0 0 ${a.w * z} ${a.h * z}`}>
          <rect x={bw / 2} y={bw / 2} width={a.w * z - bw} height={a.h * z - bw} fill="none" stroke={a.color} strokeWidth={bw} opacity={0.9} />
          <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill={a.color} opacity={0.9}
            style={{ font: `bold ${a.h * 0.5 * z}px Helvetica, Arial, sans-serif` }}
            textLength={Math.max(1, (a.w - a.h * 0.4) * z)} lengthAdjust="spacingAndGlyphs">
            {a.label}
          </text>
        </svg>
      );
    }
    default:
      return null; // vector shapes are drawn in the shared SVG layer
  }
}

export function VectorLayer({ annots, z, w, h }: { annots: Annotation[]; z: number; w: number; h: number }) {
  return (
    <svg className="vector-layer" width={w * z} height={h * z} viewBox={`0 0 ${w} ${h}`}>
      {annots.map((a) => {
        switch (a.type) {
          case 'rect':
            return <rect key={a.id} data-annot={a.id} x={a.x} y={a.y} width={a.w} height={a.h} stroke={a.stroke} strokeWidth={a.strokeWidth} fill={a.fill ?? 'none'} />;
          case 'ellipse':
            return <ellipse key={a.id} data-annot={a.id} cx={a.x + a.w / 2} cy={a.y + a.h / 2} rx={a.w / 2} ry={a.h / 2} stroke={a.stroke} strokeWidth={a.strokeWidth} fill={a.fill ?? 'none'} />;
          case 'line': case 'arrow': {
            const head = a.type === 'arrow' ? arrowHead(a.x1, a.y1, a.x2, a.y2, a.strokeWidth) : [];
            return (
              <g key={a.id} data-annot={a.id} stroke={a.stroke} strokeWidth={a.strokeWidth} strokeLinecap="round">
                <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} />
                {head.map(([p, q], i) => <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />)}
              </g>
            );
          }
          case 'ink':
            return (
              <g key={a.id} data-annot={a.id} stroke={a.stroke} strokeWidth={a.strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={a.opacity}>
                {a.paths.map((p, i) =>
                  p.length === 1
                    ? <circle key={i} cx={p[0].x} cy={p[0].y} r={a.strokeWidth / 2} fill={a.stroke} stroke="none" />
                    : <polyline key={i} points={p.map((pt) => `${pt.x},${pt.y}`).join(' ')} />)}
              </g>
            );
          default:
            return null;
        }
      })}
    </svg>
  );
}

export const isVector = (a: Annotation) => a.type === 'rect' || a.type === 'ellipse' || a.type === 'line' || a.type === 'arrow' || a.type === 'ink';
