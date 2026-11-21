// Copies pdf.js standard fonts and CMaps into public/ so non-embedded fonts and CJK text render.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
const src = 'node_modules/pdfjs-dist';
for (const dir of ['standard_fonts', 'cmaps']) {
  const to = `public/pdfjs/${dir}`;
  if (existsSync(`${src}/${dir}`)) {
    mkdirSync(to, { recursive: true });
    cpSync(`${src}/${dir}`, to, { recursive: true });
  }
}
console.log('pdf.js assets copied');
