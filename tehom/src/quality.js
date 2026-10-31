// Device profile. Phones get fewer pixels and cheaper shaders; the frame-time governor in main.js
// then nudges the pixel ratio up or down so every device settles near a smooth frame rate.
const hasWin = typeof window !== 'undefined';
const search = hasWin ? location.search : '';
export const LOWQ = /lowq/.test(search);
export const TOUCH = hasWin && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
export const MOBILE = hasWin && (TOUCH || Math.min(innerWidth, innerHeight) < 640);

const tier = LOWQ ? 0 : MOBILE ? 1 : 2;
export const Q = {
  tier,
  maxPR: [0.6, 1.5, 2.0][tier],
  startPR: hasWin ? Math.min(devicePixelRatio || 1, [0.6, 1.25, 1.75][tier]) : 1,
  msaa: [0, 0, 4][tier],
  cube: [128, 512, 1024][tier],
  belt: [500, 1100, 2400][tier],
  stars: [3000, 6000, 9000][tier],
  bump: tier === 2,
  sphereSeg: [32, 64, 128][tier],
  particles: [12000, 24000, 48000][tier],
};
