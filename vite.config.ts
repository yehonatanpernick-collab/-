import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: { output: { manualChunks: { three: ['three', 'three/webgpu', 'three/tsl'], rapier: ['@dimforge/rapier3d-compat'] } } },
  },
  server: { host: true },
});
