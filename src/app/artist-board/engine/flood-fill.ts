export type RGBA = [number, number, number, number];

/** parse '#rrggbb' + a 0..1 alpha into an RGBA byte tuple */
export function rgbaFromColor(hex: string, alpha: number): RGBA {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return [r, g, b, Math.round(alpha * 255)];
}

function within(d: Uint8ClampedArray, i: number, t: RGBA, tol: number): boolean {
  return (
    Math.abs(d[i] - t[0]) <= tol &&
    Math.abs(d[i + 1] - t[1]) <= tol &&
    Math.abs(d[i + 2] - t[2]) <= tol &&
    Math.abs(d[i + 3] - t[3]) <= tol
  );
}

function colorsEqual(a: RGBA, b: RGBA, tol: number): boolean {
  return (
    Math.abs(a[0] - b[0]) <= tol &&
    Math.abs(a[1] - b[1]) <= tol &&
    Math.abs(a[2] - b[2]) <= tol &&
    Math.abs(a[3] - b[3]) <= tol
  );
}

/**
 * Scanline flood fill, mutating `img` in place. Fills the contiguous region of
 * pixels within `tol` of the color at (sx, sy) with `fill`. Coordinates are in
 * device pixels (the ImageData's own space).
 */
export function floodFill(img: ImageData, sx: number, sy: number, fill: RGBA, tol: number): void {
  const W = img.width;
  const H = img.height;
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;

  const data = img.data;
  const at = (i: number): RGBA => [data[i], data[i + 1], data[i + 2], data[i + 3]];
  const target = at((sy * W + sx) * 4);
  if (colorsEqual(target, fill, 2)) return;

  const matches = (idx: number) => within(data, idx, target, tol);
  const stack: [number, number][] = [[sx, sy]];

  while (stack.length) {
    const [px, py] = stack.pop()!;
    let x = px;
    const rowStart = py * W;
    while (x >= 0 && matches((rowStart + x) * 4)) x--;
    x++;
    let up = false;
    let down = false;
    while (x < W && matches((rowStart + x) * 4)) {
      const i = (rowStart + x) * 4;
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];
      if (py > 0) {
        if (matches(((py - 1) * W + x) * 4)) {
          if (!up) {
            stack.push([x, py - 1]);
            up = true;
          }
        } else up = false;
      }
      if (py < H - 1) {
        if (matches(((py + 1) * W + x) * 4)) {
          if (!down) {
            stack.push([x, py + 1]);
            down = true;
          }
        } else down = false;
      }
      x++;
    }
  }
}
