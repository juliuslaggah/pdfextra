# PageCraft PDF Editor

A browser-based PDF editor. Everything runs on the client: files are never uploaded, so it deploys as a static site (Vercel, Netlify, any CDN).

## Features

| Area | What you can do |
| --- | --- |
| **Edit text** | Click any line of existing text to rewrite it. The original is covered with a colour-matched patch and retyped in a matching font, size and colour. |
| **Add text** | Type anywhere: three font families, bold/italic, any size and colour. Non-Latin text (Cyrillic, Greek, etc.) is embedded with a Unicode font. |
| **Markup** | Highlight, underline and strikeout snap to the text lines you drag across. |
| **Redact** | True redaction: on save the page is flattened and everything under the box is gone, including the text layer. |
| **Whiteout** | Cover anything with an opaque box (the colour is editable). |
| **Shapes & drawing** | Rectangles, ellipses, lines, arrows (Shift constrains them), and freehand ink. |
| **Stamps** | APPROVED, DRAFT, CONFIDENTIAL and others, or your own text. |
| **Images & signatures** | Add images from a file or paste/drop them in. Draw, type or upload a signature; signatures are remembered on the device. |
| **Find & replace** | Search every page, step through matches, replace one or all. |
| **Pages** | Reorder by drag and drop; rotate, duplicate, delete, insert blank pages, merge more PDFs, extract selected pages. |
| **Editing** | Select, move, resize, nudge with the arrow keys, duplicate, delete. Full undo/redo, zoom (Ctrl + wheel), password-protected files. |

### Keyboard shortcuts

`V` select · `E` edit text · `T` add text · `H` highlight · `U` underline · `K` strikeout · `R` redact · `W` whiteout · `S` shapes · `D` draw · `X` eraser
`Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · `Ctrl+S` download · `Ctrl+F` find · `Ctrl+D` duplicate · `Del` delete · arrows nudge (Shift = 10pt) · `Esc` deselect

## How it works

- **Rendering:** [pdf.js](https://mozilla.github.io/pdf.js/) draws each page to a canvas (lazily, only near the viewport) and provides the text positions used by Edit Text, markup snapping and Find.
- **Editing model:** edits are stored as annotations in PDF points over the page, in a [zustand](https://github.com/pmndrs/zustand) store with snapshot-based undo history. The original file is never modified in memory.
- **Export:** [pdf-lib](https://pdf-lib.js.org/) builds a new PDF. Each source page is embedded as a vector form XObject, so text stays selectable and graphics stay sharp; then the annotations are drawn on top. Pages with redactions, and encrypted sources, are rasterized at about 180 dpi instead so nothing underneath survives.
- **Text fidelity:** the on-screen editor and the exporter share one set of line-height and baseline metrics, so text lands in the same place in the saved file.

### Known limitations

- Edit Text and Replace cover the original text and draw new text over it. The old text is hidden, but it is still in the file's text layer. To remove text completely, use **Redact**.
- Interactive form fields and links from the source PDF are not carried into the exported file.

## Development

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (Vitest): geometry, history, page ops, PDF export
npm run test:e2e     # end-to-end tests (Playwright): every tool in a real browser
npm run build        # production build in dist/
```

## Deploy to Vercel

1. Push this repository to GitHub.
2. On [vercel.com/new](https://vercel.com/new), import the repository. The included `vercel.json` sets the build (`npm run build`) and output (`dist`) settings, so the defaults work as-is.
3. Every push to the default branch deploys to production; other branches get preview URLs.
