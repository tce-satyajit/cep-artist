import { Injectable, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ICONS } from '../engine/icons';
import { BgTexture } from '../engine/textures';
import {
  BLEND_MODES,
  BRUSHES,
  BrushStyle,
  Layer,
  PENS,
  PenStyle,
  Point,
  TOOLS,
  ToolId,
} from '../models';

/** a dock (toolbar) button, optionally owning a submenu of options */
export interface DockButton {
  id: string;
  icon: string;
  tool: ToolId;
  members?: ToolId[]; // shape variants (each is its own tool)
  covers?: ToolId[]; // extra tools this button owns (offered in its submenu)
  brushStyles?: boolean; // submenu: pen nibs + brush styles
  eraserOpts?: boolean; // submenu: eraser edge
  textOpts?: boolean; // submenu: font family + size
  fillOpts?: boolean; // submenu: flood-fill tolerance
}

/** one selectable option inside a dock submenu */
export interface SubItem {
  id: string;
  name: string;
  hint: string;
  active: boolean;
  kind: 'pen' | 'brush' | 'shape' | 'eraser' | 'font' | 'size' | 'tol';
}
/** a titled group of options within a dock submenu */
export interface SubSection {
  title: string;
  items: SubItem[];
}

/**
 * All reactive UI/tool state + static config + pure derived helpers for the
 * artist board. Deliberately holds NO canvas/DOM — the board component owns the
 * canvas engine and reads these signals. Provided per `<artist-board>` instance
 * so each element has its own state.
 */
@Injectable()
export class ArtistStore {
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

  // ---- static config ----
  readonly tools = TOOLS;
  readonly blendModes = BLEND_MODES;
  readonly brushes = BRUSHES;
  readonly pens = PENS;

  readonly dock: DockButton[] = [
    { id: 'move', icon: 'move', tool: 'move' },
    { id: 'brush', icon: 'brush', tool: 'brush', brushStyles: true, covers: ['pen'] },
    { id: 'eraser', icon: 'eraser', tool: 'eraser', eraserOpts: true },
    { id: 'shapes', icon: 'rect', tool: 'rect', members: ['line', 'rect', 'ellipse'] },
    { id: 'text', icon: 'text', tool: 'text', textOpts: true },
    { id: 'fill', icon: 'fill', tool: 'fill', fillOpts: true },
  ];
  private lastShape: ToolId = 'rect';

  readonly bgColors = ['#ffffff', '#f6f1e7', '#0f1014', '#fde2e4', '#e0f2fe', '#e8f5e9', '#fff4d6'];
  readonly bgTextures: { id: BgTexture; name: string }[] = [
    { id: 'dots', name: 'Dots' },
    { id: 'grid', name: 'Grid' },
    { id: 'lines', name: 'Lines' },
    { id: 'paper', name: 'Paper' },
  ];

  // ---- reactive tool state ----
  readonly activeTool = signal<ToolId>('pen');
  readonly outlineColor = signal('#101114');
  readonly fillColor = signal('#f7c6cf');
  readonly outlineOpacity = signal(1);
  readonly fillOpacity = signal(0.56);
  readonly lineWidth = signal(10);
  readonly fontSize = signal(42);
  readonly brushStyle = signal<BrushStyle>('ink');
  readonly penStyle = signal<PenStyle>('medium');
  readonly eraserStyle = signal<'hard' | 'soft'>('hard');
  readonly fontFamily = signal<'sans' | 'serif' | 'mono'>('sans');
  readonly fillTolerance = signal(32);
  readonly openGroup = signal<string | null>(null);

  // ---- canvas background settings ----
  readonly bgKind = signal<'color' | 'texture' | 'image'>('color');
  readonly bgColor = signal('#ffffff');
  readonly bgTexture = signal<BgTexture>('dots');
  readonly bgImageUrl = signal<string | null>(null);

  // ---- layers ----
  readonly layers = signal<Layer[]>([]);
  readonly activeLayerId = signal<string>('');
  readonly activeLayer = computed<Layer | undefined>(
    () => this.layers().find((l) => l.id === this.activeLayerId()),
  );
  /** layers rendered top-to-bottom in the panel */
  readonly layersReversed = computed(() => [...this.layers()].reverse());

