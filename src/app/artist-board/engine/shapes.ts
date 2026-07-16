import { CanvasObject, PenStyle, Point, ShapeObject } from '../models';

export type ShapeTool = 'line' | 'rect' | 'ellipse';

export interface ShapeStyle {
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  fill: string;
  fillOpacity: number;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

// =========================================================================
// Geometry
// =========================================================================
/** axis-aligned bounds in the object's LOCAL (unrotated) css-px space */
export function objectBounds(o: CanvasObject): Bounds {
  if (o.kind === 'shape') {
    return {
      x: Math.min(o.a.x, o.b.x),
      y: Math.min(o.a.y, o.b.y),
      w: Math.abs(o.b.x - o.a.x),
      h: Math.abs(o.b.y - o.a.y),
    };
  }
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const p of o.points) {
    minx = Math.min(minx, p.x);
    miny = Math.min(miny, p.y);
    maxx = Math.max(maxx, p.x);
    maxy = Math.max(maxy, p.y);
  }
  if (!isFinite(minx)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
}

export function objectCenter(o: CanvasObject): Point {
  const b = objectBounds(o);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** rotate point `p` by `-angle` about `c` (into an object's local frame) */
function unrotate(p: Point, c: Point, angle: number): Point {
  if (!angle) return p;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** is a css-px point inside a fillable shape (rect/ellipse)? honors rotation */
export function pointInShape(s: ShapeObject, p: Point): boolean {
  const q = unrotate(p, objectCenter(s), s.rotation);
  const x = Math.min(s.a.x, s.b.x);
  const y = Math.min(s.a.y, s.b.y);
  const w = Math.abs(s.b.x - s.a.x);
  const h = Math.abs(s.b.y - s.a.y);
  if (s.tool === 'rect') {
    return q.x >= x && q.x <= x + w && q.y >= y && q.y <= y + h;
  }
  if (s.tool === 'line') return false;
  const rx = w / 2;
  const ry = h / 2;
  if (rx <= 0 || ry <= 0) return false;
  const dx = (q.x - (x + rx)) / rx;
  const dy = (q.y - (y + ry)) / ry;
  return dx * dx + dy * dy <= 1;
}

/** does a css-px point hit an object (near its ink or inside its fill)? */
export function hitTestObject(o: CanvasObject, p: Point, pad = 6): boolean {
  const q = unrotate(p, objectCenter(o), o.rotation);
  if (o.kind === 'shape') {
    if (o.tool !== 'line' && pointInShape(o, p)) return true;
    const b = objectBounds(o);
    const tol = o.strokeWidth / 2 + pad;
    if (o.tool === 'line') return distToSegment(q, o.a, o.b) <= tol;
    // rect/ellipse edge proximity (fallback for hollow shapes)
    return (
      q.x >= b.x - tol &&
      q.x <= b.x + b.w + tol &&
      q.y >= b.y - tol &&
      q.y <= b.y + b.h + tol
    );
  }
  const tol = o.strokeWidth / 2 + pad;
  for (let i = 1; i < o.points.length; i++) {
    if (distToSegment(q, o.points[i - 1], o.points[i]) <= tol) return true;
  }
  if (o.points.length === 1) return Math.hypot(q.x - o.points[0].x, q.y - o.points[0].y) <= tol;
  return false;
}

// =========================================================================
// Rendering
// =========================================================================
/** stroke/fill a shape in the current context space (css px) */
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

/** per-segment pen width for a nib style */
export function penWidthFor(style: PenStyle, base: number, a: Point, b: Point): number {
  switch (style) {
    case 'fine':
      return Math.max(0.75, base * 0.5);
    case 'bold':
      return base * 1.7;
    case 'fountain': {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const taper = Math.max(0.3, Math.min(1, 1 - len / 130));
      return Math.max(0.75, base * taper);
    }
    default:
      return base;
  }
}

/**
 * Draw a smoothed pen stroke (quadratic through the midpoints of consecutive
 * samples, variable per-segment width). Caller sets globalAlpha/color scaling.
 */
export function drawPathPoints(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  stroke: string,
  base: number,
  style: PenStyle,
): void {
  if (!points.length) return;
  ctx.strokeStyle = stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length === 1) {
    ctx.lineWidth = penWidthFor(style, base, points[0], points[0]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[0].x, points[0].y);
    ctx.stroke();
    return;
  }
  let prevMid = points[0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    ctx.lineWidth = penWidthFor(style, base, a, b);
    ctx.beginPath();
    ctx.moveTo(prevMid.x, prevMid.y);
    ctx.quadraticCurveTo(a.x, a.y, mid.x, mid.y);
    ctx.stroke();
    prevMid = mid;
  }
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.moveTo(prevMid.x, prevMid.y);
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/** draw any retained object (shape or pen path) with rotation, at device res */
export function drawObject(ctx: CanvasRenderingContext2D, o: CanvasObject, dpr: number): void {
  ctx.save();
  ctx.scale(dpr, dpr);
  if (o.rotation) {
    const c = objectCenter(o);
    ctx.translate(c.x, c.y);
    ctx.rotate(o.rotation);
    ctx.translate(-c.x, -c.y);
  }
  if (o.kind === 'shape') {
    drawShapePath(ctx, o.tool, o.a, o.b, o);
  } else {
    ctx.globalAlpha = o.strokeOpacity;
    drawPathPoints(ctx, o.points, o.stroke, o.strokeWidth, o.penStyle);
  }
  ctx.restore();
}
