/// <reference types="vitest/config" />
/**
 * Vitest configuration for unit tests — avoids loading @tailwindcss/vite
 * plugin which requires platform-specific native bindings.
 *
 * Usage: npx vitest run --config vitest.unit.config.ts
 */
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    global: 'window',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@wren/types': fileURLToPath(new URL('../types/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
