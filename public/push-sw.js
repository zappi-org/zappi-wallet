/**
 * Kkachi push handlers.
 *
 * Appended to the Workbox-generated service worker via the `workbox.importScripts`
 * option in vite.config.ts. Kept as plain JS because `public/` is copied verbatim
 * and this runs before/outside the app bundle.
 *
 * Push payload (kkachi protocol v2): `{ v: 2, m: <label-token> }`. The token is
 * an obfuscated per-wallet label (HKDF-salted hashLabel — the server and the OS
 * never see the plaintext). The wallet page persists the matching `token →
 * title` pair in IndexedDB (same origin, DB `zappi-push-labels`, store `labels`
 * — see src/adapters/runtime/web-push.adapter.ts for the writer side), so a
 * matched wake-up renders its label title (e.g. "새 알림") instead of the raw
 * message. Any other registered message is rendered verbatim — the dev tools
 * use this to observe exactly what the server forwards (obfuscated token or
 * plaintext label). Legacy payloads without a message keep the neutral hint.
 *
 * - `push`: hint -> OS notification. The app replaces it with the decrypted
 *   summary using the same `tag` once unlocked.
 * - `notificationclick`: focus an open client or open a new one at `/`.
 *
 * Subscription rotation is self-healing: the client re-registers on every
 * activate() when notifications are enabled, so no `pushsubscriptionchange`
 * handler is needed here.
 */

const PUSH_DB_NAME = 'zappi-push-labels'
const PUSH_STORE_NAME = 'labels'
const PUSH_CONFIG_STORE = 'config'

// Version-free open: NO versionchange, so other live connections never block
// or abort the read (iOS). Works on any schema version of the store — the
// record is keyed by the message itself under both keyPath shapes.
function openPushDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PUSH_DB_NAME)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PUSH_STORE_NAME)) db.createObjectStore(PUSH_STORE_NAME, { keyPath: 'token' })
      if (!db.objectStoreNames.contains(PUSH_CONFIG_STORE)) db.createObjectStore(PUSH_CONFIG_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function pushLabelTitle(token) {
  try {
    const db = await openPushDb()
    return await new Promise((resolve) => {
      const get = db.transaction(PUSH_STORE_NAME, 'readonly').objectStore(PUSH_STORE_NAME).get(token)
      get.onsuccess = () => {
        const record = get.result
        resolve(record && record.token === token ? record.title : undefined)
      }
      get.onerror = () => resolve(undefined)
    })
  } catch {
    return undefined
  }
}

/** v2 payload → label token; malformed/legacy payloads degrade to undefined. */
async function pushMessageToken(data) {
  if (!data) return undefined
  try {
    const parsed = JSON.parse(await data.text())
    return typeof parsed.m === 'string' ? parsed.m : undefined
  } catch {
    return undefined
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })

      // Neutral wording — intentionally distinct from the label-resolved title
      // ("새 알림") so dev tests can tell resolution from the fallback. Matched
      // labels show their stored title; any other registered message shows
      // verbatim (dev: observe the exact forwarded payload); legacy payloads
      // without a message keep this hint. The resolved title is passed to
      // foreground clients too, so same-device testing sees it as well.
      const language = (self.navigator && self.navigator.language) || 'en'
      let title = language.toLowerCase().startsWith('ko') ? '알림' : 'New notification'
      const token = await pushMessageToken(event.data)
      if (token) {
        const labelTitle = await pushLabelTitle(token)
        console.log('[push] payload m:', token, '→ resolved:', labelTitle ?? '(none — showing raw)')
        title = labelTitle || token
      }

      // Foreground: the app owns the decision (the "hide while using the app"
      // setting). Hand the hint + resolved title to visible clients, they
      // notify or not.
      const visible = clients.filter((client) => client.visibilityState === 'visible')
      if (visible.length > 0) {
        for (const client of visible) client.postMessage({ type: 'zappi-push', title })
        return
      }

      await self.registration.showNotification(title, {
        tag: 'zappi-incoming',
        silent: true,
        data: { url: '/' },
      })
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const existing = clients[0]
      if (existing) return existing.focus()
      return self.clients.openWindow('/')
    })()
  )
})