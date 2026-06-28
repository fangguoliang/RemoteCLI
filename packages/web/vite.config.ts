import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.svg'],
      // Force service worker update to clear old cached responses
      injectRegister: 'auto',
      workbox: {
        // Don't cache .mjs files (PDF.js worker needs fresh Content-Type)
        globIgnores: ['**/*.mjs'],
        runtimeCaching: [
          {
            urlPattern: /\.(js|mjs)$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'js-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 86400, // 1 day
              },
            },
          },
        ],
      },
      manifest: {
        name: 'remoteCli - PowerShell Terminal',
        short_name: 'remoteCli',
        description: '远程 PowerShell 终端',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        icons: [
          { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});