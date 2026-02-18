import { registerSW } from 'virtual:pwa-register'
import { useAppStore } from '@/store'

// prompt mode + no skipWaiting: new SW installs in background and waits.
// Activates automatically on next app start (when old clients are gone).
// No mid-session reloads.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    useAppStore.getState().setUpdateAvailable(true)
  },
  onOfflineReady() {
    console.log('[SW] Offline ready')
  },
  onRegisteredSW(swUrl) {
    console.log('[SW] Registered:', swUrl)
  },
  onRegisterError(error) {
    console.error('[SW] Registration failed:', error)
  },
})

export { updateSW }
