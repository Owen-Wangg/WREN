/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  define: {
    global: 'window',
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // `@` -> ./src (frontend steering: use the `@` path alias mapped to ./src)
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Shared domain contract produced by task 1.2 — the single source of truth
      // for domain shapes across backend and frontend. Built against until the
      // package is published/linked at convergence.
      '@wren/types': fileURLToPath(new URL('../types/src/index.ts', import.meta.url)),
    },
  },
  server: {
    // Allow Vite to read the sibling `types` package source during dev.
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        fileURLToPath(new URL('../types', import.meta.url)),
      ],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
