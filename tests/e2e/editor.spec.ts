import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const fixtures = resolve('tests/fixtures');
const stdFonts = resolve('node_modules/pdfjs-dist/standard_fonts') + '/';

// ---------- helpers ----------

async function openSample(page: Page) {
  await page.goto('/');
  await page.getByTestId('sample').click();
  await expect(page.locator('.page')).toHaveCount(3);
  await expect(page.locator('.page').first().locator('.page-loading')).toHaveCount(0);
}

/** Absolute screen position for PDF point (x, y) on page `i` at the current zoom. */
async function at(page: Page, x: number, y: number, i = 0) {
  const box = (await page.locator('.page').nth(i).boundingBox())!;
  const zoom = await page.evaluate(() => (window as any).__editor.useEditor.getState().zoom);
  return { x: box.x + x * zoom, y: box.y + y * zoom };
}

async function drag(page: Page, from: [number, number], to: [number, number], i = 0) {
  const a = await at(page, ...from, i);
  const b = await at(page, ...to, i);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

async function clickAt(page: Page, x: number, y: number, i = 0) {
  const p = await at(page, x, y, i);
  await page.mouse.click(p.x, p.y);
}

const state = (page: Page) => page.evaluate(() => {
  const s = (window as any).__editor.useEditor.getState();
  return { doc: s.doc, past: s.past.length, future: s.future.length, selectedId: s.selectedId, zoom: s.zoom, panel: s.panel };
});

const tool = (page: Page, id: string) => page.locator(`[data-tool="${id}"]`).click();

async function save(page: Page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save').click()]);
  expect(dl.suggestedFilename()).toMatch(/-edited\.pdf$/);
  return new Uint8Array(readFileSync((await dl.path())!));
}

async function pdfText(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: stdFonts, disableFontFace: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out.push(c.items.map((it: any) => it.str).join(' '));
  }
  return out;
}

// ---------- tests ----------

test('landing page opens a sample and shows thumbnails', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openSample(page);
  await expect(page.locator('.thumb')).toHaveCount(3);
  await expect(page.locator('.file-name')).toHaveText('sample-agreement.pdf');
  expect(errors).toEqual([]);
});

test('opens a PDF chosen from disk', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-input').setInputFiles(resolve(fixtures, 'two-pages.pdf'));
  await expect(page.locator('.page')).toHaveCount(2);
});

test('rejects files that are not PDFs', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-input').setInputFiles(resolve(fixtures, 'red.png'));
  await expect(page.locator('.toast.error')).toContainText('not a PDF');
});

test('opens password-protected PDFs', async ({ page }) => {
  await page.goto('/');
  let asked = 0;
  page.on('dialog', (d) => { asked++; d.accept(asked === 1 ? 'wrong' : 'letmein'); });
  await page.getByTestId('open-input').setInputFiles(resolve(fixtures, 'protected.pdf'));
  await expect(page.locator('.page')).toHaveCount(1);
  expect(asked).toBe(2);
  // encrypted sources are rasterized on export; the output must still be a valid PDF
  const out = await save(page);
  expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
});

test('add text, including non-Latin characters', async ({ page }) => {
  await openSample(page);
  await tool(page, 'text');
  await clickAt(page, 80, 300);
  await page.keyboard.type('Hello from e2e');
  await page.keyboard.press('Escape');
  await clickAt(page, 80, 650);
  await page.keyboard.type('Привет, мир');
  await page.keyboard.press('Escape');
  const s = await state(page);
  expect(s.doc.annots.filter((a: any) => a.type === 'text').map((a: any) => a.text)).toEqual(['Hello from e2e', 'Привет, мир']);
  const text = await pdfText(await save(page));
  expect(text[0]).toContain('Hello from e2e');
  expect(text[0].replace(/\s/g, '')).toContain('Привет,мир');
});

test('empty text boxes are discarded without leaving undo history', async ({ page }) => {
  await openSample(page);
  await tool(page, 'text');
  await clickAt(page, 80, 300);
  await page.keyboard.press('Escape');
  const s = await state(page);
  expect(s.doc.annots).toHaveLength(0);
  expect(s.past).toBe(0);
});

