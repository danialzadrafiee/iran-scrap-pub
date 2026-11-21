import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'ui',
  plugins: [tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
});
