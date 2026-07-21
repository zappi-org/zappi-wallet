import path from 'path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

function readPackageVersion(): string {
  const packageJsonPath = path.resolve(__dirname, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string }
  return packageJson.version?.trim() || '0.0.0'
}

type ReleaseChannel = 'main' | 'staging' | 'nightly'

function readChannel(): ReleaseChannel {
  const raw = (process.env.VITE_ZAPPI_CHANNEL ?? 'main').trim().toLowerCase()
  if (raw === 'staging' || raw === 'nightly') return raw
  return 'main'
}

function readInviteCodes(): string[] {
  return (process.env.VITE_ZAPPI_INVITE_CODES ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code.length > 0)
}

function readGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

function isGitDirty(): boolean {
  try {
    return execSync('git status --short', {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim().length > 0
  } catch {
    return false
  }
}

// Dev-only kill switch for stale service workers. A device that once loaded a
// prod/preview build on this origin keeps that SW forever: its update check
// fetches /service-worker.js, the dev server answers with the index.html SPA
// fallback (not JS), the update fails, and the SW keeps serving the old cached
// app — fixes never reach the device. Serving a real self-destroying SW at the
// same path makes the browser's automatic update swap it in, purge caches,
// unregister, and reload clients back onto the live dev server.
const SELF_DESTROYING_SW = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => client.navigate(client.url));
  })());
});
`

function devServiceWorkerKillSwitch() {
  return {
    name: 'dev-sw-kill-switch',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (path: string, handler: (req: unknown, res: { setHeader: (k: string, v: string) => void; end: (body: string) => void }) => void) => void } }) {
      server.middlewares.use('/service-worker.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript')
        res.setHeader('Cache-Control', 'no-store')
        res.end(SELF_DESTROYING_SW)
      })
    },
  }
}

const appVersion = readPackageVersion()
const gitCommit = readGitCommit()
const appCommit = gitCommit !== 'unknown' && isGitDirty() ? `${gitCommit}-dirty` : gitCommit
const releaseChannel = readChannel()
const inviteCodes = readInviteCodes()

// Local HTTPS for PWA testing on LAN (iOS Safari requires HTTPS for service worker).
// Generate certs via: cd certs && mkcert -cert-file dev.pem -key-file dev-key.pem <hostnames>
// Falls back to HTTP if cert files are absent — CI/non-mkcert environments still work.
const certPath = path.resolve(__dirname, './certs/dev.pem')
const keyPath = path.resolve(__dirname, './certs/dev-key.pem')
const httpsConfig =
  fs.existsSync(certPath) && fs.existsSync(keyPath)
    ? {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      }
    : undefined

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT__: JSON.stringify(appCommit),
    __ZAPPI_CHANNEL__: JSON.stringify(releaseChannel),
    __ZAPPI_INVITE_CODES__: JSON.stringify(inviteCodes),
  },
  server: {
    host: true,
    port: 5174,
    https: httpsConfig,
    // Tailscale serve proxies device testing traffic with a *.ts.net Host header.
    allowedHosts: ['.ts.net'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    // Exclude qr-scanner from pre-bundling to allow dynamic worker import to work correctly
    exclude: ['qr-scanner'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      // include also counts un-imported files (without it they escape coverage stats;
      // vitest 4 removed the `all` option — include-matched files report 0% even if never run)
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['node_modules/', 'src/__tests__/', '**/*.d.ts'],
      // Ratchet: floor pinned to the 2026-07-07 measured baseline — never lower, only raise.
      // A floating relative margin (-5%p) would legitimize downward drift, so it was rejected.
      // Floor = measured −2~3%p: a floor tied exactly to measured values leaves no room for
      // benign changes — adding two defensive branches would trip the gate and pressure the floor down.
      thresholds: {
        'src/core/domain/**': { lines: 91, statements: 86, branches: 79, functions: 88 },
        'src/composition/**': { lines: 55, statements: 54, branches: 40, functions: 42 },
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-motion': ['motion'],
          'vendor-charts': ['recharts'],
          'vendor-nostr': ['nostr-tools'],
          'vendor-cashu': ['@cashu/cashu-ts'],
          'vendor-coco': ['@cashu/coco-core', '@cashu/coco-indexeddb'],
        },
      },
    },
  },
  esbuild: {
    drop: ['debugger'],
    pure: ['console.log', 'console.debug', 'console.info'],
  },
  plugins: [
    devServiceWorkerKillSwitch(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      filename: 'service-worker.js',
      includeAssets: [
        'favicon.png',
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
      ],
      manifest: {
        name: 'ZAPPI Wallet',
        short_name: 'ZAPPI',
        description: 'Non-custodial Cashu/Lightning Wallet',
        theme_color: '#F8F9FC',
        background_color: '#F8F9FC',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        id: 'zappi-wallet',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ],
        // Ensure the app shell is available offline
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /service-worker\.js$/, /workbox-(.)*\.js$/],
      }
    })
  ],
})