test('edit existing text replaces it in place', async ({ page }) => {
  await openSample(page);
  await tool(page, 'editText');
  await expect(page.locator('.text-item').first()).toBeVisible();
  await clickAt(page, 150, 128); // "Client: Acme Corporation"
  const editor = page.getByTestId('text-editor');
  await expect(editor).toHaveValue('Client: Acme Corporation');
  await editor.fill('Client: Globex Inc');
  await page.keyboard.press('Escape');
  const s = await state(page);
  expect(s.doc.annots.map((a: any) => a.type)).toEqual(['whiteout', 'text']);
  // one undo step removes the whole edit
  await page.keyboard.press('Control+z');
  expect((await state(page)).doc.annots).toHaveLength(0);
  await page.keyboard.press('Control+Shift+z');
  const text = await pdfText(await save(page));
  expect(text[0]).toContain('Client: Globex Inc');
});

test('edit text with no change leaves the page untouched', async ({ page }) => {
  await openSample(page);
  await tool(page, 'editText');
  await expect(page.locator('.text-item').first()).toBeVisible();
  await clickAt(page, 150, 128);
  await page.keyboard.press('Escape');
  expect((await state(page)).doc.annots).toHaveLength(0);
});

for (const kind of ['highlight', 'underline', 'strikeout'] as const) {
  test(`${kind} snaps to the text line`, async ({ page }) => {
    await openSample(page);
    await tool(page, kind);
    await drag(page, [70, 198], [400, 200]); // first body line (Times 12pt)
    const a = (await state(page)).doc.annots[0];
    expect(a.type).toBe(kind);
    expect(a.rects).toHaveLength(1);
    expect(a.rects[0].h).toBeGreaterThan(10);
    expect(a.rects[0].h).toBeLessThan(18);
    expect((await PDFDocument.load(await save(page))).getPageCount()).toBe(3);
  });
}

test('redaction permanently removes the content', async ({ page }) => {
  await openSample(page);
  await tool(page, 'redact');
  await drag(page, [65, 140], [330, 158]); // "Account number: 4417-..."
  expect((await state(page)).doc.annots[0].type).toBe('redact');
  const text = await pdfText(await save(page));
  expect(text[0]).not.toContain('4417');
  expect(text[0]).not.toContain('Service Agreement'); // page is flattened
  expect(text[1]).toContain('Terms and conditions'); // other pages stay vector
});

test('whiteout covers content', async ({ page }) => {
  await openSample(page);
  await tool(page, 'whiteout');
  await drag(page, [65, 330], [400, 370]);
  const a = (await state(page)).doc.annots[0];
  expect(a).toMatchObject({ type: 'whiteout', color: '#ffffff' });
});

test('shapes: rectangle, ellipse, line and arrow', async ({ page }) => {
  await openSample(page);
  await tool(page, 'shape');
  for (const [label, y] of [['Rectangle', 500], ['Ellipse', 560], ['Line', 620], ['Arrow', 680]] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await drag(page, [100, y], [250, y + 40]);
    await tool(page, 'shape');
  }
  expect((await state(page)).doc.annots.map((a: any) => a.type)).toEqual(['rect', 'ellipse', 'line', 'arrow']);
  await save(page);
});

test('draw and erase', async ({ page }) => {
  await openSample(page);
  await tool(page, 'draw');
  await drag(page, [100, 600], [300, 700]);
  let s = await state(page);
  expect(s.doc.annots[0].type).toBe('ink');
  expect(s.doc.annots[0].paths[0].length).toBeGreaterThan(3);
  await tool(page, 'eraser');
  await page.getByRole('button', { name: 'Remove my edits' }).click();
  await clickAt(page, 200, 650);
  s = await state(page);
  expect(s.doc.annots).toHaveLength(0);
  await page.keyboard.press('Control+z');
  expect((await state(page)).doc.annots).toHaveLength(1);
});

test('stamps are placed and exported', async ({ page }) => {
  await openSample(page);
  await tool(page, 'stamp');
  await page.getByRole('button', { name: 'CONFIDENTIAL' }).click();
  await clickAt(page, 450, 100);
  expect((await state(page)).doc.annots[0]).toMatchObject({ type: 'stamp', label: 'CONFIDENTIAL' });
  expect((await pdfText(await save(page)))[0]).toContain('CONFIDENTIAL');
});

