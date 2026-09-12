/**
 * Kkachi push handlers.
 *
 * Appended to the Workbox-generated service worker via the `workbox.importScripts`
 * option in vite.config.ts. Kept as plain JS because `public/` is copied verbatim
 * and this runs before/outside the app bundle.
 *
 * - `push`: content-less wake hint -> generic OS notification (the server never
 *   sees the payload content). The app replaces it with the decrypted summary
 *   using the same `tag` once unlocked.
 * - `notificationclick`: focus an open client or open a new one at `/`.
 *
 * Subscription rotation is self-healing: the client re-registers on every
 * activate() when notifications are enabled, so no `pushsubscriptionchange`
 * handler is needed here.
 */

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      // Foreground: the app owns the decision (the "hide while using the app"
      // setting). Hand the hint to visible clients and let them notify or not.
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const visible = clients.filter((client) => client.visibilityState === 'visible')
      if (visible.length > 0) {
        for (const client of visible) client.postMessage({ type: 'zappi-push' })
        return
      }

      const language = (self.navigator && self.navigator.language) || 'en'
      // Content-less wake hint: never name the content (payment/value) on the
      // lock screen. The app replaces this with the decrypted summary on unlock.
      const title = language.toLowerCase().startsWith('ko') ? '새 알림' : 'New notification'
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
