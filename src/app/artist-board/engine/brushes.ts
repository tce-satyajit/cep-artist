import { BrushStyle, Point } from '../models';

export interface BrushOpts {
  color: string;
  width: number;
  /** angle of the calligraphy flat nib, radians */
  nibAngle: number;
}

/**
 * Paint one natural-media brush segment (a -> b) onto a context. Textured
 * brushes intentionally build up alpha within a stroke (that IS the grain);
 * the caller flattens the whole stroke buffer onto the layer at the end.
 * Stateless — all inputs are passed in.
 */
export function paintBrushSegment(
  ctx: CanvasRenderingContext2D,
  style: BrushStyle,
  a: Point,
  b: Point,
  { color, width: w, nibAngle }: BrushOpts,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 0.0001;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy; // unit normal
  const ny = ux;

  switch (style) {
    case 'calligraphy': {
      // fixed-angle flat nib -> thick across the nib, thin along it
      const half = w / 2;
      const px = Math.cos(nibAngle) * half;
      const py = Math.sin(nibAngle) * half;
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(a.x + px, a.y + py);
      ctx.lineTo(a.x - px, a.y - py);
      ctx.lineTo(b.x - px, b.y - py);
      ctx.lineTo(b.x + px, b.y + py);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'ink': {
      // speed-tapered round: slow = fat, fast = thin, like a loaded brush
      const taper = Math.max(0.22, Math.min(1, 1 - len / 130));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(0.5, w * taper);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      // a couple of faint edge fibers for organic ink bleed
      if (w > 6) {
        ctx.globalAlpha = 0.18;
        ctx.lineWidth = 1;
        for (let s = -1; s <= 1; s += 2) {
          const o = (w * taper) / 2 - 0.5;
          ctx.beginPath();
          ctx.moveTo(a.x + nx * o * s, a.y + ny * o * s);
          ctx.lineTo(b.x + nx * o * s, b.y + ny * o * s);
          ctx.stroke();
        }
      }
      break;
    }

    case 'bristle': {
      // many thin parallel sub-strokes; random gaps + alpha = dry streaks
      const n = Math.max(4, Math.round(w / 2.2));
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.14) continue; // broken bristle
        const o = (i / (n - 1) - 0.5) * w;
        const wob = (Math.random() - 0.5) * 1.5;
        ctx.globalAlpha = 0.22 + Math.random() * 0.5;
        ctx.lineWidth = 0.6 + Math.random() * 1.4;
        ctx.beginPath();
        ctx.moveTo(a.x + nx * (o + wob), a.y + ny * (o + wob));
        ctx.lineTo(b.x + nx * o, b.y + ny * o);
        ctx.stroke();
      }
      break;
    }

    case 'charcoal': {
      // scatter grain across the width, denser in the middle
      const half = w / 2;
      const steps = Math.max(1, Math.round(len));
      const perStep = Math.max(2, Math.round(w / 3));
      ctx.fillStyle = color;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const cx = a.x + dx * t;
        const cy = a.y + dy * t;
        for (let k = 0; k < perStep; k++) {
          const off = (Math.random() - 0.5) * 2 * half;
          const edge = 1 - Math.abs(off) / half; // middle-heavy
          if (Math.random() > edge * 0.9 + 0.1) continue;
          const gr = 0.4 + Math.random() * 1.5;
          ctx.globalAlpha = (0.1 + Math.random() * 0.3) * edge;
          ctx.beginPath();
          ctx.arc(cx + nx * off, cy + ny * off, gr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }

    case 'airbrush': {
      // soft spray of low-alpha specks distributed along the whole segment
      // (centre-weighted radius), so fast strokes stay a continuous band
      const r = w / 2;
      const density = Math.floor((len + 4) * (r / 8 + 0.6)) + 8;
      ctx.fillStyle = color;
      for (let i = 0; i < density; i++) {
        const t = Math.random();
        const cx = a.x + dx * t;
        const cy = a.y + dy * t;
        const ang = Math.random() * Math.PI * 2;
        const rr = r * Math.pow(Math.random(), 0.6);
        ctx.globalAlpha = 0.05 + Math.random() * 0.08;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, 0.7 + Math.random() * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'pencil': {
      // fine jittered graphite lines, low alpha builds tone
      const n = Math.max(2, Math.round(w / 2.5));
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      const jit = () => (Math.random() - 0.5) * 1.3;
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.3) continue;
        const o = (Math.random() - 0.5) * w * 0.9;
        ctx.globalAlpha = 0.06 + Math.random() * 0.2;
        ctx.lineWidth = 0.5 + Math.random() * 0.6;
        ctx.beginPath();
        ctx.moveTo(a.x + nx * o + jit(), a.y + ny * o + jit());
        ctx.lineTo(b.x + nx * o + jit(), b.y + ny * o + jit());
        ctx.stroke();
      }
      break;
    }
  }
}
