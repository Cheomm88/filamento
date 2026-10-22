import { defineConfig } from 'vite';

// Rutas relativas: funciona en GitHub Pages sea cual sea el nombre del repo.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  server: { host: true },
});