test('add an image from file', async ({ page }) => {
  await openSample(page);
  await page.getByTestId('image-input').setInputFiles(resolve(fixtures, 'red.png'));
  const a = (await state(page)).doc.annots[0];
  expect(a.type).toBe('image');
  expect(a.src).toMatch(/^data:image\/png/);
  const out = await PDFDocument.load(await save(page));
  expect(out.getPageCount()).toBe(3);
});

test('draw a signature and place it', async ({ page }) => {
  await openSample(page);
  await tool(page, 'sign');
  const pad = (await page.getByTestId('sign-pad').boundingBox())!;
  await page.mouse.move(pad.x + 40, pad.y + 60);
  await page.mouse.down();
  await page.mouse.move(pad.x + 120, pad.y + 30, { steps: 5 });
  await page.mouse.move(pad.x + 220, pad.y + 80, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Place signature' }).click();
  const a = (await state(page)).doc.annots[0];
  expect(a.type).toBe('image');
  expect(a.w).toBeLessThanOrEqual(180);
});

test('type a signature', async ({ page }) => {
  await openSample(page);
  await tool(page, 'sign');
  await page.getByRole('tab', { name: 'Type' }).click();
  await page.getByPlaceholder('Type your name').fill('Jane Doe');
  await page.getByRole('button', { name: 'Place signature' }).click();
  expect((await state(page)).doc.annots[0].type).toBe('image');
});

test('select, move, resize, nudge, duplicate and delete', async ({ page }) => {
  await openSample(page);
  await tool(page, 'shape');
  await drag(page, [100, 600], [200, 650]);
  await tool(page, 'select');
  await clickAt(page, 100, 612); // on the left edge stroke, away from handles
  let s = await state(page);
  const id = s.doc.annots[0].id;
  expect(s.selectedId).toBe(id);
  await drag(page, [100, 612], [150, 642]);
  s = await state(page);
  expect(s.doc.annots[0]).toMatchObject({ x: 150, y: 630 });
  // resize via the south-east handle
  const h = page.locator('.handle.h-se');
  const hb = (await h.boundingBox())!;
  await page.mouse.move(hb.x + 5, hb.y + 5);
  await page.mouse.down();
  await page.mouse.move(hb.x + 55, hb.y + 25, { steps: 4 });
  await page.mouse.up();
  s = await state(page);
  expect(s.doc.annots[0].w).toBeCloseTo(150, 0);
  expect(s.doc.annots[0].h).toBeCloseTo(70, 0);
  await page.keyboard.press('ArrowRight');
  expect((await state(page)).doc.annots[0].x).toBe(151);
  await page.keyboard.press('Control+d');
  expect((await state(page)).doc.annots).toHaveLength(2);
  await page.keyboard.press('Delete');
  expect((await state(page)).doc.annots).toHaveLength(1);
});

test('text annotations can be restyled from the options bar', async ({ page }) => {
  await openSample(page);
  await tool(page, 'text');
  await clickAt(page, 80, 300);
  await page.keyboard.type('Style me');
  await page.keyboard.press('Escape');
  await tool(page, 'select');
  await clickAt(page, 90, 300);
  await expect(page.getByTestId('selected-options')).toBeVisible();
  await page.getByRole('button', { name: 'Bold' }).click();
  await page.getByLabel('Font size').fill('24');
  const a = (await state(page)).doc.annots[0];
  expect(a).toMatchObject({ bold: true, fontSize: 24 });
});

test('find and replace', async ({ page }) => {
  await openSample(page);
  await page.keyboard.press('Control+f');
  await page.getByTestId('find-input').fill('agreement');
  await expect(page.getByTestId('find-count')).toHaveText('1 of 3');
  await page.getByTestId('find-input').fill('Acme');
  await expect(page.getByTestId('find-count')).toHaveText('1 of 1');
  await page.getByTestId('replace-input').fill('Initech');
  await page.getByTestId('replace-all').click();
  const texts = (await state(page)).doc.annots.filter((a: any) => a.type === 'text').map((a: any) => a.text);
  expect(texts).toEqual(['Client: Initech Corporation']);
  expect((await pdfText(await save(page)))[0]).toContain('Client: Initech Corporation');
});

test('organize pages: rotate, delete, insert, reorder, export', async ({ page }) => {
  await openSample(page);
  await tool(page, 'organize');
  await page.getByRole('button', { name: 'Rotate page 1 right' }).click();
  await page.getByRole('button', { name: 'Delete page 2' }).click();
  await page.getByRole('button', { name: 'Insert blank page after 2' }).click();
  await page.getByTestId('org-page-2').dragTo(page.getByTestId('org-page-0'));
  await page.getByRole('button', { name: 'Done' }).click();
  const s = await state(page);
  expect(s.doc.pages.map((p: any) => [p.srcId === null, p.rotation])).toEqual([[true, 0], [false, 90], [false, 0]]);
  const out = await save(page);
  const lib = await PDFDocument.load(out);
  expect(lib.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])).toEqual([[792, 612], [792, 612], [792, 612]]);
  const t = await pdfText(out);
  expect(t[0]).toBe('');
  expect(t[1]).toContain('Service Agreement');
  expect(t[2]).toContain('landscape appendix');
});

