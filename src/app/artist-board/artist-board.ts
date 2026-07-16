import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { paintBrushSegment } from './engine/brushes';
import { floodFill, rgbaFromColor } from './engine/flood-fill';
import { BgTexture, paintTexture } from './engine/textures';
import { drawShapeObject, drawShapePath, pointInShape, ShapeTool } from './engine/shapes';
import { ArtistStore } from './store/artist-store';
import {
  BlendMode,
  HistoryEntry,
  Layer,
  LayerState,
  Point,
  ShapeObject,
} from './models';

let uid = 0;
const nextId = () => `layer-${++uid}`;

@Component({
  selector: 'artist-board',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './artist-board.html',
  styleUrl: './artist-board.scss',
  providers: [ArtistStore],
})
export class ArtistBoard implements AfterViewInit, OnDestroy {
  readonly store = inject(ArtistStore);

  @ViewChild('stage', { static: true }) stageRef!: ElementRef<HTMLDivElement>;
  @ViewChild('board', { static: true }) boardRef!: ElementRef<HTMLCanvasElement>;

  // text-input overlay (lives with the canvas)
  readonly textEditing = signal(false);
  readonly textPos = signal<Point>({ x: 0, y: 0 });
  textValue = '';

  private bgImageEl: HTMLImageElement | null = null;

  // ---- engine internals ----
  private board!: HTMLCanvasElement;
  private bctx!: CanvasRenderingContext2D;
  // reusable offscreen buffer to composite one layer (raster + shapes) per frame
  private layerBuf!: HTMLCanvasElement;
  private lbctx!: CanvasRenderingContext2D;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private width = 0; // css px
  private height = 0;

  private drawing = false;
  private start: Point = { x: 0, y: 0 };
  private last: Point = { x: 0, y: 0 };
  // trailing midpoint of the smoothed pen curve (quadratic-through-midpoints)
  private prevMid: Point = { x: 0, y: 0 };
  private points: Point[] = [];
  private snapshotBefore: LayerState | null = null;

  // freehand strokes are painted opaque onto this off-screen buffer, then
  // flattened onto the layer once at the chosen opacity — so overlapping
  // segments never bead up or darken at the joins.
  private strokeBuffer: HTMLCanvasElement | null = null;
  private sbctx: CanvasRenderingContext2D | null = null;
  /** angle of the calligraphy nib (flat pen), in radians */
  private readonly nibAngle = -Math.PI / 4;

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  private ro?: ResizeObserver;

  // ignore extra fingers so multi-touch never corrupts a stroke
  private activePointerId: number | null = null;

