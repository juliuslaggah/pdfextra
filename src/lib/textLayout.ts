import type { FontFamily } from './types';

/** Shared by on-screen rendering and PDF export so text lands in the same place. */
export const LINE_HEIGHT = 1.2;

/** Distance from the top of a line box to the baseline, in em, for each family
 *  (CSS half-leading + ascent of the metric-compatible system font). */
export const BASELINE: Record<FontFamily, number> = { Helvetica: 0.947, Times: 0.938, Courier: 0.867 };

export const CSS_FAMILY: Record<FontFamily, string> = {
  Helvetica: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  Times: '"Times New Roman", Times, "Liberation Serif", serif',
  Courier: '"Courier New", Courier, "Liberation Mono", monospace',
};
export const UNICODE_CSS_FAMILY = '"DejaVu Sans", sans-serif';

// Characters outside Latin-1 that the WinAnsi (cp1252) encoding still covers.
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));

/** True when the standard 14 PDF fonts can encode the text. */
export function isWinAnsi(s: string): boolean {
  for (const ch of s) {
    if (ch === '\n' || ch === '\r' || ch === '\t') continue;
    const c = ch.codePointAt(0)!;
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) continue;
    if (CP1252_EXTRA.has(ch)) continue;
    return false;
  }
  return true;
}

export function cssFont(fontSize: number, family: FontFamily, bold: boolean, italic: boolean, text = ''): string {
  const fam = isWinAnsi(text) ? CSS_FAMILY[family] : UNICODE_CSS_FAMILY;
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontSize}px ${fam}`;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Size of a (multi-line) text block in points. Falls back to an estimate without canvas. */
export function measureText(text: string, fontSize: number, family: FontFamily, bold: boolean, italic: boolean) {
  const lines = text.split('\n');
  if (measureCtx === undefined) {
    try { measureCtx = document.createElement('canvas').getContext('2d'); } catch { measureCtx = null; }
  }
  let w = 0;
  for (const line of lines) {
    let lw: number;
    if (measureCtx) {
      measureCtx.font = cssFont(fontSize, family, bold, italic, text);
      lw = measureCtx.measureText(line).width;
    } else {
      lw = line.length * fontSize * (family === 'Courier' ? 0.6 : 0.52);
    }
    w = Math.max(w, lw);
  }
  return { w: Math.ceil(w) + 2, h: lines.length * fontSize * LINE_HEIGHT };
}

/** Guess one of the standard families from a pdf.js font description. */
export function guessFamily(fontFamily: string, fontName = ''): FontFamily {
  const s = `${fontFamily} ${fontName}`.toLowerCase();
  if (/mono|courier|consol/.test(s)) return 'Courier';
  if (/serif/.test(s) && !/sans/.test(s)) return 'Times';
  if (/times|georgia|garamond|roman|cambria|minion/.test(s)) return 'Times';
  return 'Helvetica';
}
