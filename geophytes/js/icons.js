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

// איורים קטנים וצבעוניים (ציור עצמי): צבעים קבועים, לא תלויים בצבע הטקסט
const PET = (a) => `<ellipse cx="12" cy="6.4" rx="3" ry="4.1" fill="#ee6f9a" transform="rotate(${a} 12 12)"/>`;
const C = {
  sun: '<g stroke="#f5a623" stroke-width="2" stroke-linecap="round"><path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.4 5.4L7 7M17 17l1.6 1.6M5.4 18.6L7 17M17 7l1.6-1.6"/></g><circle cx="12" cy="12" r="4.6" fill="#ffd44d"/>',
  shade: '<circle cx="9.5" cy="9.5" r="5.2" fill="#6cbf67"/><circle cx="15.2" cy="11" r="4.6" fill="#4c9a48"/><path d="M12 21v-6" stroke="#8a5a2c" stroke-width="2.2" stroke-linecap="round"/>',
  water: '<path d="M12 3.2s6 6.1 6 10.6a6 6 0 01-12 0c0-4.5 6-10.6 6-10.6z" fill="#4da3e3"/><path d="M9.2 14.2a3 3 0 002.2 2.7" stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none"/>',
  dry: '<path d="M3 19h18" stroke="#c9a46a" stroke-width="2" stroke-linecap="round"/><path d="M6 19l1.5-4 1.5 4M10 19l2-6 2 6M15 19l1.6-3.6 1.6 3.6" stroke="#b07a3c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="17.5" cy="6.5" r="2.6" fill="#ffd44d"/>',
  rock: '<path d="M3.2 18.6l3.6-8 4.2 2.4 3.2-6.2 6.6 11.8z" fill="#9aa3ad"/><path d="M11 12.8l3.2-6.2 1.9 3.4-3.2 2z" fill="#c4cbd2"/><path d="M3.2 18.6l3.6-8 1.6.9-2.6 7.1z" fill="#7d8791"/>',
  soil: '<path d="M2.8 18.5c2.6-5.6 6.2-8.2 9.2-8.2s6.6 2.6 9.2 8.2z" fill="#b07a4a"/><path d="M6 18.5c1.6-3 3.6-4.5 6-4.5" stroke="#8a5a2c" stroke-width="1.3" stroke-linecap="round" fill="none"/><circle cx="9" cy="16.6" r=".8" fill="#e0b98a"/><circle cx="14.6" cy="15.9" r=".8" fill="#e0b98a"/><circle cx="17" cy="17.4" r=".7" fill="#e0b98a"/>',
  sand: '<path d="M2.6 18.8c3-5.4 6-8.4 9-8.4 2.6 0 4.2 2.6 6.4 5 .9 1 2 2.2 3.4 3.4z" fill="#f0d189"/><path d="M2.6 18.8c3-3.6 5.6-5.2 8-5.2" stroke="#d9b55e" stroke-width="1.4" stroke-linecap="round" fill="none"/><circle cx="16.6" cy="6.4" r="2.4" fill="#ffd44d"/>',
  plants: '<path d="M7 20v-7M7 13c0-2.6-1.8-4.2-4.6-4.2 0 2.7 1.8 4.2 4.6 4.2zM7 15c0-2.4 1.8-3.8 4.5-3.8 0 2.5-1.8 3.8-4.5 3.8z" fill="#6cbf67" stroke="#4c9a48" stroke-width="1" stroke-linejoin="round"/><path d="M17 20v-9" stroke="#4f8f4a" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="8.4" r="2.6" fill="#ee6f9a"/><circle cx="17" cy="8.4" r="1" fill="#f8c94a"/>',
  tree: '<circle cx="12" cy="8.6" r="5.6" fill="#5fae57"/><circle cx="8.2" cy="11.2" r="3.6" fill="#4c9a48"/><circle cx="15.8" cy="11.4" r="3.4" fill="#6cbf67"/><path d="M12 21v-7.5" stroke="#8a5a2c" stroke-width="2.4" stroke-linecap="round"/>',
  home: '<path d="M4.5 11.2L12 4.6l7.5 6.6V19a1 1 0 01-1 1h-13a1 1 0 01-1-1z" fill="#ecb877"/><path d="M3.4 11.8L12 4l8.6 7.8" stroke="#c4603a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><rect x="10" y="14" width="4" height="6" rx=".8" fill="#8a5a2c"/>',
  logo: '<path d="M12 22v-8.5" stroke="#4f8f4a" stroke-width="1.9" stroke-linecap="round"/><path d="M12 18.4c-3-.2-5.2-2-5.7-4.7 2.7.2 4.8 1.7 5.7 4.7z" fill="#62b05a"/><path d="M12 19.4c2.9-.1 5-1.8 5.5-4.4-2.6.1-4.7 1.5-5.5 4.4z" fill="#4c9a48"/><path d="M6.2 5c-.6 5 1.4 9.1 5.8 9.1s6.4-4.1 5.8-9.1l-3 2.4L12 3.2 9.2 7.4z" fill="#e8467c"/><path d="M12 3.2l2.8 4.2-2.8 6.7-2.8-6.7z" fill="#f98fb1"/><path d="M9.2 7.4L6.2 5c-.2 2 .1 3.8.7 5.3z" fill="#c42f63" opacity=".55"/>',
  camera: '<path d="M3.3 8.9a2.2 2.2 0 012.2-2.2h2.1l1.1-1.7h6.6l1.1 1.7h2.1a2.2 2.2 0 012.2 2.2V18a2.2 2.2 0 01-2.2 2.2h-13A2.2 2.2 0 013.3 18z" fill="#56627a"/><circle cx="12" cy="13.4" r="4.9" fill="#e6ecf4"/><circle cx="12" cy="13.4" r="3.5" fill="#2f7fd1"/><circle cx="12" cy="13.4" r="1.9" fill="#1d4f94"/><circle cx="10.8" cy="12.2" r=".85" fill="#fff" opacity=".9"/><circle cx="17.7" cy="9.5" r=".85" fill="#ffb454"/>',
  folder: '<path d="M3 7.4a1.9 1.9 0 011.9-1.9h4.2l2 2.2h8A1.9 1.9 0 0121 9.6V18a1.9 1.9 0 01-1.9 1.9H4.9A1.9 1.9 0 013 18z" fill="#dd9f24"/><path d="M3 10.3h18V18a1.9 1.9 0 01-1.9 1.9H4.9A1.9 1.9 0 013 18z" fill="#f7c758"/>',
  chat: '<path d="M5.6 4.4h12.8A2.6 2.6 0 0121 7v7a2.6 2.6 0 01-2.6 2.6h-6L8 20.2v-3.6H5.6A2.6 2.6 0 013 14V7a2.6 2.6 0 012.6-2.6z" fill="#4da3e3"/><circle cx="8.4" cy="10.5" r="1.25" fill="#fff"/><circle cx="12" cy="10.5" r="1.25" fill="#fff"/><circle cx="15.6" cy="10.5" r="1.25" fill="#fff"/>',
  bloom: `${[0, 72, 144, 216, 288].map(PET).join('')}<circle cx="12" cy="12" r="2.6" fill="#f8c94a"/><circle cx="11.2" cy="11.2" r=".8" fill="#fff6c9"/>`,
  search: '<circle cx="10.4" cy="10.4" r="6.3" fill="#d4edf9" stroke="#6b8294" stroke-width="2.1"/><path d="M7.9 8.1a3.8 3.8 0 013.1-1.3" stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M15.2 15.2l5 5" stroke="#9b6a3a" stroke-width="3.1" stroke-linecap="round"/>',
  pin: '<path d="M12 21.6s6.6-6.3 6.6-11.4a6.6 6.6 0 00-13.2 0c0 5.1 6.6 11.4 6.6 11.4z" fill="#e5483f"/><circle cx="12" cy="10.2" r="2.6" fill="#fff"/>',
  map: '<path d="M3 6.3l5.7-2v13.5L3 19.8z" fill="#ecdfb9"/><path d="M8.7 4.3l6.6 2v13.5l-6.6-2z" fill="#9bd08a"/><path d="M15.3 6.3L21 4.3v13.5l-5.7 2z" fill="#8cc6ea"/><circle cx="12" cy="11.2" r="1.7" fill="#e5483f"/>',
  leaf: '<path d="M4.4 19.6C4.2 10.4 10 4.6 19.8 4.2 19.7 14 14 19.9 4.4 19.6z" fill="#5fae57"/><path d="M4.4 19.6L14 10" stroke="#2c7a38" stroke-width="1.5" stroke-linecap="round"/>',
  sprout: '<ellipse cx="12" cy="20" rx="6.5" ry="1.8" fill="#a8744a"/><path d="M12 19.5v-7.2" stroke="#4f8f4a" stroke-width="1.9" stroke-linecap="round"/><path d="M12 12.6c0-3.4-2.5-5.6-6.6-5.5.1 3.5 2.6 5.6 6.6 5.5z" fill="#6cbc62"/><path d="M12 14.4c0-3.2 2.4-5.3 6.5-5.2-.1 3.3-2.5 5.3-6.5 5.2z" fill="#4c9a48"/>',
  spark: '<path d="M10.8 3l2 5.6L18.5 10.6l-5.7 2-2 5.7-2-5.7-5.6-2 5.6-2z" fill="#f6b93b"/><path d="M18.6 14.8l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" fill="#a98bf6"/>',
  image: '<rect x="3.3" y="4.4" width="17.4" height="15.2" rx="2.6" fill="#a9d6f5"/><path d="M3.3 16.2c3-3.6 5.6-3.6 8.2-1 2-2.1 4.7-2.6 9.2 1.4v1.4a2.6 2.6 0 01-2.6 2.6H5.9a2.6 2.6 0 01-2.6-2.6z" fill="#6cbf67"/><circle cx="16.6" cy="9" r="2.1" fill="#ffd44d"/>',
  save: '<path d="M3.4 8.6L5.5 5h13l2.1 3.6z" fill="#c4874a"/><rect x="3.4" y="8.6" width="17.2" height="11" rx="1.6" fill="#ddab6e"/><rect x="9.4" y="11.2" width="5.2" height="2.1" rx="1" fill="#8a5a2c"/>',
  scan: '<path d="M4 8.6V5.8A1.8 1.8 0 015.8 4h2.8M15.4 4h2.8A1.8 1.8 0 0120 5.8v2.8M20 15.4v2.8a1.8 1.8 0 01-1.8 1.8h-2.8M8.6 20H5.8A1.8 1.8 0 014 18.2v-2.8" stroke="#2f7fd1" stroke-width="2.2" stroke-linecap="round" fill="none"/><path d="M12 16.2c-2.6 0-4-1.5-4-4 2.8 0 4 1.3 4 4zm0 0c2.6 0 4-1.5 4-4-2.8 0-4 1.3-4 4z" fill="#5fae57"/>',
  check: '<circle cx="12" cy="12" r="9.2" fill="#3fa05a"/><path d="M7.6 12.4l3 3 5.8-6.2" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  compass: '<circle cx="12" cy="12" r="9.2" fill="#e6f4f0" stroke="#2f9c8b" stroke-width="2"/><path d="M15.8 8.2l-2.3 5.3-3-3z" fill="#e5483f"/><path d="M8.2 15.8l2.3-5.3 3 3z" fill="#56627a"/>',
  tip: '<path d="M12 3.4a5.7 5.7 0 00-3.3 10.4c.6.5 1 1 1 1.8v.5h4.6v-.5c0-.8.4-1.3 1-1.8A5.7 5.7 0 0012 3.4z" fill="#ffd44d"/><rect x="9.7" y="17" width="4.6" height="2.4" rx="1.1" fill="#8b929c"/><path d="M9.9 8.6a2.6 2.6 0 012-1.8" stroke="#fff" stroke-width="1.3" stroke-linecap="round" fill="none"/>',
};
P.tick = '<path d="M5 12.6l4.4 4.4L19 7.6"/>';
/** ic('camera') → <svg class="ic">…</svg>; הפרמטר השני: 'solo' לסמל בלי רווח אחריו, 'sm' קטן */
export const ic = (name, mod = '') => C[name]
  ? `<svg class="ic color ${mod}" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${C[name]}</svg>`
  : `<svg class="ic ${mod}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
