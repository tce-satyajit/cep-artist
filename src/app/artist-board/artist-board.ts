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
import { BgTexture, paintTexture } from './engine/textures';
import {
  drawObject,
  drawShapePath,
  hitTestObject,
  objectBounds,
  objectCenter,
  penWidthFor,
  ShapeTool,
} from './engine/shapes';
import { ArtistStore } from './store/artist-store';
import {
  BlendMode,
  CanvasObject,
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
      objects: [],
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
    layer.objects = [];
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
      this.drawObjectsToCtx(bx, layer.objects);
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
  private drawObjectsToCtx(ctx: CanvasRenderingContext2D, objects: CanvasObject[]): void {
    for (const o of objects) drawObject(ctx, o, this.dpr);
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
    // inset the board by an equal margin on all sides, wide enough for the
    // floating tool panels (dock / top / bottom bars) to sit in the gap.
    const pad = 10;
    const w = Math.max(1, Math.floor(rect.width - pad * 2));
    const h = Math.max(1, Math.floor(rect.height - pad * 2));
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

    if (!initial && oldLayers.length && oldW > 0 && oldH > 0) {
      // scale content UNIFORMLY (preserve aspect ratio) so drawings don't
      // distort when the window's aspect changes. Use the smaller ratio so
      // everything stays within the new board (no clipping).
      const k = Math.min(w / oldW, h / oldH);
      const migrated = oldLayers.map((l) => {
        const nl = this.makeLayer(l.name);
        nl.id = l.id;
        nl.visible = l.visible;
        nl.opacity = l.opacity;
        nl.blend = l.blend;
        // scale vector objects by the same factor so they track the raster
        nl.objects = l.objects.map((o) => this.scaleObject(o, k, k));
        if (l.name === 'Background') {
          // background is procedural — repaint fresh at the new size
          this.paintBackground(nl);
        } else {
          // scale the old bitmap uniformly (device px, identity transform so
          // the dpr scale on the layer ctx isn't applied twice)
          nl.ctx.save();
          nl.ctx.setTransform(1, 0, 0, 1, 0, 0);
          nl.ctx.drawImage(l.canvas, 0, 0, l.canvas.width * k, l.canvas.height * k);
          nl.ctx.restore();
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

  /** scale an object's geometry by (sx, sy) about the origin */
  private scaleObject(o: CanvasObject, sx: number, sy: number): CanvasObject {
    const s = (sx + sy) / 2;
    if (o.kind === 'shape') {
      return {
        ...o,
        a: { x: o.a.x * sx, y: o.a.y * sy },
        b: { x: o.b.x * sx, y: o.b.y * sy },
        strokeWidth: o.strokeWidth * s,
      };
    }
    return {
      ...o,
      points: o.points.map((p) => ({ x: p.x * sx, y: p.y * sy })),
      strokeWidth: o.strokeWidth * s,
    };
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

    if (tool === 'select') {
      // hit-test the active layer; select the topmost object and start moving
      // it in one gesture (deselect on empty space).
      const layer = this.store.activeLayer();
      const hit = layer ? this.objectAt(layer, p) : null;
      this.store.selectedId.set(hit?.id ?? null);
      if (hit && layer) this.beginXform('move', layer, hit, ev);
      this.activePointerId = null; // window listeners drive the transform
      return;
    }

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
    ctx.lineWidth = penWidthFor(this.store.penStyle(), this.store.lineWidth(), this.last, p);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.prevMid.x, this.prevMid.y);
    ctx.quadraticCurveTo(this.last.x, this.last.y, mid.x, mid.y);
    ctx.stroke();
    this.prevMid = mid;
    this.last = p;
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
      // be selected, filled, and transformed as a whole later.
      layer.objects = [...layer.objects, this.makeShape(tool, this.start, p)];
    } else if (tool === 'pen' && this.sbctx) {
      // pen is raster (so the natural eraser can erase it): finish the smoothed
      // curve at the true last point, then commitStroke bakes it into the layer.
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
      kind: 'shape',
      id: nextId(),
      tool,
      a: { ...a },
      b: { ...b },
      stroke: this.store.outlineColor(),
      strokeWidth: this.store.lineWidth(),
      strokeOpacity: this.store.outlineOpacity(),
      fill: this.store.fillColor(),
      fillOpacity: this.store.fillOpacity(),
      rotation: 0,
    };
  }


  /** topmost object under the point (for the select tool), or null */
  private objectAt(layer: Layer, p: Point): CanvasObject | null {
    for (let i = layer.objects.length - 1; i >= 0; i--) {
      if (hitTestObject(layer.objects[i], p)) return layer.objects[i];
    }
    return null;
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
      objects: this.cloneObjects(layer.objects),
    };
  }

  private cloneObjects(objects: CanvasObject[]): CanvasObject[] {
    return objects.map((o) =>
      o.kind === 'shape'
        ? { ...o, a: { ...o.a }, b: { ...o.b } }
        : { ...o, points: o.points.map((p) => ({ ...p })) },
    );
  }

  private restore(layer: Layer, state: LayerState): void {
    layer.ctx.putImageData(state.bitmap, 0, 0);
    layer.objects = this.cloneObjects(state.objects);
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
      this.drawObjectsToCtx(bx, layer.objects);

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
      layer.objects = [];
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
    if (this.xform) {
      this.applyXform(this.toStagePoint(ev));
      return;
    }
    if (!this.store.activeSlider()) return;
    this.applySlider(ev.clientX);
  }
  @HostListener('window:pointerup')
  onWindowPointerUp(): void {
    if (this.xform) this.commitXform();
    this.store.activeSlider.set(null);
    this.sliderRect = null;
  }

  // =========================================================================
  // Select tool: transform (move / resize / rotate / delete)
  // =========================================================================
  private xform: {
    mode: 'move' | 'resize' | 'rotate';
    layer: Layer;
    obj: CanvasObject;
    center: Point;
    angle: number;
    startPointer: Point;
    origShape?: { a: Point; b: Point };
    origPoints?: Point[];
    before: LayerState;
    moved: boolean;
  } | null = null;
  /** bumped on every transform step so the overlay box re-renders (CD tick) */
  readonly xformTick = signal(0);

  /** the currently selected object and the layer holding it */
  selectedObject(): { layer: Layer; obj: CanvasObject } | null {
    const id = this.store.selectedId();
    if (!id) return null;
    for (const layer of this.store.layers()) {
      const obj = layer.objects.find((o) => o.id === id);
      if (obj) return { layer, obj };
    }
    return null;
  }

  /** stage-relative box (px) for the selection overlay, or null */
  selBox(): { left: number; top: number; w: number; h: number; angle: number } | null {
    this.xformTick(); // reactive dependency so drags reposition the box
    if (this.store.activeTool() !== 'select') return null;
    const sel = this.selectedObject();
    if (!sel || !this.board) return null;
    const b = objectBounds(sel.obj);
    const z = this.store.zoom();
    const boardRect = this.board.getBoundingClientRect();
    const stageRect = this.stageRef.nativeElement.getBoundingClientRect();
    return {
      left: boardRect.left - stageRect.left + b.x * z,
      top: boardRect.top - stageRect.top + b.y * z,
      w: b.w * z,
      h: b.h * z,
      angle: sel.obj.rotation,
    };
  }

  startMove(ev: PointerEvent): void {
    const sel = this.selectedObject();
    if (sel) this.beginXform('move', sel.layer, sel.obj, ev);
  }
  startResize(ev: PointerEvent): void {
    const sel = this.selectedObject();
    if (sel) this.beginXform('resize', sel.layer, sel.obj, ev);
  }
  startRotate(ev: PointerEvent): void {
    const sel = this.selectedObject();
    if (sel) this.beginXform('rotate', sel.layer, sel.obj, ev);
  }

  deleteSelected(): void {
    const sel = this.selectedObject();
    if (!sel) return;
    const before = this.snapshot(sel.layer);
    sel.layer.objects = sel.layer.objects.filter((o) => o.id !== sel.obj.id);
    const after = this.snapshot(sel.layer);
    this.pushHistory({ layerId: sel.layer.id, before, after });
    this.store.selectedId.set(null);
    this.render();
  }

  private beginXform(mode: 'move' | 'resize' | 'rotate', layer: Layer, obj: CanvasObject, ev: PointerEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.xform = {
      mode,
      layer,
      obj,
      center: objectCenter(obj),
      angle: obj.rotation,
      startPointer: this.toStagePoint(ev),
      origShape: obj.kind === 'shape' ? { a: { ...obj.a }, b: { ...obj.b } } : undefined,
      origPoints: obj.kind === 'path' ? obj.points.map((p) => ({ ...p })) : undefined,
      before: this.snapshot(layer),
      moved: false,
    };
  }

  private toLocal(p: Point, c: Point, angle: number): Point {
    if (!angle) return p;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
  }

  private applyXform(pointer: Point): void {
    const x = this.xform;
    if (!x) return;
    x.moved = true;
    const o = x.obj;

    if (x.mode === 'rotate') {
      // rotate handle sits BELOW the box (rest angle +90°), so subtract it
      o.rotation = Math.atan2(pointer.y - x.center.y, pointer.x - x.center.x) - Math.PI / 2;
    } else if (x.mode === 'move') {
      const dx = pointer.x - x.startPointer.x;
      const dy = pointer.y - x.startPointer.y;
      if (o.kind === 'shape' && x.origShape) {
        o.a = { x: x.origShape.a.x + dx, y: x.origShape.a.y + dy };
        o.b = { x: x.origShape.b.x + dx, y: x.origShape.b.y + dy };
      } else if (o.kind === 'path' && x.origPoints) {
        o.points = x.origPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      }
    } else {
      // resize: scale geometry about the center, symmetric, in the local frame
      const local = this.toLocal(pointer, x.center, x.angle);
      const halfW = Math.max(4, Math.abs(local.x - x.center.x));
      const halfH = Math.max(4, Math.abs(local.y - x.center.y));
      const orig = x.origShape
        ? { hw: Math.abs(x.origShape.b.x - x.origShape.a.x) / 2, hh: Math.abs(x.origShape.b.y - x.origShape.a.y) / 2 }
        : this.pointsHalfExtents(x.origPoints!, x.center);
      const sx = orig.hw > 0.01 ? halfW / orig.hw : 1;
      const sy = orig.hh > 0.01 ? halfH / orig.hh : 1;
      if (x.origShape && o.kind === 'shape') {
        o.a = { x: x.center.x + (x.origShape.a.x - x.center.x) * sx, y: x.center.y + (x.origShape.a.y - x.center.y) * sy };
        o.b = { x: x.center.x + (x.origShape.b.x - x.center.x) * sx, y: x.center.y + (x.origShape.b.y - x.center.y) * sy };
      } else if (x.origPoints && o.kind === 'path') {
        o.points = x.origPoints.map((p) => ({ x: x.center.x + (p.x - x.center.x) * sx, y: x.center.y + (p.y - x.center.y) * sy }));
      }
    }
    this.xformTick.update((v) => v + 1);
    this.render();
  }

  private pointsHalfExtents(points: Point[], c: Point): { hw: number; hh: number } {
    let hw = 0;
    let hh = 0;
    for (const p of points) {
      hw = Math.max(hw, Math.abs(p.x - c.x));
      hh = Math.max(hh, Math.abs(p.y - c.y));
    }
    return { hw, hh };
  }

  private commitXform(): void {
    const x = this.xform;
    this.xform = null;
    if (!x || !x.moved) return;
    const after = this.snapshot(x.layer);
    this.pushHistory({ layerId: x.layer.id, before: x.before, after });
  }

  // =========================================================================
  // Selection properties (fill / stroke / size) — the context toolbar
  // =========================================================================
  private selEditBefore: LayerState | null = null;

  /** screen-space anchor (stage px) for the selection properties toolbar */
  selPanel(): { left: number; top: number } | null {
    const sb = this.selBox();
    if (!sb) return null;
    return { left: sb.left, top: Math.max(8, sb.top - 52) };
  }

  selIsShape(): boolean {
    return this.selectedObject()?.obj.kind === 'shape';
  }
  selFill(): string {
    const o = this.selectedObject()?.obj;
    return o?.kind === 'shape' ? o.fill : '#000000';
  }
  selStroke(): string {
    return this.selectedObject()?.obj.stroke ?? '#000000';
  }
  selStrokeWidth(): number {
    return this.selectedObject()?.obj.strokeWidth ?? 1;
  }

  /** mutate the selected object; `commit` pushes an undo step on final value */
  private editSelected(mutate: (o: CanvasObject) => void, commit: boolean): void {
    const sel = this.selectedObject();
    if (!sel) return;
    if (!this.selEditBefore) this.selEditBefore = this.snapshot(sel.layer);
    mutate(sel.obj);
    this.xformTick.update((v) => v + 1);
    this.render();
    if (commit && this.selEditBefore) {
      this.pushHistory({ layerId: sel.layer.id, before: this.selEditBefore, after: this.snapshot(sel.layer) });
      this.selEditBefore = null;
    }
  }

  setSelFill(color: string, commit: boolean): void {
    this.editSelected((o) => {
      if (o.kind === 'shape') o.fill = color;
    }, commit);
  }
  setSelStroke(color: string, commit: boolean): void {
    this.editSelected((o) => {
      o.stroke = color;
    }, commit);
  }
  setSelStrokeWidth(w: number, commit: boolean): void {
    this.editSelected((o) => {
      o.strokeWidth = w;
    }, commit);
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
    // select tool: delete removes the selection, escape deselects
    if (this.store.activeTool() === 'select' && this.store.selectedId()) {
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        this.deleteSelected();
        return;
      }
      if (ev.key === 'Escape') {
        this.store.selectedId.set(null);
        return;
      }
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
