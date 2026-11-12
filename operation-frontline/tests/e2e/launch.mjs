// Shared Chromium launcher for the e2e / debug scripts.
// FRONTLINE_GL=llvmpipe (run under xvfb-run) uses Mesa's software GL which is far faster than SwiftShader.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
export async function launch() {
  if (process.env.FRONTLINE_GL === 'llvmpipe') {
    return chromium.launch({ headless: false, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', '--disable-gpu-process-crash-limit', '--enable-gpu', '--disable-gpu-sandbox', '--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  }
  return chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
}
