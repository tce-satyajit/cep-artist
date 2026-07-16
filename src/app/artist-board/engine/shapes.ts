import { Point, ShapeObject } from '../models';

export type ShapeTool = 'line' | 'rect' | 'ellipse';

export interface ShapeStyle {
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  fill: string;
  fillOpacity: number;
}

/**
 * Stroke/fill a shape into the current context space (css px — the caller sets
 * any dpr scale). Lines are stroke-only.
 */
export function drawShapePath(
  ctx: CanvasRenderingContext2D,
  tool: ShapeTool,
  a: Point,
  b: Point,
  style: ShapeStyle,
): void {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  ctx.lineWidth = style.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (tool === 'line') {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  } else if (tool === 'rect') {
    ctx.rect(x, y, w, h);
  } else {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  }
  if (tool !== 'line') {
    ctx.globalAlpha = style.fillOpacity;
    ctx.fillStyle = style.fill;
    ctx.fill();
  }
  if (style.strokeWidth > 0) {
    ctx.globalAlpha = style.strokeOpacity;
    ctx.strokeStyle = style.stroke;
    ctx.stroke();
  }
}

/** draw a retained shape object onto a device-resolution context */
export function drawShapeObject(ctx: CanvasRenderingContext2D, s: ShapeObject, dpr: number): void {
  ctx.save();
  ctx.scale(dpr, dpr);
  drawShapePath(ctx, s.tool, s.a, s.b, s);
  ctx.restore();
}

/** is a css-px point inside a fillable shape (rect/ellipse)? lines return false */
export function pointInShape(s: ShapeObject, p: Point): boolean {
  const x = Math.min(s.a.x, s.b.x);
  const y = Math.min(s.a.y, s.b.y);
  const w = Math.abs(s.b.x - s.a.x);
  const h = Math.abs(s.b.y - s.a.y);
  if (s.tool === 'rect') {
    return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
  }
  if (s.tool === 'line') return false;
  const rx = w / 2;
  const ry = h / 2;
  if (rx <= 0 || ry <= 0) return false;
  const dx = (p.x - (x + rx)) / rx;
  const dy = (p.y - (y + ry)) / ry;
  return dx * dx + dy * dy <= 1;
}
