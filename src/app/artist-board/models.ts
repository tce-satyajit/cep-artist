export type ToolId =
  | 'select'
  | 'move'
  | 'pen'
  | 'brush'
  | 'eraser'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'fill'
  | 'eyedropper';

export interface ToolDef {
  id: ToolId;
  name: string;
  hint: string;
  shortcut: string;
  /** whether this tool uses the fill color/opacity controls */
  usesFill: boolean;
  /** whether this tool uses the outline color/opacity controls */
  usesOutline: boolean;
  /** whether this tool uses the line-width control */
  usesLineWidth: boolean;
}

export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

export const TOOLS: ToolDef[] = [
  { id: 'select', name: 'Select', hint: 'Select, move, resize, rotate a shape or stroke', shortcut: 'S', usesFill: false, usesOutline: false, usesLineWidth: false },
  { id: 'move', name: 'Move / Pan', hint: 'Drag to pan the canvas', shortcut: 'V', usesFill: false, usesOutline: false, usesLineWidth: false },
  { id: 'pen', name: 'Pen', hint: 'Freehand pen stroke', shortcut: 'P', usesFill: false, usesOutline: true, usesLineWidth: true },
  { id: 'brush', name: 'Brush', hint: 'Natural-media art brushes', shortcut: 'B', usesFill: false, usesOutline: true, usesLineWidth: true },
  { id: 'eraser', name: 'Eraser', hint: 'Erase pixels on the active layer', shortcut: 'E', usesFill: false, usesOutline: false, usesLineWidth: true },
  { id: 'line', name: 'Line', hint: 'Click-drag to draw a straight line', shortcut: 'L', usesFill: false, usesOutline: true, usesLineWidth: true },
  { id: 'rect', name: 'Rectangle', hint: 'Click-drag to draw a rectangle', shortcut: 'R', usesFill: true, usesOutline: true, usesLineWidth: true },
  { id: 'ellipse', name: 'Ellipse', hint: 'Click-drag to draw an ellipse', shortcut: 'O', usesFill: true, usesOutline: true, usesLineWidth: true },
  { id: 'text', name: 'Text', hint: 'Click to place text', shortcut: 'T', usesFill: true, usesOutline: false, usesLineWidth: false },
  { id: 'eyedropper', name: 'Eyedropper', hint: 'Click to sample a color', shortcut: 'I', usesFill: false, usesOutline: false, usesLineWidth: false },
];

export type BrushStyle =
  | 'ink'
  | 'calligraphy'
  | 'bristle'
  | 'charcoal'
  | 'airbrush'
  | 'pencil';

export const BRUSHES: { id: BrushStyle; name: string; hint: string }[] = [
  { id: 'ink', name: 'Ink', hint: 'Speed-tapered sumi-e ink brush' },
  { id: 'calligraphy', name: 'Calligraphy', hint: 'Angled flat nib, thick/thin' },
  { id: 'bristle', name: 'Dry Bristle', hint: 'Streaky split-bristle dry brush' },
  { id: 'charcoal', name: 'Charcoal', hint: 'Grainy charcoal / chalk' },
  { id: 'airbrush', name: 'Airbrush', hint: 'Soft spray with density build-up' },
  { id: 'pencil', name: 'Pencil', hint: 'Fine sketchy graphite' },
];

export type PenStyle = 'fine' | 'medium' | 'bold' | 'fountain';

export const PENS: { id: PenStyle; name: string; hint: string }[] = [
  { id: 'fine', name: 'Fine', hint: 'Thin, crisp technical line' },
  { id: 'medium', name: 'Medium', hint: 'Standard round pen' },
  { id: 'bold', name: 'Bold', hint: 'Thick marker-weight stroke' },
  { id: 'fountain', name: 'Fountain', hint: 'Speed-tapered flowing nib' },
];

export interface Point {
  x: number;
  y: number;
}

/**
 * A retained vector shape (line / rectangle / ellipse). Unlike freehand strokes
 * these are NOT baked into the layer bitmap — they are kept as objects and
 * re-rendered every frame, so they can be hit-tested and re-filled as a whole.
 * Coordinates are in css pixels.
 */
export interface ShapeObject {
  kind: 'shape';
  id: string;
  tool: 'line' | 'rect' | 'ellipse';
  a: Point;
  b: Point;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  fill: string;
  fillOpacity: number;
  rotation: number; // radians, about the object's center
}

/** a retained freehand pen stroke (selectable, unlike textured brush strokes) */
export interface PathObject {
  kind: 'path';
  id: string;
  points: Point[];
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  penStyle: PenStyle;
  rotation: number; // radians, about the object's bbox center
}

/** any retained vector object drawn above a layer's raster bitmap */
export type CanvasObject = ShapeObject | PathObject;

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0..1
  blend: BlendMode;
  canvas: HTMLCanvasElement; // raster content (textured brush / eraser)
  ctx: CanvasRenderingContext2D;
  objects: CanvasObject[]; // retained vector objects, drawn above the raster
}

/** full restorable state of a layer for undo/redo (raster + objects) */
export interface LayerState {
  bitmap: ImageData;
  objects: CanvasObject[];
}

export interface HistoryEntry {
  layerId: string;
  before: LayerState;
  after: LayerState;
}
