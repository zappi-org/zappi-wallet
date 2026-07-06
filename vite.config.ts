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
      // include 로 미임포트 파일까지 집계 (감사 §9: all 부재 → 통계 밖 결함.
      // vitest 4 는 all 옵션 제거 — include 매칭 파일이 미실행이어도 0% 로 포함)
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['node_modules/', 'src/__tests__/', '**/*.d.ts'],
      // 래칫 (R2-A, 감사 §9): 2026-07-07 실측 바닥값 고정 — 하향 금지, 상향만 허용.
      // 부동 상대값(-5%p)은 하향 드리프트를 정당화하므로 기각됨 (계획 리뷰).
      // 바닥 = 실측 −2~3%p (리뷰 MINOR: 실측 직결 바닥은 양성 변경에 여유 0 —
      // 방어 분기 2개 추가에 게이트가 즉사하고 바닥 인하 압력이 생긴다)
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
        // Precache all static assets
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Runtime caching for fonts and CDN resources
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
