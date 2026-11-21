import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../../src/store/store';
import type { PageSpec, ShapeAnnot } from '../../src/lib/types';

const pages = (n: number): PageSpec[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, srcId: 's', srcIndex: i, width: 600, height: 800, baseRotation: 0, rotation: 0 }));
const box = (id: string, pageId = 'p0'): ShapeAnnot => ({ id, pageId, type: 'rect', x: 10, y: 10, w: 20, h: 20, stroke: '#000', fill: null, strokeWidth: 1 });
const s = () => useEditor.getState();

beforeEach(() => s().loadDoc('a.pdf', pages(3)));

describe('history', () => {
  it('undoes and redoes annotation changes', () => {
    s().addAnnot(box('a'));
    s().updateAnnot('a', { x: 100 });
    expect(s().doc.annots[0]).toMatchObject({ x: 100 });
    s().undo();
    expect(s().doc.annots[0]).toMatchObject({ x: 10 });
    s().undo();
    expect(s().doc.annots).toHaveLength(0);
    s().redo(); s().redo();
    expect(s().doc.annots[0]).toMatchObject({ x: 100 });
  });
  it('a new edit clears the redo stack', () => {
    s().addAnnot(box('a'));
    s().undo();
    s().addAnnot(box('b'));
    expect(s().future).toHaveLength(0);
  });
  it('checkpoint + mutate makes a drag one undo step', () => {
    s().addAnnot(box('a'));
    s().checkpoint();
    for (let i = 1; i <= 5; i++) s().updateAnnot('a', { x: 10 + i }, false);
    expect(s().doc.annots[0]).toMatchObject({ x: 15 });
    s().undo();
    expect(s().doc.annots[0]).toMatchObject({ x: 10 });
  });
});

describe('page operations', () => {
  it('reorders pages', () => {
    s().movePage(0, 2);
    expect(s().doc.pages.map((p) => p.id)).toEqual(['p1', 'p2', 'p0']);
  });
  it('deletes pages with their annotations and never deletes the last page', () => {
    s().addAnnot(box('a', 'p1'));
    s().deletePages(['p1']);
    expect(s().doc.pages).toHaveLength(2);
    expect(s().doc.annots).toHaveLength(0);
    s().deletePages(['p0', 'p2']);
    expect(s().doc.pages).toHaveLength(2);
  });
  it('rotates pages and their annotations', () => {
    s().addAnnot(box('a'));
    s().rotatePages(['p0'], 90);
    expect(s().doc.pages[0].rotation).toBe(90);
    expect(s().doc.annots[0]).toMatchObject({ x: 800 - 30, y: 10 });
    s().rotatePages(['p0'], -90);
    expect(s().doc.pages[0].rotation).toBe(0);
    expect(s().doc.annots[0]).toMatchObject({ x: 10, y: 10 });
  });
  it('inserts blank pages and duplicates pages with annotations', () => {
    s().insertBlank(0);
    expect(s().doc.pages[1].srcId).toBeNull();
    s().addAnnot(box('a', 'p0'));
    s().duplicatePage('p0');
    expect(s().doc.pages).toHaveLength(5);
    const copyId = s().doc.pages[1].id;
    expect(s().doc.annots.filter((a) => a.pageId === copyId)).toHaveLength(1);
  });
});
