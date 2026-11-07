import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2020',
    // Keep the bundle small: three.js is large but already a dependency.
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: {
    include: ['three'],
  },
});