/**
 * Inline SVG markup for every UI icon, keyed by name. Kept as a plain map so it
 * can be shared across the board component and its child UI components. The host
 * sanitizes each entry once (see the `iconFor` helper on the store/component).
 */
export const ICONS: Record<string, string> = {
  select: '<svg viewBox="0 0 24 24"><path d="M5 3l6 15 2.5-6.5L20 9 5 3z"/></svg>',
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
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 17l5-5 4 4 3-3 4 4"/></svg>',
  rotate: '<svg viewBox="0 0 24 24"><path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5"/></svg>',
};
