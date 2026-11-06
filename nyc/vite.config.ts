import { defineConfig } from 'vite';
// Relative base so the build runs from any folder (artifact, GitHub Pages, file server).
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
