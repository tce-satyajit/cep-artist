import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  BLEND_MODES,
  BRUSHES,
  BlendMode,
  BrushStyle,
  HistoryEntry,
  Layer,
  PENS,
  PenStyle,
  Point,
  TOOLS,
  ToolDef,
  ToolId,
} from './models';

let uid = 0;
const nextId = () => `layer-${++uid}`;

const ICONS: Record<string, string> = {
  move: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M3 21l3.5-.8L20 6.7a2 2 0 0 0 0-2.8l-.9-.9a2 2 0 0 0-2.8 0L3 16.5 3 21z"/><path d="M14.5 5.5l4 4"/></svg>',
  brush: '<svg viewBox="0 0 24 24"><path d="M3 21c3 0 5-1.5 5-4 0-1.5-1-2.5-2.5-2.5S3 15.5 3 17c0 2 0 4 0 4z"/><path d="M8 15L19 4a2 2 0 0 1 3 3L11 18"/></svg>',
  eraser: '<svg viewBox="0 0 24 24"><path d="M4 15l7-7 6 6-4 4H8l-4-4z"/><path d="M11 8l5-5a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3l-5 5"/><path d="M6 21h14"/></svg>',
  line: '<svg viewBox="0 0 24 24"><path d="M4 20L20 4"/><circle cx="4" cy="20" r="1.6"/><circle cx="20" cy="4" r="1.6"/></svg>',
  rect: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>',
  ellipse: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="6"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 6h14M12 6v13M9 19h6"/></svg>',
  fill: '<svg viewBox="0 0 24 24"><path d="M4 11l7-7 8 8-7 7a2 2 0 0 1-3 0l-5-5a2 2 0 0 1 0-3z"/><path d="M11 4l2 2"/><path d="M20 15c0 1.5-1 3-1 3s-1-1.5-1-3a1 1 0 0 1 2 0z"/></svg>',
  eyedropper: '<svg viewBox="0 0 24 24"><path d="M4 20l1-4 9-9 3 3-9 9-4 1z"/><path d="M14 5l2-2a2 2 0 0 1 3 3l-2 2"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 7L4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 0 10h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M15 7l5 5-5 5"/><path d="M20 12H9a5 5 0 0 0 0 10h3"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M5 8h9M18 8h1M5 16h1M10 16h9"/><circle cx="16" cy="8" r="2.2"/><circle cx="8" cy="16" r="2.2"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 20h14"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  eyeoff: '<svg viewBox="0 0 24 24"><path d="M4 4l16 16"/><path d="M9.5 9.6a2.6 2.6 0 0 0 3.5 3.7M6.3 6.4C3.9 7.9 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.5 4.5-1.1M10 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.4 3.2"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

@Component({
  selector: 'artist-board',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './artist-board.html',
  styleUrl: './artist-board.scss',
})
export class ArtistBoard implements AfterViewInit, OnDestroy {
  private sanitizer = inject(DomSanitizer);
  private iconCache = new Map<string, SafeHtml>();

  iconFor(name: string): SafeHtml {
    let cached = this.iconCache.get(name);
    if (!cached) {
      cached = this.sanitizer.bypassSecurityTrustHtml(ICONS[name] ?? '');
      this.iconCache.set(name, cached);
    }
    return cached;
  }

  @ViewChild('stage', { static: true }) stageRef!: ElementRef<HTMLDivElement>;
  @ViewChild('board', { static: true }) boardRef!: ElementRef<HTMLCanvasElement>;

  readonly tools = TOOLS;
  readonly blendModes = BLEND_MODES;
  readonly brushes = BRUSHES;
  readonly pens = PENS;

  /**
   * Dock buttons. Each is its own tool. A button may carry a submenu holding
   * that tool's OPTIONS — the Pen exposes its nibs, the Brush its styles,
   * Shapes their variants.
   */
  readonly dock: {
    id: string;
    icon: string;
    tool: ToolId;
    members?: ToolId[]; // shape variants (each is its own tool)
    brushStyles?: boolean; // submenu shows the brush styles
    penStyles?: boolean; // submenu shows the pen styles
  }[] = [
    { id: 'move', icon: 'move', tool: 'move' },
    { id: 'pen', icon: 'pen', tool: 'pen', penStyles: true },
    { id: 'brush', icon: 'brush', tool: 'brush', brushStyles: true },
    { id: 'eraser', icon: 'eraser', tool: 'eraser' },
    { id: 'shapes', icon: 'rect', tool: 'rect', members: ['line', 'rect', 'ellipse'] },
    { id: 'text', icon: 'text', tool: 'text' },
    { id: 'fill', icon: 'fill', tool: 'fill' },
    { id: 'eyedropper', icon: 'eyedropper', tool: 'eyedropper' },
  ];
  private lastShape: ToolId = 'rect';
  readonly openGroup = signal<string | null>(null);

  // ---- reactive UI state ----
  readonly activeTool = signal<ToolId>('pen');
  readonly outlineColor = signal('#101114');
  readonly fillColor = signal('#f7c6cf');
  readonly outlineOpacity = signal(1);
  readonly fillOpacity = signal(0.56);
  readonly lineWidth = signal(8);
  readonly blend = signal<BlendMode>('source-over');
  readonly fontSize = signal(42);
  readonly brushStyle = signal<BrushStyle>('ink');
  readonly penStyle = signal<PenStyle>('medium');

  readonly layers = signal<Layer[]>([]);
  readonly activeLayerId = signal<string>('');
  readonly layersPanelOpen = signal(false);
  readonly settingsOpen = signal(false);
  readonly colorPickerOpen = signal(false);
  readonly moreOpen = signal(false);

  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);

  // text-input overlay
  readonly textEditing = signal(false);
  readonly textPos = signal<Point>({ x: 0, y: 0 });
  textValue = '';

  // left-edge size / opacity sliders (Procreate-style)
  readonly activeSlider = signal<'size' | 'opacity' | null>(null);
  readonly sizePct = computed(() => ((this.lineWidth() - 1) / (80 - 1)) * 100);
  readonly opacityPct = computed(() => this.outlineOpacity() * 100);

  readonly activeToolDef = computed<ToolDef>(
    () => this.tools.find((t) => t.id === this.activeTool()) ?? this.tools[0],
  );
  readonly activeLayer = computed<Layer | undefined>(
    () => this.layers().find((l) => l.id === this.activeLayerId()),
  );
  /** layers rendered top-to-bottom in the panel */
  readonly layersReversed = computed(() => [...this.layers()].reverse());

  // ---- engine internals ----
  private board!: HTMLCanvasElement;
  private bctx!: CanvasRenderingContext2D;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private width = 0; // css px
  private height = 0;

  private drawing = false;
  private start: Point = { x: 0, y: 0 };
  private last: Point = { x: 0, y: 0 };
  // trailing midpoint of the smoothed pen curve (quadratic-through-midpoints)
  private prevMid: Point = { x: 0, y: 0 };
  private points: Point[] = [];
  private snapshotBefore: ImageData | null = null;

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
    bg.ctx.fillStyle = '#ffffff';
    bg.ctx.fillRect(0, 0, this.width, this.height);
    const l1 = this.makeLayer('Layer 1');
    this.layers.set([bg, l1]);
    this.activeLayerId.set(l1.id);
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
    };
  }

  addLayer(): void {
    const l = this.makeLayer(`Layer ${this.layers().length}`);
    this.layers.update((ls) => [...ls, l]);
    this.activeLayerId.set(l.id);
    this.render();
  }

  deleteLayer(id: string): void {
    const ls = this.layers();
    if (ls.length <= 1) return;
    const idx = ls.findIndex((l) => l.id === id);
    const next = ls.filter((l) => l.id !== id);
    this.layers.set(next);
    if (this.activeLayerId() === id) {
      this.activeLayerId.set(next[Math.max(0, idx - 1)].id);
    }
    this.undoStack = this.undoStack.filter((e) => e.layerId !== id);
    this.redoStack = this.redoStack.filter((e) => e.layerId !== id);
    this.syncHistoryFlags();
    this.render();
  }

  selectLayer(id: string): void {
    this.activeLayerId.set(id);
  }

  toggleLayerVisible(id: string): void {
    this.layers.update((ls) =>
      ls.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    );
    this.render();
  }

  setLayerOpacity(id: string, value: number): void {
    this.layers.update((ls) =>
      ls.map((l) => (l.id === id ? { ...l, opacity: value } : l)),
    );
    this.render();
  }

  setLayerBlend(id: string, value: BlendMode): void {
    this.layers.update((ls) =>
      ls.map((l) => (l.id === id ? { ...l, blend: value } : l)),
    );
    this.render();
  }

  moveLayer(id: string, dir: -1 | 1): void {
    const ls = [...this.layers()];
    const i = ls.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ls.length) return;
    [ls[i], ls[j]] = [ls[j], ls[i]];
    this.layers.set(ls);
    this.render();
  }

  clearActiveLayer(): void {
    const layer = this.activeLayer();
    if (!layer) return;
    const before = this.snapshot(layer);
    layer.ctx.clearRect(0, 0, this.width, this.height);
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
    const activeId = this.activeLayerId();
    for (const layer of this.layers()) {
      if (!layer.visible || layer.opacity <= 0) continue;
      this.bctx.globalAlpha = layer.opacity;
      this.bctx.globalCompositeOperation = layer.blend;
      this.bctx.drawImage(layer.canvas, 0, 0);
      // live preview of the in-progress freehand stroke, sitting on the active
      // layer at the final opacity so what you see is what you commit.
      if (this.strokeBuffer && layer.id === activeId) {
        this.bctx.globalAlpha = layer.opacity * this.outlineOpacity();
        this.bctx.drawImage(this.strokeBuffer, 0, 0);
      }
    }
    this.bctx.globalAlpha = 1;
    this.bctx.globalCompositeOperation = 'source-over';
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
  // Resize
  // =========================================================================
  private resizeToStage(initial: boolean): void {
    const rect = this.stageRef.nativeElement.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (!initial && w === this.width && h === this.height) return;

    const oldLayers = this.layers();
    const oldW = this.width;
    const oldH = this.height;
    this.width = w;
    this.height = h;

    this.board.width = Math.round(w * this.dpr);
    this.board.height = Math.round(h * this.dpr);
    this.board.style.width = w + 'px';
    this.board.style.height = h + 'px';

    if (!initial && oldLayers.length) {
      // re-create layer bitmaps at the new size, preserving content
      const migrated = oldLayers.map((l) => {
        const nl = this.makeLayer(l.name);
        nl.id = l.id;
        nl.visible = l.visible;
        nl.opacity = l.opacity;
        nl.blend = l.blend;
        if (l.name === 'Background') {
          // the paper always fills the whole board, even when it grows
          nl.ctx.fillStyle = '#ffffff';
          nl.ctx.fillRect(0, 0, w, h);
        }
        nl.ctx.drawImage(l.canvas, 0, 0, oldW, oldH, 0, 0, oldW, oldH);
        return nl;
      });
      this.layers.set(migrated);
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
      x: (ev.clientX - rect.left) / this.zoom(),
      y: (ev.clientY - rect.top) / this.zoom(),
    };
  }

  onPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    // first finger/pen/mouse wins; ignore additional touch points
    if (this.activePointerId !== null) return;
    this.activePointerId = ev.pointerId;
    // tapping the canvas dismisses transient floating menus
    if (this.settingsOpen()) this.settingsOpen.set(false);
    if (this.colorPickerOpen()) this.colorPickerOpen.set(false);
    if (this.moreOpen()) this.moreOpen.set(false);
    if (this.openGroup()) this.openGroup.set(null);
    const tool = this.activeTool();
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

    const layer = this.activeLayer();
    if (!layer) return;

    this.board.setPointerCapture(ev.pointerId);
    this.drawing = true;
    this.start = p;
    this.last = p;
    this.points = [p];
    this.snapshotBefore = this.snapshot(layer);

    if (tool === 'fill') {
      this.floodFill(layer, p);
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
    const tool = this.activeTool();

    if (tool === 'move') {
      const dx = ev.clientX - this.start.x;
      const dy = ev.clientY - this.start.y;
      this.panX.update((v) => v + dx);
      this.panY.update((v) => v + dy);
      this.start = { x: ev.clientX, y: ev.clientY };
      return;
    }

    const layer = this.activeLayer();
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
    if (this.activeTool() === 'pen') {
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
    ctx.strokeStyle = this.outlineColor();
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
    const w = this.lineWidth();
    switch (this.penStyle()) {
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
    const tool = this.activeTool();
    const layer = this.activeLayer();

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
      this.drawShape(layer.ctx, tool, this.start, p, 1);
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
    const tool = this.activeTool();

    // eraser cuts straight into the layer (round eraser tip)
    if (tool === 'eraser') {
      const ctx = layer.ctx;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.lineWidth = this.lineWidth();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    // pen & brush paint opaque onto the stroke buffer
    const ctx = this.sbctx;
    if (!ctx) return;
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.outlineColor();
    ctx.strokeStyle = this.outlineColor();

    if (tool === 'brush') {
      this.brushSegment(ctx, a, b);
      ctx.globalAlpha = 1;
      return;
    }

    // pen: clean round stroke
    ctx.lineWidth = this.lineWidth();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // =========================================================================
  // Natural-media brush engines. Each paints one segment (a -> b) onto the
  // stroke buffer. Textured brushes intentionally build up alpha within a
  // stroke (that IS the grain); the whole buffer is later flattened onto the
  // layer at the outline opacity.
  // =========================================================================
  private brushSegment(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
    const color = this.outlineColor();
    const w = this.lineWidth();
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 0.0001;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy; // unit normal
    const ny = ux;

    switch (this.brushStyle()) {
      case 'calligraphy': {
        // fixed-angle flat nib -> thick across the nib, thin along it
        const half = w / 2;
        const px = Math.cos(this.nibAngle) * half;
        const py = Math.sin(this.nibAngle) * half;
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
          ctx.arc(
            cx + Math.cos(ang) * rr,
            cy + Math.sin(ang) * rr,
            0.7 + Math.random() * 0.6,
            0,
            Math.PI * 2,
          );
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

  private drawShape(
    ctx: CanvasRenderingContext2D,
    tool: ToolId,
    a: Point,
    b: Point,
    dpr: number,
  ): void {
    ctx.save();
    ctx.scale(dpr, dpr);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.lineWidth = this.lineWidth();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    if (tool === 'line') {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    } else if (tool === 'rect') {
      ctx.rect(x, y, w, h);
    } else if (tool === 'ellipse') {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    }

    if (tool !== 'line') {
      ctx.globalAlpha = this.fillOpacity();
      ctx.fillStyle = this.fillColor();
      ctx.fill();
    }
    if (this.lineWidth() > 0) {
      ctx.globalAlpha = this.outlineOpacity();
      ctx.strokeStyle = this.outlineColor();
      ctx.stroke();
    }
    ctx.restore();
  }

  // =========================================================================
  // Flood fill (scanline, tolerance-based)
  // =========================================================================
  private floodFill(layer: Layer, p: Point): void {
    const ctx = layer.ctx;
    const W = layer.canvas.width;
    const H = layer.canvas.height;
    const sx = Math.floor(p.x * this.dpr);
    const sy = Math.floor(p.y * this.dpr);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;

    const img = ctx.getImageData(0, 0, W, H);
    const data = img.data;
    const target = this.pixelAt(data, (sy * W + sx) * 4);
    const fill = this.rgbaFromColor(this.fillColor(), this.fillOpacity());
    if (this.colorsEqual(target, fill, 2)) return;

    const tol = 32;
    const stack = [[sx, sy]];
    const matches = (idx: number) =>
      this.within(data, idx, target, tol);

    while (stack.length) {
      const [px, py] = stack.pop()!;
      let x = px;
      const rowStart = py * W;
      while (x >= 0 && matches((rowStart + x) * 4)) x--;
      x++;
      let up = false;
      let down = false;
      while (x < W && matches((rowStart + x) * 4)) {
        this.setPixel(data, (rowStart + x) * 4, fill);
        if (py > 0) {
          const upIdx = ((py - 1) * W + x) * 4;
          if (matches(upIdx)) {
            if (!up) {
              stack.push([x, py - 1]);
              up = true;
            }
          } else up = false;
        }
        if (py < H - 1) {
          const dnIdx = ((py + 1) * W + x) * 4;
          if (matches(dnIdx)) {
            if (!down) {
              stack.push([x, py + 1]);
              down = true;
            }
          } else down = false;
        }
        x++;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  private pixelAt(d: Uint8ClampedArray, i: number): number[] {
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }
  private setPixel(d: Uint8ClampedArray, i: number, c: number[]): void {
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = c[3];
  }
  private within(d: Uint8ClampedArray, i: number, t: number[], tol: number): boolean {
    return (
      Math.abs(d[i] - t[0]) <= tol &&
      Math.abs(d[i + 1] - t[1]) <= tol &&
      Math.abs(d[i + 2] - t[2]) <= tol &&
      Math.abs(d[i + 3] - t[3]) <= tol
    );
  }
  private colorsEqual(a: number[], b: number[], tol: number): boolean {
    return (
      Math.abs(a[0] - b[0]) <= tol &&
      Math.abs(a[1] - b[1]) <= tol &&
      Math.abs(a[2] - b[2]) <= tol &&
      Math.abs(a[3] - b[3]) <= tol
    );
  }
  private rgbaFromColor(hex: string, alpha: number): number[] {
    const c = hex.replace('#', '');
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return [r, g, b, Math.round(alpha * 255)];
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
    this.outlineColor.set(hex);
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
    const layer = this.activeLayer();
    if (!layer) return;
    const before = this.snapshot(layer);
    const ctx = layer.ctx;
    const p = this.textPos();
    ctx.globalAlpha = this.fillOpacity();
    ctx.fillStyle = this.fillColor();
    ctx.textBaseline = 'top';
    ctx.font = `${this.fontSize()}px "Inter", system-ui, sans-serif`;
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
  private snapshot(layer: Layer): ImageData {
    return layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
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
      ctx.globalAlpha = this.outlineOpacity();
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
    this.canUndo.set(this.undoStack.length > 0);
    this.canRedo.set(this.redoStack.length > 0);
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    const layer = this.layers().find((l) => l.id === entry.layerId);
    if (layer) layer.ctx.putImageData(entry.before, 0, 0);
    this.redoStack.push(entry);
    this.syncHistoryFlags();
    this.render();
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    const layer = this.layers().find((l) => l.id === entry.layerId);
    if (layer) layer.ctx.putImageData(entry.after, 0, 0);
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
    for (const layer of this.layers()) {
      if (!layer.visible || layer.opacity <= 0) continue;
      octx.globalAlpha = layer.opacity;
      octx.globalCompositeOperation = layer.blend;
      octx.drawImage(layer.canvas, 0, 0);
    }
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = 'drawing.png';
    a.click();
  }

  clearAll(): void {
    for (const layer of this.layers()) {
      if (layer.name === 'Background') {
        layer.ctx.clearRect(0, 0, this.width, this.height);
        layer.ctx.fillStyle = '#ffffff';
        layer.ctx.fillRect(0, 0, this.width, this.height);
      } else {
        layer.ctx.clearRect(0, 0, this.width, this.height);
      }
    }
    this.undoStack = [];
    this.redoStack = [];
    this.syncHistoryFlags();
    this.render();
  }

  resetView(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
  }

  zoomBy(factor: number): void {
    this.zoom.update((z) => Math.min(6, Math.max(0.2, z * factor)));
  }

  // =========================================================================
  // UI helpers
  // =========================================================================
  selectTool(id: ToolId): void {
    this.activeTool.set(id);
    if (id === 'line' || id === 'rect' || id === 'ellipse') this.lastShape = id;
    if (this.textEditing()) this.commitText();
  }

  // ---- tool dock + option submenus ----
  hasSubmenu(b: { members?: ToolId[]; brushStyles?: boolean; penStyles?: boolean }): boolean {
    return !!b.members || !!b.brushStyles || !!b.penStyles;
  }
  buttonActive(b: { tool: ToolId; members?: ToolId[] }): boolean {
    return b.members ? b.members.includes(this.activeTool()) : this.activeTool() === b.tool;
  }
  buttonIcon(b: { icon: string; members?: ToolId[] }): string {
    if (b.members) return b.members.includes(this.activeTool()) ? this.activeTool() : this.lastShape;
    return b.icon;
  }
  onDockClick(b: {
    id: string;
    tool: ToolId;
    members?: ToolId[];
    brushStyles?: boolean;
    penStyles?: boolean;
  }): void {
    // tapping the ACTIVE tool that has options opens its submenu
    if (this.hasSubmenu(b) && this.buttonActive(b)) {
      this.openGroup.set(this.openGroup() === b.id ? null : b.id);
      return;
    }
    // otherwise activate the tool
    this.selectTool(b.members ? this.lastShape : b.tool);
    this.openGroup.set(null);
  }
  pickShape(id: ToolId): void {
    this.selectTool(id);
    this.openGroup.set(null);
  }
  pickBrushStyle(id: BrushStyle): void {
    this.brushStyle.set(id);
    this.activeTool.set('brush');
    this.openGroup.set(null);
  }
  pickPenStyle(id: PenStyle): void {
    this.penStyle.set(id);
    this.activeTool.set('pen');
    this.openGroup.set(null);
  }
  toolName(id: ToolId): string {
    return this.tools.find((t) => t.id === id)?.name ?? id;
  }
  brushStyleName(): string {
    return this.brushes.find((b) => b.id === this.brushStyle())?.name ?? '';
  }
  penStyleName(): string {
    return this.pens.find((p) => p.id === this.penStyle())?.name ?? '';
  }

  toggleSettings(): void {
    this.openGroup.set(null);
    const next = !this.settingsOpen();
    this.settingsOpen.set(next);
    if (next) {
      this.layersPanelOpen.set(false);
      this.colorPickerOpen.set(false);
      this.moreOpen.set(false);
    }
  }
  toggleLayers(): void {
    this.openGroup.set(null);
    const next = !this.layersPanelOpen();
    this.layersPanelOpen.set(next);
    if (next) {
      this.settingsOpen.set(false);
      this.colorPickerOpen.set(false);
      this.moreOpen.set(false);
    }
  }
  toggleColor(): void {
    this.openGroup.set(null);
    const next = !this.colorPickerOpen();
    this.colorPickerOpen.set(next);
    if (next) {
      this.settingsOpen.set(false);
      this.layersPanelOpen.set(false);
      this.moreOpen.set(false);
    }
  }
  toggleMore(): void {
    this.openGroup.set(null);
    const next = !this.moreOpen();
    this.moreOpen.set(next);
    if (next) {
      this.settingsOpen.set(false);
      this.layersPanelOpen.set(false);
      this.colorPickerOpen.set(false);
    }
  }

  cursorForTool(): string {
    switch (this.activeTool()) {
      case 'move':
        return 'grab';
      case 'text':
        return 'text';
      case 'eyedropper':
      case 'fill':
        return 'crosshair';
      default:
        return 'crosshair';
    }
  }

  onOutlineOpacity(v: string): void {
    this.outlineOpacity.set(+v / 100);
  }
  onFillOpacity(v: string): void {
    this.fillOpacity.set(+v / 100);
  }
  onLineWidth(v: string): void {
    this.lineWidth.set(+v);
  }

  // ---- left-edge vertical sliders (touch + mouse) ----
  private sliderRect: DOMRect | null = null;

  sliderDown(kind: 'size' | 'opacity', ev: PointerEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.activeSlider.set(kind);
    this.sliderRect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    this.applySlider(ev.clientX);
  }

  private applySlider(clientX: number): void {
    const r = this.sliderRect;
    const kind = this.activeSlider();
    if (!r || !kind) return;
    // left of the track = minimum
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    if (kind === 'size') {
      this.lineWidth.set(Math.round(1 + frac * (80 - 1)));
    } else {
      this.outlineOpacity.set(Math.round(frac * 100) / 100);
    }
  }

  @HostListener('window:pointermove', ['$event'])
  onWindowPointerMove(ev: PointerEvent): void {
    if (!this.activeSlider()) return;
    this.applySlider(ev.clientX);
  }
  @HostListener('window:pointerup')
  onWindowPointerUp(): void {
    this.activeSlider.set(null);
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
    if (ev.key === '[') this.lineWidth.update((w) => Math.max(1, w - 2));
    if (ev.key === ']') this.lineWidth.update((w) => Math.min(80, w + 2));
    const tool = this.tools.find((t) => t.shortcut.toLowerCase() === ev.key.toLowerCase());
    if (tool) this.selectTool(tool.id);
  }

  // suppress the long-press / right-click context menu so touch drawing is clean
  @HostListener('contextmenu', ['$event'])
  onContextMenu(ev: Event): void {
    ev.preventDefault();
  }
}
