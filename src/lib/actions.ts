import { useEditor } from '../store/store';
import { useUi } from '../store/ui';
import { PasswordError, openPdf } from './pdfjs';
import { buildPdf, downloadBytes, editedName } from './browserExport';
import { makeSamplePdf } from './sample';
import type { DocState } from './types';

export const MAX_FILE_BYTES = 200 * 1024 * 1024;

async function readPdf(file: File | { name: string; bytes: Uint8Array }) {
  // note: File has a bytes() method in newer browsers, so test for the instance type
  const bytes = file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file.bytes;
  if (bytes.length > MAX_FILE_BYTES) throw new Error('File is larger than 200 MB');
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  if (!head.includes('%PDF')) throw new Error(`"${file.name}" is not a PDF file`);
  let password: string | undefined;
  for (;;) {
    try {
      return await openPdf(bytes, file.name, password);
    } catch (e) {
      if (e instanceof PasswordError) {
        const p = window.prompt(e.incorrect ? 'Incorrect password. Try again:' : `"${file.name}" is password protected. Enter password:`);
        if (p === null) throw new Error('Password required to open this file');
        password = p;
        continue;
      }
      throw e;
    }
  }
}

async function guarded<T>(label: string, f: () => Promise<T>): Promise<T | undefined> {
  const ui = useUi.getState();
  ui.setBusy(label);
  try {
    return await f();
  } catch (e) {
    console.error(e);
    ui.notify(e instanceof Error ? e.message : String(e), 'error');
    return undefined;
  } finally {
    ui.setBusy(null);
  }
}

export function openFile(file: File | { name: string; bytes: Uint8Array }) {
  return guarded('Opening…', async () => {
    const { pages } = await readPdf(file);
    useEditor.getState().loadDoc(file.name, pages);
    useUi.getState().setMatches([]);
  });
}

export function openSample() {
  return guarded('Opening…', async () => {
    await openFile({ name: 'sample-agreement.pdf', bytes: await makeSamplePdf() });
  });
}

export function mergeFiles(files: File[]) {
  return guarded('Adding pages…', async () => {
    for (const f of files) {
      const { pages } = await readPdf(f);
      useEditor.getState().appendPages(pages);
    }
    useUi.getState().notify(`Added ${files.length} file${files.length > 1 ? 's' : ''}`);
  });
}

export function saveDoc(subset?: DocState, suffix?: string) {
  return guarded('Saving PDF…', async () => {
    const { doc, fileName } = useEditor.getState();
    const bytes = await buildPdf(subset ?? doc, fileName.replace(/\.pdf$/i, ''));
    const name = suffix ? editedName(fileName).replace(/-edited\.pdf$/, `-${suffix}.pdf`) : editedName(fileName);
    downloadBytes(bytes, name);
    useUi.getState().notify(`Saved ${name}`);
    return bytes;
  });
}

export function readImageFile(file: File): Promise<{ src: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported image format'));
      img.onload = () => {
        let src = reader.result as string;
        // pdf-lib embeds only PNG and JPEG; convert anything else (and huge images) via canvas
        const maxSide = 2400;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        if (!/^data:image\/(png|jpe?g)/.test(src) || scale < 1) {
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * scale);
          c.height = Math.round(img.naturalHeight * scale);
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
          src = /jpe?g/.test(file.type) ? c.toDataURL('image/jpeg', 0.92) : c.toDataURL('image/png');
        }
        resolve({ src, w: img.naturalWidth * scale, h: img.naturalHeight * scale });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
