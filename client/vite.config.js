import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Crowdwave', short_name: 'Crowdwave', description: 'Swarm file distribution and messaging for crowded rooms',
        theme_color: '#102a43', background_color: '#f4f7f9', display: 'standalone', start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api/, /^\/ws/], globPatterns: ['**/*.{js,css,html,svg,png}'], maximumFileSizeToCacheInBytes: 8 * 1024 * 1024 },
    }),
  ],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } } },
  optimizeDeps: { exclude: ['@xenova/transformers'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