test('merge another PDF and extract selected pages', async ({ page }) => {
  await openSample(page);
  await tool(page, 'organize');
  await page.getByTestId('merge-input').setInputFiles(resolve(fixtures, 'two-pages.pdf'));
  await expect(page.locator('.org-page')).toHaveCount(5);
  await page.getByTestId('org-page-3').click();
  await page.getByTestId('org-page-4').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Extract' }).click()]);
  expect(dl.suggestedFilename()).toBe('sample-agreement-extract.pdf');
  const t = await pdfText(new Uint8Array(readFileSync((await dl.path())!)));
  expect(t).toEqual(['Merged one', 'Merged two']);
});

test('undo and redo through the header buttons', async ({ page }) => {
  await openSample(page);
  await tool(page, 'whiteout');
  await drag(page, [100, 600], [200, 650]);
  await page.getByRole('button', { name: 'Undo' }).click();
  expect((await state(page)).doc.annots).toHaveLength(0);
  await page.getByRole('button', { name: 'Redo' }).click();
  expect((await state(page)).doc.annots).toHaveLength(1);
});

test('zoom controls keep annotations aligned', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByTestId('zoom')).toHaveText('120%');
  await tool(page, 'shape');
  await drag(page, [100, 100], [200, 150]);
  const a = (await state(page)).doc.annots[0];
  expect(a.x).toBeCloseTo(100, 0);
  expect(a.w).toBeCloseTo(100, 0);
  await page.getByTestId('zoom').click();
  await expect(page.getByTestId('zoom')).toHaveText('100%');
});

test('annotations follow page rotation', async ({ page }) => {
  await openSample(page);
  await tool(page, 'whiteout');
  await drag(page, [100, 100], [200, 150]);
  await tool(page, 'organize');
  await page.getByRole('button', { name: 'Rotate page 1 right' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  const a = (await state(page)).doc.annots[0];
  expect(a).toMatchObject({ x: 792 - 150, y: 100, w: 50, h: 100 });
});

test('mobile layout has no horizontal page overflow', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await openSample(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();
});

test('eraser paints out page content in the paper colour', async ({ page }) => {
  await openSample(page);
  await tool(page, 'eraser');
  await drag(page, [70, 130], [300, 130]); // across "Client: Acme Corporation"
  const a = (await state(page)).doc.annots[0];
  expect(a).toMatchObject({ type: 'ink', stroke: '#ffffff', strokeWidth: 16 });
  // the stroke is drawn into the exported page
  expect((await PDFDocument.load(await save(page))).getPageCount()).toBe(3);
});

test('eraser cursor shape can be chosen', async ({ page }) => {
  await openSample(page);
  await tool(page, 'eraser');
  const p = await at(page, 200, 300);
  for (const shape of ['circle', 'square', 'plus', 'pencil']) {
    await page.getByRole('radio', { name: `${shape[0].toUpperCase() + shape.slice(1)} cursor` }).click();
    await page.mouse.move(p.x, p.y);
    await page.mouse.move(p.x + 5, p.y + 5);
    await expect(page.getByTestId('eraser-cursor')).toHaveAttribute('data-shape', shape);
  }
});
