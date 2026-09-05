import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative base so the built site works from a GitHub Pages subpath as well
  // as from the root when served by `mtgproxy serve`.
  base: './',
  server: {
    port: 5173,
    // The bundled decklists live in the repo's examples/ directory, above this
    // package, so dev has to be allowed to read them.
    fs: { allow: ['../..'] },
    // In dev the API lives in the CLI's server; proxy so the store probe works.
    proxy: { '/api': { target: 'http://localhost:5174', changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
