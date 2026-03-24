import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const port = Number(process.env.VITE_DEV_PORT) || 5173;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(__dirname, 'dist'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
      },
    },
  },
});
