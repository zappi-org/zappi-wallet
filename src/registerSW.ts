import { registerSW } from 'virtual:pwa-register'
import { useAppStore } from '@/store'
import i18n from '@/i18n'

// prompt mode + no skipWaiting: new SW installs in background and waits.
// Activates automatically on next app start (when old clients are gone).
// No mid-session reloads.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    const store = useAppStore.getState()
    store.setUpdateAvailable(true)
    store.addToast({
      type: 'info',
      message: i18n.t('settings.updateAvailable'),
      duration: 6000,
      onAction: () => updateSW(),
    })
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
