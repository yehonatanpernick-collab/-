// סמלים קטנים בקו אחיד (SVG מוטבע) – מחליפים את כל המדבקות. צבע הקו נקבע ע"י color של הטקסט.
const PETAL = 'M12 3.2c2.1 2.1 2.1 4.6 0 6.6-2.1-2-2.1-4.5 0-6.6z';
const P = {
  logo: '<path d="M12 21v-8.5"/><path d="M6.8 4.8c-.4 4.6 1.5 8.2 5.2 8.2s5.6-3.6 5.2-8.2l-2.7 2.1L12 4l-2.5 2.9z"/><path d="M12 17c-1.6-1.9-3.4-2.4-5-2.2M12 18.4c1.4-1.4 3.2-1.9 5-1.6"/>',
  back: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  camera: '<path d="M4 8.5h3l1.6-2.3h6.8L17 8.5h3V19H4z"/><circle cx="12" cy="13.6" r="3.3"/>',
  folder: '<path d="M3.5 7h6l2 2.2h9V19h-17z"/>',
  chat: '<path d="M5 5.5h14v10H11.5L7 19v-3.5H5z"/>',
  bloom: `<g>${[0, 72, 144, 216, 288].map((a) => `<path d="${PETAL}" transform="rotate(${a} 12 12) translate(0 .6)"/>`).join('')}<circle cx="12" cy="12" r="1.5"/></g>`,
  search: '<circle cx="10.5" cy="10.5" r="5.8"/><path d="M15 15l5 5"/>',
  pin: '<path d="M12 21s6.5-5.8 6.5-11A6.5 6.5 0 005.5 10c0 5.2 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  map: '<path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  leaf: '<path d="M5 19c0-8.2 5-13.4 14-14.2-.2 9-5.2 14.2-13.4 14.2z"/><path d="M5 19l8-8"/>',
  sprout: '<path d="M12 20.5V12"/><path d="M12 12c0-3.2-2.6-5.2-6.4-5.2 0 3.2 2.6 5.2 6.4 5.2zM12 14c0-3 2.5-5 6.4-5 0 3-2.5 5-6.4 5z"/>',
  spark: '<path d="M11 3.5l1.8 5.1 5.2 1.9-5.2 1.9-1.8 5.1-1.8-5.1L4 10.5l5.2-1.9z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.5"/><path d="M4.5 16.5l4.3-3.8 3.4 3 3-2.4 4.9 4"/>',
  save: '<path d="M4 8.5L6 5h12l2 3.5V19H4z"/><path d="M4 8.5h16M10 12.5h4"/>',
  scan: '<path d="M4 8.5V5h3.5M16.5 5H20v3.5M20 15.5V19h-3.5M7.5 19H4v-3.5"/><path d="M7.5 12h9"/>',
  check: '<path d="M5 12.6l4.4 4.4L19 7.6"/>',
  cross: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.2 8.8l-1.9 4.6-4.5 1.8 1.9-4.6z"/>',
  tip: '<path d="M12 4.5a5 5 0 00-2.7 9.2c.5.4.7.9.7 1.5v.3h4v-.3c0-.6.2-1.1.7-1.5A5 5 0 0012 4.5z"/><path d="M10.2 19h3.6"/>',
};
/** ic('camera') → <svg class="ic">…</svg>; הפרמטר השני: 'solo' לסמל בלי רווח אחריו */
export const ic = (name, mod = '') =>
  `<svg class="ic ${mod}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