  ngAfterViewInit(): void {
    this.board = this.boardRef.nativeElement;
    this.bctx = this.board.getContext('2d')!;
    this.resizeToStage(true);
    // seed with two layers, like a real editor
    const bg = this.makeLayer('Background');
    this.paintBackground(bg);
    const l1 = this.makeLayer('Layer 1');
    this.store.layers.set([bg, l1]);
    this.store.activeLayerId.set(l1.id);
    this.render();

    this.ro = new ResizeObserver(() => this.resizeToStage(false));
    this.ro.observe(this.stageRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
  }

  // =========================================================================
  // Layer management
  // =========================================================================
  private makeLayer(name: string): Layer {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(this.width * this.dpr);
    canvas.height = Math.round(this.height * this.dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(this.dpr, this.dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return {
      id: nextId(),
      name,
      visible: true,
      opacity: 1,
      blend: 'source-over',
      canvas,
      ctx,
      shapes: [],
    };
  }

  addLayer(): void {
    const l = this.makeLayer(`Layer ${this.store.layers().length}`);
    this.store.layers.update((ls) => [...ls, l]);
    this.store.activeLayerId.set(l.id);
    this.render();
  }

  deleteLayer(id: string): void {
    const ls = this.store.layers();
    if (ls.length <= 1) return;
    const idx = ls.findIndex((l) => l.id === id);
    const next = ls.filter((l) => l.id !== id);
    this.store.layers.set(next);
    if (this.store.activeLayerId() === id) {
      this.store.activeLayerId.set(next[Math.max(0, idx - 1)].id);
    }
    this.undoStack = this.undoStack.filter((e) => e.layerId !== id);
    this.redoStack = this.redoStack.filter((e) => e.layerId !== id);
    this.syncHistoryFlags();
    this.render();
  }

  selectLayer(id: string): void {
    this.store.activeLayerId.set(id);
  }

  toggleLayerVisible(id: string): void {
    this.store.layers.update((ls) =>
      ls.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    );
    this.render();
  }

  setLayerOpacity(id: string, value: number): void {
    this.store.layers.update((ls) =>
      ls.map((l) => (l.id === id ? { ...l, opacity: value } : l)),
    );
    this.render();
  }

  setLayerBlend(id: string, value: BlendMode): void {
    this.store.layers.update((ls) =>
      ls.map((l) => (l.id === id ? { ...l, blend: value } : l)),
    );
    this.render();
  }

  moveLayer(id: string, dir: -1 | 1): void {
    const ls = [...this.store.layers()];
    const i = ls.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ls.length) return;
    [ls[i], ls[j]] = [ls[j], ls[i]];
    this.store.layers.set(ls);
    this.render();
  }

  clearActiveLayer(): void {
    const layer = this.store.activeLayer();
    if (!layer) return;
    const before = this.snapshot(layer);
    layer.ctx.clearRect(0, 0, this.width, this.height);
    layer.shapes = [];
    const after = this.snapshot(layer);
    this.pushHistory({ layerId: layer.id, before, after });
    this.render();
  }

  // =========================================================================
  // Rendering / compositing
  // =========================================================================
  private render(): void {
    this.bctx.setTransform(1, 0, 0, 1, 0, 0);
    this.bctx.clearRect(0, 0, this.board.width, this.board.height);
    // checkerboard for transparency
    this.paintCheckerboard();
    const activeId = this.store.activeLayerId();
    for (const layer of this.store.layers()) {
      if (!layer.visible || layer.opacity <= 0) continue;
      // composite this layer's raster + shapes (+ live stroke) into the buffer
      // at full alpha, then blit once at the layer's opacity/blend.
      const bx = this.lbctx;
      bx.setTransform(1, 0, 0, 1, 0, 0);
      bx.globalAlpha = 1;
      bx.globalCompositeOperation = 'source-over';
      bx.clearRect(0, 0, this.layerBuf.width, this.layerBuf.height);
      bx.drawImage(layer.canvas, 0, 0);
      this.drawShapesToCtx(bx, layer.shapes);
      // live preview of the in-progress freehand stroke, at its final opacity
      if (this.strokeBuffer && layer.id === activeId) {
        bx.globalAlpha = this.store.outlineOpacity();
        bx.drawImage(this.strokeBuffer, 0, 0);
        bx.globalAlpha = 1;
      }

      this.bctx.globalAlpha = layer.opacity;
      this.bctx.globalCompositeOperation = layer.blend;
      this.bctx.drawImage(this.layerBuf, 0, 0);
    }
    this.bctx.globalAlpha = 1;
    this.bctx.globalCompositeOperation = 'source-over';
  }

  /** draw a layer's retained shapes onto a device-resolution context */
  private drawShapesToCtx(ctx: CanvasRenderingContext2D, shapes: ShapeObject[]): void {
    for (const s of shapes) drawShapeObject(ctx, s, this.dpr);
  }

  private paintCheckerboard(): void {
    const size = 16 * this.dpr;
    const w = this.board.width;
    const h = this.board.height;
    this.bctx.fillStyle = '#ffffff';
    this.bctx.fillRect(0, 0, w, h);
    this.bctx.fillStyle = '#e9eaee';
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        if (((x / size) + (y / size)) % 2 === 0) {
          this.bctx.fillRect(x, y, size, size);
        }
      }
    }
  }

  // =========================================================================
  // Canvas background (the 'Background' layer)
  // =========================================================================
  private backgroundLayer(): Layer | undefined {
    return this.store.layers().find((l) => l.name === 'Background');
  }

  /** repaint the background layer from the current bg* settings, then redraw */
  applyBackground(): void {
    const bg = this.backgroundLayer();
    if (bg) this.paintBackground(bg);
    this.render();
  }

