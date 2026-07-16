# Angular Artist Board

A Sketchpad-style drawing application built with **Angular 22 (standalone, signals, zoneless)**
and packaged as a **native web component** via `@angular/elements`. The whole app is a single
custom element — `<artist-board></artist-board>` — that can be dropped into any HTML page.

## Features

- **Tools:** Move/Pan, Pen, Brush, Eraser, Line, Rectangle, Ellipse, Text, Fill Bucket (scanline flood fill), Eyedropper
- **Natural-media art brushes** (in the Brush tool): **Ink** (speed-tapered sumi-e), **Calligraphy** (angled flat nib), **Dry Bristle** (streaky split bristles), **Charcoal** (grainy chalk), **Airbrush** (soft spray with build-up), **Pencil** (fine graphite)
- **Context-sensitive properties panel** ("Paint Into Layer") — draggable, shows Fill / Outline colors, opacity, line width, blend mode, font size depending on the active tool
- **Layers** — add / delete / reorder / show-hide, per-layer opacity and 16 Photoshop-style **blend modes** (multiply, screen, overlay, …)
- **Undo / redo** (⌘Z / ⌘⇧Z) with per-layer bitmap history
- **Zoom & pan**, **Clear**, and **Export to PNG**
- **Keyboard shortcuts** — `V P B E L R O T G I` select tools; `[` / `]` change brush size
- High-DPI (retina) aware canvas; resizes with the window

## UI & interaction

A minimalist, Procreate-inspired, **touch-first** interface (works equally with mouse, pen, and touch — all via Pointer Events):

- **Right edge:** floating glass **tool dock**. Related tools are grouped into **flyout submenus** — **Draw** (Pen / Brush) and **Shapes** (Line / Rectangle / Ellipse); a corner chevron marks groups that have a submenu.
- **Bottom-right:** horizontal, inline **Size** and **Opacity** sliders.
- **Top-left:** Undo / Redo. **Top-right:** Color, Brush studio, Layers, Export, and an overflow menu (zoom, reset view, clear).
- **Brush studio:** the settings icon opens a panel of art-brush cards, blend mode, and colors.
- Panels/flyouts are mutually exclusive and dismiss when you start drawing. Multi-touch safe (extra fingers are ignored mid-stroke); long-press context menu and page scroll/zoom are suppressed over the canvas.

## Requirements

Angular 22 CLI needs **Node ≥ 22.22.3 or ≥ 24.15.0**. This project was built and verified with
Node **v24.17.0**. If you use `nvm`:

```bash
nvm use 24
```

## Run

```bash
npm install
npm start          # ng serve -> http://localhost:4200
```

Production build:

```bash
npm run build      # outputs to dist/artist-board
```

## Using it as a web component elsewhere

Because the board is registered through `@angular/elements` (see [src/main.ts](src/main.ts)),
the built `main.js` defines a real custom element. In any host page:

```html
<script src="main.js" type="module"></script>
<artist-board style="width:100vw;height:100vh;display:block"></artist-board>
```

No Angular knowledge is required on the host side — it behaves like a standard HTML element.

## Architecture

| File | Responsibility |
| --- | --- |
| [src/main.ts](src/main.ts) | Bootstraps the Angular context and registers `<artist-board>` as a custom element |
| [src/app/artist-board/artist-board.ts](src/app/artist-board/artist-board.ts) | Component + canvas engine: layer compositing, tools, flood fill, history, export |
| [src/app/artist-board/artist-board.html](src/app/artist-board/artist-board.html) | Tool rail, floating properties panel, top bar, layers panel |
| [src/app/artist-board/artist-board.scss](src/app/artist-board/artist-board.scss) | Dark-panel / light-canvas styling |
| [src/app/artist-board/models.ts](src/app/artist-board/models.ts) | Tool, layer, blend-mode and history types |

### How the canvas engine works

Each layer is an off-screen `<canvas>`. On every change the visible board canvas is
re-composited by drawing the layers in order, each with its own `globalAlpha` and
`globalCompositeOperation` (blend mode), over a transparency checkerboard. Freehand tools draw
incrementally onto the active layer; shapes (line/rect/ellipse) are previewed live on the composited
board and committed to the layer on pointer-up. Undo/redo snapshots the active layer's `ImageData`
before and after each operation.
