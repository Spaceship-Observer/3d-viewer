import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Относительный base — собранный dist/ работает и в корне сайта, и в подпапке.
  base: './',
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // three и лоадеры — в отдельный вендор-чанк, чтобы SW кэшировал их одним файлом
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
  worker: { format: 'es' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // регистрируем вручную (src/pwa.js), чтобы показать тост об обновлении
      includeAssets: ['favicon.svg', 'apple-touch-icon-180.png', 'icons/*.png'],
      manifest: {
        id: '/lens-3d/',
        name: 'Фокус 3D — просмотр моделей',
        short_name: 'Фокус 3D',
        description:
          'Офлайн-PWA для просмотра 3D-моделей: вращение, наезд, фокусное расстояние и перспектива камеры.',
        lang: 'ru',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        orientation: 'any',
        background_color: '#0b0c10',
        theme_color: '#0b0c10',
        categories: ['graphics', 'productivity', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          {
            name: 'Загрузить модель',
            short_name: 'Модель',
            description: 'Открыть панель загрузки файлов',
            url: './?action=open',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }],
          },
        ],
      },
      workbox: {
        // Модель весит 1–2 МБ в gzip, worker-скрипты draco/ktx2 — тоже крупные
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm,json,glb,gltf}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/draco\//, /^\/basis\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