  // ---- panels / popovers ----
  readonly layersPanelOpen = signal(false);
  readonly colorPickerOpen = signal(false);
  readonly backgroundOpen = signal(false);
  readonly moreOpen = signal(false);

  // ---- history flags ----
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  // ---- view transform ----
  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);

  // ---- left-edge size / opacity sliders ----
  readonly activeSlider = signal<'size' | 'opacity' | null>(null);
  readonly sizePct = computed(() => ((this.lineWidth() - 1) / (80 - 1)) * 100);
  readonly opacityPct = computed(() => this.outlineOpacity() * 100);

  // =========================================================================
  // Tool selection + dock submenus (pure state)
  // =========================================================================
  setTool(id: ToolId): void {
    this.activeTool.set(id);
    if (id === 'line' || id === 'rect' || id === 'ellipse') this.lastShape = id;
  }

  hasSubmenu(b: DockButton): boolean {
    return this.submenuFor(b).length > 0;
  }
  buttonActive(b: DockButton): boolean {
    if (b.members) return b.members.includes(this.activeTool());
    if (b.covers?.includes(this.activeTool())) return true;
    return this.activeTool() === b.tool;
  }
  buttonIcon(b: DockButton): string {
    if (b.members) return b.members.includes(this.activeTool()) ? this.activeTool() : this.lastShape;
    // the brush button doubles as the pen; reflect whichever is live
    if (b.brushStyles) return this.activeTool() === 'pen' ? 'pen' : 'brush';
    return b.icon;
  }
  onDockClick(b: DockButton): void {
    // tapping the ACTIVE tool that has options opens its submenu
    if (this.hasSubmenu(b) && this.buttonActive(b)) {
      this.openGroup.set(this.openGroup() === b.id ? null : b.id);
      return;
    }
    this.setTool(b.members ? this.lastShape : b.tool);
    this.openGroup.set(null);
  }

  /** the titled option groups shown in a dock button's submenu */
  submenuFor(b: DockButton): SubSection[] {
    if (b.eraserOpts) {
      return [
        {
          title: 'Edge',
          items: [
            { id: 'hard', name: 'Hard', hint: 'Crisp, full-strength erase', kind: 'eraser', active: this.eraserStyle() === 'hard' },
            { id: 'soft', name: 'Soft', hint: 'Feathered, soft-edged erase', kind: 'eraser', active: this.eraserStyle() === 'soft' },
          ],
        },
      ];
    }
    if (b.textOpts) {
      const sizes: { px: number; label: string }[] = [
        { px: 24, label: 'Small' },
        { px: 42, label: 'Body' },
        { px: 72, label: 'Display' },
      ];
      return [
        {
          title: 'Font',
          items: [
            { id: 'sans', name: 'Sans', hint: 'Inter / system sans', kind: 'font', active: this.fontFamily() === 'sans' },
            { id: 'serif', name: 'Serif', hint: 'Georgia serif', kind: 'font', active: this.fontFamily() === 'serif' },
            { id: 'mono', name: 'Mono', hint: 'Monospace', kind: 'font', active: this.fontFamily() === 'mono' },
          ],
        },
        {
          title: 'Size',
          items: sizes.map((s) => ({
            id: String(s.px),
            name: `${s.px} px`,
            hint: s.label,
            kind: 'size' as const,
            active: this.fontSize() === s.px,
          })),
        },
      ];
    }
    if (b.fillOpts) {
      const levels: { tol: number; name: string; hint: string }[] = [
        { tol: 12, name: 'Low', hint: 'Match very similar colors' },
        { tol: 32, name: 'Medium', hint: 'Balanced matching' },
        { tol: 64, name: 'High', hint: 'Match a wide color range' },
      ];
      return [
        {
          title: 'Tolerance',
          items: levels.map((l) => ({
            id: String(l.tol),
            name: l.name,
            hint: l.hint,
            kind: 'tol' as const,
            active: this.fillTolerance() === l.tol,
          })),
        },
      ];
    }
    if (b.brushStyles) {
      return [
        {
          title: 'Pens',
          items: this.pens.map((p) => ({
            id: p.id,
            name: p.name,
            hint: p.hint,
            kind: 'pen' as const,
            active: this.activeTool() === 'pen' && this.penStyle() === p.id,
          })),
        },
        {
          title: 'Brushes',
          items: this.brushes.map((s) => ({
            id: s.id,
            name: s.name,
            hint: s.hint,
            kind: 'brush' as const,
            active: this.activeTool() === 'brush' && this.brushStyle() === s.id,
          })),
        },
      ];
    }
    if (b.members) {
      return [
        {
          title: 'Shapes',
          items: b.members.map((m) => {
            const t = this.tools.find((x) => x.id === m)!;
            return {
              id: m,
              name: t.name,
              hint: t.hint,
              kind: 'shape' as const,
              active: this.activeTool() === m,
            };
          }),
        },
      ];
    }
    return [];
  }

  pickSubItem(it: SubItem): void {
    switch (it.kind) {
      case 'pen':
        this.pickPenStyle(it.id as PenStyle);
        break;
      case 'brush':
        this.pickBrushStyle(it.id as BrushStyle);
        break;
      case 'shape':
        this.pickShape(it.id as ToolId);
        break;
      case 'eraser':
        this.eraserStyle.set(it.id as 'hard' | 'soft');
        this.activeTool.set('eraser');
        this.openGroup.set(null);
        break;
      case 'font':
        this.fontFamily.set(it.id as 'sans' | 'serif' | 'mono');
        this.activeTool.set('text');
        this.openGroup.set(null);
        break;
      case 'size':
        this.fontSize.set(+it.id);
        this.activeTool.set('text');
        this.openGroup.set(null);
        break;
      case 'tol':
        this.fillTolerance.set(+it.id);
        this.activeTool.set('fill');
        this.openGroup.set(null);
        break;
    }
  }

  pickShape(id: ToolId): void {
    this.setTool(id);
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

  /** whether this dock button's tool paints a fill (so it needs the slider) */
  menuHasFillOpacity(b: DockButton): boolean {
    if (b.fillOpts || b.textOpts) return true;
    if (b.members) return b.members.some((m) => this.tools.find((t) => t.id === m)?.usesFill);
    return false;
  }

  fontStack(): string {
    switch (this.fontFamily()) {
      case 'serif':
        return 'Georgia, "Times New Roman", serif';
      case 'mono':
        return '"SF Mono", ui-monospace, Menlo, monospace';
      default:
        return '"Inter", system-ui, -apple-system, sans-serif';
    }
  }

  cursorForTool(): string {
    switch (this.activeTool()) {
      case 'move':
        return 'grab';
      case 'text':
        return 'text';
      default:
        return 'crosshair';
    }
  }

  // ---- exclusive panel toggles ----
  private closePanels(except: 'layers' | 'color' | 'bg' | 'more'): void {
    if (except !== 'layers') this.layersPanelOpen.set(false);
    if (except !== 'color') this.colorPickerOpen.set(false);
    if (except !== 'bg') this.backgroundOpen.set(false);
    if (except !== 'more') this.moreOpen.set(false);
  }
  toggleLayers(): void {
    this.openGroup.set(null);
    const next = !this.layersPanelOpen();
    this.layersPanelOpen.set(next);
    if (next) this.closePanels('layers');
  }
  toggleColor(): void {
    this.openGroup.set(null);
    const next = !this.colorPickerOpen();
    this.colorPickerOpen.set(next);
    if (next) this.closePanels('color');
  }
  toggleBackground(): void {
    this.openGroup.set(null);
    const next = !this.backgroundOpen();
    this.backgroundOpen.set(next);
    if (next) this.closePanels('bg');
  }
  toggleMore(): void {
    this.openGroup.set(null);
    const next = !this.moreOpen();
    this.moreOpen.set(next);
    if (next) this.closePanels('more');
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
}