  /** paint the chosen background (color / texture / image) onto a layer */
  private paintBackground(layer: Layer): void {
    const ctx = layer.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);

    if (this.store.bgKind() === 'image' && this.bgImageEl) {
      // opaque base under any transparent image, then cover-fit
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      const img = this.bgImageEl;
      const ir = img.width / img.height;
      const cr = w / h;
      let dw: number;
      let dh: number;
      if (ir > cr) {
        dh = h;
        dw = h * ir;
      } else {
        dw = w;
        dh = w / ir;
      }
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      return;
    }

    if (this.store.bgKind() === 'texture') {
      paintTexture(ctx, this.store.bgTexture(), w, h);
      return;
    }

    // solid color (also the fallback when 'image' has no file yet)
    ctx.fillStyle = this.store.bgKind() === 'image' ? '#ffffff' : this.store.bgColor();
    ctx.fillRect(0, 0, w, h);
  }

  setBgKind(k: 'color' | 'texture' | 'image'): void {
    this.store.bgKind.set(k);
    this.applyBackground();
  }
  setBgColor(c: string): void {
    this.store.bgColor.set(c);
    this.store.bgKind.set('color');
    this.applyBackground();
  }
  setBgTexture(t: BgTexture): void {
    this.store.bgTexture.set(t);
    this.store.bgKind.set('texture');
    this.applyBackground();
  }
  onBgImage(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      const img = new Image();
      img.onload = () => {
        this.bgImageEl = img;
        this.store.bgImageUrl.set(url);
        this.store.bgKind.set('image');
        this.applyBackground();
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  }
  removeBgImage(): void {
    this.bgImageEl = null;
    this.store.bgImageUrl.set(null);
    this.store.bgKind.set('color');
    this.applyBackground();
  }

  // =========================================================================
  // Resize
  // =========================================================================
  private resizeToStage(initial: boolean): void {
    const rect = this.stageRef.nativeElement.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (!initial && w === this.width && h === this.height) return;

    const oldLayers = this.store.layers();
    const oldW = this.width;
    const oldH = this.height;
    this.width = w;
    this.height = h;

    this.board.width = Math.round(w * this.dpr);
    this.board.height = Math.round(h * this.dpr);
    this.board.style.width = w + 'px';
    this.board.style.height = h + 'px';

    // keep the per-layer composite buffer matched to the board size
    if (!this.layerBuf) {
      this.layerBuf = document.createElement('canvas');
      this.lbctx = this.layerBuf.getContext('2d')!;
    }
    this.layerBuf.width = this.board.width;
    this.layerBuf.height = this.board.height;

    if (!initial && oldLayers.length) {
      // re-create layer bitmaps at the new size, preserving content
      const migrated = oldLayers.map((l) => {
        const nl = this.makeLayer(l.name);
        nl.id = l.id;
        nl.visible = l.visible;
        nl.opacity = l.opacity;
        nl.blend = l.blend;
        // shapes are resolution-independent objects — carry them across as-is
        nl.shapes = l.shapes;
        if (l.name === 'Background') {
          // background is procedural — repaint fresh at the new size instead
          // of copying the old bitmap (which would leave the grown area blank)
          this.paintBackground(nl);
        } else {
          nl.ctx.drawImage(l.canvas, 0, 0, oldW, oldH, 0, 0, oldW, oldH);
        }
        return nl;
      });
      this.store.layers.set(migrated);
      // history references old bitmaps; drop it to stay consistent
      this.undoStack = [];
      this.redoStack = [];
      this.syncHistoryFlags();
      this.render();
    }
  }

  // =========================================================================
  // Pointer handling
  // =========================================================================
  private toStagePoint(ev: PointerEvent): Point {
    const rect = this.board.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) / this.store.zoom(),
      y: (ev.clientY - rect.top) / this.store.zoom(),
    };
  }

  onPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    // first finger/pen/mouse wins; ignore additional touch points
    if (this.activePointerId !== null) return;
    this.activePointerId = ev.pointerId;
    // tapping the canvas dismisses transient floating menus
    if (this.store.colorPickerOpen()) this.store.colorPickerOpen.set(false);
    if (this.store.backgroundOpen()) this.store.backgroundOpen.set(false);
    if (this.store.moreOpen()) this.store.moreOpen.set(false);
    if (this.store.openGroup()) this.store.openGroup.set(null);
    const tool = this.store.activeTool();
    const p = this.toStagePoint(ev);

    if (tool === 'move') {
      this.drawing = true;
      this.start = { x: ev.clientX, y: ev.clientY };
      this.board.setPointerCapture(ev.pointerId);
      return;
    }

    if (tool === 'eyedropper') {
      this.sampleColor(p);
      return;
    }

    if (tool === 'text') {
      this.beginText(p);
      return;
    }

    const layer = this.store.activeLayer();
    if (!layer) return;

    this.board.setPointerCapture(ev.pointerId);
    this.drawing = true;
    this.start = p;
    this.last = p;
    this.points = [p];
    this.snapshotBefore = this.snapshot(layer);

    if (tool === 'fill') {
      // a click on a retained shape fills that whole shape (no gaps to leak
      // through); otherwise fall back to a pixel flood fill.
      const shape = this.hitTestShape(layer, p);
      if (shape) {
        shape.fill = this.store.fillColor();
        shape.fillOpacity = this.store.fillOpacity();
      } else {
        this.floodFill(layer, p);
      }
      this.commitStroke(layer);
      this.drawing = false;
      return;
    }

    if (tool === 'pen' || tool === 'brush') {
      this.initStrokeBuffer();
      this.prevMid = p;
      this.strokeSegment(layer, p, p);
      this.render();
    } else if (tool === 'eraser') {
      this.prevMid = p;
      this.strokeSegment(layer, p, p);
      this.render();
    }
  }

  onPointerMove(ev: PointerEvent): void {
    if (!this.drawing || ev.pointerId !== this.activePointerId) return;
    const tool = this.store.activeTool();

    if (tool === 'move') {
      const dx = ev.clientX - this.start.x;
      const dy = ev.clientY - this.start.y;
      this.store.panX.update((v) => v + dx);
      this.store.panY.update((v) => v + dy);
      this.start = { x: ev.clientX, y: ev.clientY };
      return;
    }

    const layer = this.store.activeLayer();
    if (!layer) return;

    if (tool === 'pen' || tool === 'brush' || tool === 'eraser') {
      // Replay every sample the device captured between frames — browsers
      // coalesce these into one pointermove, so reading only ev.clientX would
      // throw away most of the stroke and leave long, angular segments.
      const batch = ev.getCoalescedEvents?.() ?? [];
      const samples = batch.length ? batch : [ev];
      for (const e of samples) {
        this.freehandSample(layer, this.toStagePoint(e));
      }
      this.render();
    } else if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      // live preview drawn straight onto the composited board
      const p = this.toStagePoint(ev);
      this.render();
      this.drawShape(this.bctx, tool, this.start, p, this.dpr);
    }
  }

  /** advance a freehand stroke by one sample point */
  private freehandSample(layer: Layer, p: Point): void {
    this.points.push(p);
    if (this.store.activeTool() === 'pen') {
      this.penSmoothTo(p);
    } else {
      // brush + eraser keep their direction-dependent straight segments,
      // which are now fed the dense coalesced samples for smoother results.
      this.strokeSegment(layer, this.last, p);
      this.last = p;
    }
  }

  /**
   * Smooth pen stroke: draw a quadratic curve from the previous midpoint to the
   * new midpoint, using the raw sample as the control point. Curving through the
   * midpoints of consecutive samples turns the jagged sample polyline into a
   * continuous line with no visible corners.
   */
  private penSmoothTo(p: Point): void {
    const ctx = this.sbctx;
    if (!ctx) return;
    const mid = { x: (this.last.x + p.x) / 2, y: (this.last.y + p.y) / 2 };
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.store.outlineColor();
    ctx.lineWidth = this.penWidthFor(this.last, p);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.prevMid.x, this.prevMid.y);
    ctx.quadraticCurveTo(this.last.x, this.last.y, mid.x, mid.y);
    ctx.stroke();
    this.prevMid = mid;
    this.last = p;
  }

  /** stroke width for the current pen nib over one segment a -> b */
  private penWidthFor(a: Point, b: Point): number {
    const w = this.store.lineWidth();
    switch (this.store.penStyle()) {
      case 'fine':
        return Math.max(0.75, w * 0.5);
      case 'bold':
        return w * 1.7;
      case 'fountain': {
        // faster travel = thinner, like a flowing nib running out of ink
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const taper = Math.max(0.3, Math.min(1, 1 - len / 130));
        return Math.max(0.75, w * taper);
      }
      default:
        return w;
    }
  }

  onPointerUp(ev: PointerEvent): void {
    if (ev.pointerId !== this.activePointerId) return;
    this.activePointerId = null;
    if (!this.drawing) return;
    const tool = this.store.activeTool();
    const layer = this.store.activeLayer();

    if (tool === 'move') {
      this.drawing = false;
      return;
    }
    if (!layer) {
      this.drawing = false;
      return;
    }
    const p = this.toStagePoint(ev);

    if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      // shapes are retained as objects (not baked into the raster) so they can
      // be hit-tested and filled as a whole later.
      layer.shapes = [...layer.shapes, this.makeShape(tool, this.start, p)];
    } else if (tool === 'pen' && this.sbctx) {
      // finish the smoothed curve at the true last point (the last quadratic
      // only reached the midpoint of the final pair of samples).
      const ctx = this.sbctx;
      ctx.beginPath();
      ctx.moveTo(this.prevMid.x, this.prevMid.y);
      ctx.lineTo(this.last.x, this.last.y);
      ctx.stroke();
    }
    this.commitStroke(layer);
    this.drawing = false;
    this.render();
  }

  // =========================================================================
  // Drawing primitives
  // =========================================================================
  private initStrokeBuffer(): void {
    const c = document.createElement('canvas');
    c.width = Math.round(this.width * this.dpr);
    c.height = Math.round(this.height * this.dpr);
    const ctx = c.getContext('2d')!;
    ctx.scale(this.dpr, this.dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.strokeBuffer = c;
    this.sbctx = ctx;
  }

  private strokeSegment(layer: Layer, a: Point, b: Point): void {
    const tool = this.store.activeTool();

    // eraser cuts straight into the layer (round eraser tip)
    if (tool === 'eraser') {
      const ctx = layer.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.lineWidth = this.store.lineWidth();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // soft nib feathers its edge with a blur proportional to the tip size
      if (this.store.eraserStyle() === 'soft') {
        ctx.filter = `blur(${Math.max(2, this.store.lineWidth() * 0.3)}px)`;
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // pen & brush paint opaque onto the stroke buffer
    const ctx = this.sbctx;
    if (!ctx) return;
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.store.outlineColor();
    ctx.strokeStyle = this.store.outlineColor();

    if (tool === 'brush') {
      paintBrushSegment(ctx, this.store.brushStyle(), a, b, {
        color: this.store.outlineColor(),
        width: this.store.lineWidth(),
        nibAngle: this.nibAngle,
      });
      ctx.globalAlpha = 1;
      return;
    }

    // pen: clean round stroke
    ctx.lineWidth = this.store.lineWidth();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  /** live shape preview using the current tool's stroke/fill settings */
  private drawShape(ctx: CanvasRenderingContext2D, tool: ShapeTool, a: Point, b: Point, dpr: number): void {
    ctx.save();
    ctx.scale(dpr, dpr);
    drawShapePath(ctx, tool, a, b, {
      stroke: this.store.outlineColor(),
      strokeWidth: this.store.lineWidth(),
      strokeOpacity: this.store.outlineOpacity(),
      fill: this.store.fillColor(),
      fillOpacity: this.store.fillOpacity(),
    });
    ctx.restore();
  }

  // =========================================================================
  // Retained shapes (line / rect / ellipse as objects)
  // =========================================================================
  private makeShape(tool: ShapeTool, a: Point, b: Point): ShapeObject {
    return {
      id: nextId(),
      tool,
      a: { ...a },
      b: { ...b },
      stroke: this.store.outlineColor(),
      strokeWidth: this.store.lineWidth(),
      strokeOpacity: this.store.outlineOpacity(),
      fill: this.store.fillColor(),
      fillOpacity: this.store.fillOpacity(),
    };
  }

  /** topmost fillable shape (rect/ellipse) under the point, or null */
  private hitTestShape(layer: Layer, p: Point): ShapeObject | null {
    for (let i = layer.shapes.length - 1; i >= 0; i--) {
      const s = layer.shapes[i];
      if (s.tool === 'line') continue; // lines enclose no region to fill
      if (pointInShape(s, p)) return s;
    }
    return null;
  }

  private floodFill(layer: Layer, p: Point): void {
    const ctx = layer.ctx;
    const W = layer.canvas.width;
    const H = layer.canvas.height;
    const sx = Math.floor(p.x * this.dpr);
    const sy = Math.floor(p.y * this.dpr);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
    const img = ctx.getImageData(0, 0, W, H);
    floodFill(img, sx, sy, rgbaFromColor(this.store.fillColor(), this.store.fillOpacity()), this.store.fillTolerance());
    ctx.putImageData(img, 0, 0);
  }

  // =========================================================================
  // Eyedropper
  // =========================================================================
  private sampleColor(p: Point): void {
    const x = Math.floor(p.x * this.dpr);
    const y = Math.floor(p.y * this.dpr);
    const d = this.bctx.getImageData(x, y, 1, 1).data;
    const hex =
      '#' +
      [d[0], d[1], d[2]]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
    this.store.outlineColor.set(hex);
  }

  // =========================================================================
  // Text tool
  // =========================================================================
  private beginText(p: Point): void {
    this.textPos.set(p);
    this.textValue = '';
    this.textEditing.set(true);
    setTimeout(() => {
      const input = this.stageRef.nativeElement.querySelector<HTMLInputElement>(
        '.text-input',
      );
      input?.focus();
    });
  }

  commitText(): void {
    if (!this.textEditing()) return;
    const value = this.textValue.trim();
    this.textEditing.set(false);
    if (!value) return;
    const layer = this.store.activeLayer();
    if (!layer) return;
    const before = this.snapshot(layer);
    const ctx = layer.ctx;
    const p = this.textPos();
    ctx.globalAlpha = this.store.fillOpacity();
    ctx.fillStyle = this.store.fillColor();
    ctx.textBaseline = 'top';
    ctx.font = `${this.store.fontSize()}px ${this.store.fontStack()}`;
    ctx.fillText(value, p.x, p.y);
    ctx.globalAlpha = 1;
    const after = this.snapshot(layer);
    this.pushHistory({ layerId: layer.id, before, after });
    this.render();
  }

  cancelText(): void {
    this.textEditing.set(false);
  }

  // =========================================================================
  // History (undo / redo)
  // =========================================================================
  private snapshot(layer: Layer): LayerState {
    return {
      bitmap: layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height),
      shapes: this.cloneShapes(layer.shapes),
    };
  }

  private cloneShapes(shapes: ShapeObject[]): ShapeObject[] {
    return shapes.map((s) => ({ ...s, a: { ...s.a }, b: { ...s.b } }));
  }

  private restore(layer: Layer, state: LayerState): void {
    layer.ctx.putImageData(state.bitmap, 0, 0);
    layer.shapes = this.cloneShapes(state.shapes);
  }

  private commitStroke(layer: Layer): void {
    // flatten the freehand stroke buffer onto the layer, once, at the opacity.
    // The buffer is already at device resolution, so blit with an identity
    // transform — the layer ctx is otherwise pre-scaled by dpr, which would
    // re-scale and offset the stroke.
    if (this.strokeBuffer) {
      const ctx = layer.ctx;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = this.store.outlineOpacity();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.strokeBuffer, 0, 0);
      ctx.restore();
      this.strokeBuffer = null;
      this.sbctx = null;
    }
    if (!this.snapshotBefore) return;
    const after = this.snapshot(layer);
    this.pushHistory({ layerId: layer.id, before: this.snapshotBefore, after });
    this.snapshotBefore = null;
  }

  private pushHistory(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = [];
    this.syncHistoryFlags();
  }

  private syncHistoryFlags(): void {
    this.store.canUndo.set(this.undoStack.length > 0);
    this.store.canRedo.set(this.redoStack.length > 0);
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    const layer = this.store.layers().find((l) => l.id === entry.layerId);
    if (layer) this.restore(layer, entry.before);
    this.redoStack.push(entry);
    this.syncHistoryFlags();
    this.render();
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    const layer = this.store.layers().find((l) => l.id === entry.layerId);
    if (layer) this.restore(layer, entry.after);
    this.undoStack.push(entry);
    this.syncHistoryFlags();
    this.render();
  }

  // =========================================================================
  // Export / actions
  // =========================================================================
  exportPng(): void {
    const out = document.createElement('canvas');
    out.width = this.board.width;
    out.height = this.board.height;
    const octx = out.getContext('2d')!;
    for (const layer of this.store.layers()) {
      if (!layer.visible || layer.opacity <= 0) continue;
      // composite raster + shapes for the layer, then blit at its opacity/blend
      const bx = this.lbctx;
      bx.setTransform(1, 0, 0, 1, 0, 0);
      bx.globalAlpha = 1;
      bx.globalCompositeOperation = 'source-over';
      bx.clearRect(0, 0, this.layerBuf.width, this.layerBuf.height);
      bx.drawImage(layer.canvas, 0, 0);
      this.drawShapesToCtx(bx, layer.shapes);

      octx.globalAlpha = layer.opacity;
      octx.globalCompositeOperation = layer.blend;
      octx.drawImage(this.layerBuf, 0, 0);
    }
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = 'drawing.png';
    a.click();
  }

  clearAll(): void {
    for (const layer of this.store.layers()) {
      if (layer.name === 'Background') {
        this.paintBackground(layer);
      } else {
        layer.ctx.clearRect(0, 0, this.width, this.height);
      }
      layer.shapes = [];
    }
    this.undoStack = [];
    this.redoStack = [];
    this.syncHistoryFlags();
    this.render();
  }

  resetView(): void {
    this.store.zoom.set(1);
    this.store.panX.set(0);
    this.store.panY.set(0);
  }

  zoomBy(factor: number): void {
    this.store.zoom.update((z) => Math.min(6, Math.max(0.2, z * factor)));
  }

  // ---- left-edge vertical sliders (touch + mouse) ----
  private sliderRect: DOMRect | null = null;

  sliderDown(kind: 'size' | 'opacity', ev: PointerEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.store.activeSlider.set(kind);
    this.sliderRect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    this.applySlider(ev.clientX);
  }

  private applySlider(clientX: number): void {
    const r = this.sliderRect;
    const kind = this.store.activeSlider();
    if (!r || !kind) return;
    // left of the track = minimum
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    if (kind === 'size') {
      this.store.lineWidth.set(Math.round(1 + frac * (80 - 1)));
    } else {
      this.store.outlineOpacity.set(Math.round(frac * 100) / 100);
    }
  }

  @HostListener('window:pointermove', ['$event'])
  onWindowPointerMove(ev: PointerEvent): void {
    if (!this.store.activeSlider()) return;
    this.applySlider(ev.clientX);
  }
  @HostListener('window:pointerup')
  onWindowPointerUp(): void {
    this.store.activeSlider.set(null);
    this.sliderRect = null;
  }

  // ---- keyboard shortcuts ----
  @HostListener('window:keydown', ['$event'])
  onKeyDown(ev: KeyboardEvent): void {
    if (this.textEditing()) return;
    const target = ev.target as HTMLElement;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      this.redo();
      return;
    }
    if (ev.key === '[') this.store.lineWidth.update((w) => Math.max(1, w - 2));
    if (ev.key === ']') this.store.lineWidth.update((w) => Math.min(80, w + 2));
    const tool = this.store.tools.find((t) => t.shortcut.toLowerCase() === ev.key.toLowerCase());
    if (tool) this.store.setTool(tool.id);
  }

  // suppress the long-press / right-click context menu so touch drawing is clean
  @HostListener('contextmenu', ['$event'])
  onContextMenu(ev: Event): void {
    ev.preventDefault();
  }
}
