/** All annotation coordinates are PDF points in the page's *displayed* frame
 *  (after rotation), with a top-left origin. 1 unit = 1/72 inch. */
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export type FontFamily = 'Helvetica' | 'Times' | 'Courier';
export type Rotation = 0 | 90 | 180 | 270;

interface Base { id: string; pageId: string }

export interface TextAnnot extends Base, Rect {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
  color: string;
}
export interface MarkupAnnot extends Base {
  type: 'highlight' | 'underline' | 'strikeout';
  rects: Rect[];
  color: string;
}
export interface BoxAnnot extends Base, Rect {
  /** redact = true removal on export; whiteout = opaque cover in `color` */
  type: 'redact' | 'whiteout';
  color: string;
}
export interface ShapeAnnot extends Base, Rect {
  type: 'rect' | 'ellipse';
  stroke: string;
  fill: string | null;
  strokeWidth: number;
}
export interface LineAnnot extends Base {
  type: 'line' | 'arrow';
  x1: number; y1: number; x2: number; y2: number;
  stroke: string;
  strokeWidth: number;
}
export interface InkAnnot extends Base {
  type: 'ink';
  paths: Point[][];
  stroke: string;
  strokeWidth: number;
  opacity: number;
}
export interface ImageAnnot extends Base, Rect {
  type: 'image';
  /** PNG or JPEG data URL */
  src: string;
}
export interface StampAnnot extends Base, Rect {
  type: 'stamp';
  label: string;
  color: string;
}

export type Annotation =
  | TextAnnot | MarkupAnnot | BoxAnnot | ShapeAnnot | LineAnnot | InkAnnot | ImageAnnot | StampAnnot;
export type AnnotType = Annotation['type'];

export interface PageSpec {
  id: string;
  /** source document id, or null for an inserted blank page */
  srcId: string | null;
  srcIndex: number;
  /** size at the source page's own /Rotate, before user rotation */
  width: number;
  height: number;
  /** the source page's own /Rotate value */
  baseRotation: Rotation;
  /** extra clockwise rotation applied by the user */
  rotation: Rotation;
}

export interface DocState {
  pages: PageSpec[];
  annots: Annotation[];
}

export type Tool =
  | 'select' | 'editText' | 'text' | 'redact' | 'whiteout' | 'highlight' | 'underline' | 'strikeout'
  | 'stamp' | 'shape' | 'draw' | 'eraser';

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';
