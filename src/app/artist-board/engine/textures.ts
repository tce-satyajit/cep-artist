export type BgTexture = 'dots' | 'grid' | 'lines' | 'paper';

/** paint a procedural background texture filling a w×h area (css px) */
export function paintTexture(
  ctx: CanvasRenderingContext2D,
  kind: BgTexture,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.fillStyle = kind === 'paper' ? '#f6f1e7' : '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const ink = 'rgba(0, 0, 0, 0.10)';

  if (kind === 'dots') {
    ctx.fillStyle = ink;
    const gap = 22;
    for (let y = gap; y < h; y += gap) {
      for (let x = gap; x < w; x += gap) {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (kind === 'grid') {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gap = 26;
    for (let x = gap; x < w; x += gap) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = gap; y < h; y += gap) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  } else if (kind === 'lines') {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gap = 20;
    for (let x = -h; x < w; x += gap) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
    }
    ctx.stroke();
  } else {
    // paper: faint warm speckle
    ctx.fillStyle = 'rgba(120, 100, 70, 0.06)';
    const specks = Math.round((w * h) / 900);
    for (let i = 0; i < specks; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, Math.random() * 0.9 + 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
