import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)) } },
  server: { port: 5173, host: true, fs: { allow: ['..'] } },
  preview: { port: 4173, host: true },
  build: { rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)) } }, outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000, sourcemap: false },
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
});
