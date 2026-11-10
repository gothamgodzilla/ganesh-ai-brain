import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const BRAIN_DEV = process.env.BRAIN_DEV_URL ?? 'http://127.0.0.1:5055';

export default defineConfig({
  plugins: [react()],
  base: '/brain-static/',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BRAIN_DEV, changeOrigin: true },
      '/brain': { target: BRAIN_DEV, changeOrigin: true },
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, '../console-dist'),
    emptyOutDir: true,
  },
});