import { describe, expect, it } from 'vitest';
import { guessFamily, isWinAnsi } from '../../src/lib/textLayout';

describe('isWinAnsi', () => {
  it('accepts Latin-1 and cp1252 punctuation', () => {
    expect(isWinAnsi('Hello, Ünïcødé — “quotes” €5\nnext')).toBe(true);
  });
  it('rejects Cyrillic, CJK and emoji', () => {
    expect(isWinAnsi('Привет')).toBe(false);
    expect(isWinAnsi('日本')).toBe(false);
    expect(isWinAnsi('ok 👍')).toBe(false);
  });
});

describe('guessFamily', () => {
  it('maps pdf.js font info to a standard family', () => {
    expect(guessFamily('serif', 'g_d0_f2')).toBe('Times');
    expect(guessFamily('sans-serif', 'Arial')).toBe('Helvetica');
    expect(guessFamily('monospace', '')).toBe('Courier');
    expect(guessFamily('sans-serif', 'TimesNewRomanPSMT')).toBe('Times');
  });
});
