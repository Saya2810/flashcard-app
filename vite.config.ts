/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base './' → the app works under any path (GitHub Pages, Netlify, Cloudflare Pages).
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png', 'beispiel.csv'],
      manifest: {
        name: 'Lernkarten',
        short_name: 'Lernkarten',
        description: 'Kostenlose Lernkarten für jedes Fach – mit intelligenter Wiederholung, offline',
        lang: 'de',
        dir: 'ltr',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#FCF1F5',
        theme_color: '#FCF1F5',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,csv}'],
        globIgnores: ['legacy/**'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        // The original Persian–German app is deployed under /legacy/ with its own service worker.
        navigateFallbackDenylist: [/\/legacy\//],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 900 },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
