import { registerSW } from 'virtual:pwa-register'
import { useAppStore } from '@/store'
import i18n from '@/i18n'

let serviceWorkerRegistration: ServiceWorkerRegistration | undefined

export type AppUpdateCheckResult = 'available' | 'current' | 'unavailable'

function markUpdateAvailable() {
  useAppStore.getState().setUpdateAvailable(true)
}

function hasActiveController(): boolean {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && Boolean(navigator.serviceWorker.controller)
}

async function getCurrentRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (serviceWorkerRegistration) return serviceWorkerRegistration
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null
  }
  const registration = await navigator.serviceWorker.getRegistration()
  serviceWorkerRegistration = registration ?? undefined
  return registration ?? null
}

function waitForWaitingWorker(
  registration: ServiceWorkerRegistration,
  timeoutMs = 5000,
): Promise<boolean> {
  if (registration.waiting) return Promise.resolve(true)

  return new Promise((resolve) => {
    let settled = false
    const cleanupCallbacks: Array<() => void> = []

    const done = (available: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      cleanupCallbacks.forEach((cleanup) => cleanup())
      resolve(available)
    }

    const watchWorker = (worker: ServiceWorker | null) => {
      if (!worker) return

      const handleStateChange = () => {
        if (registration.waiting || (worker.state === 'installed' && hasActiveController())) {
          done(true)
        } else if (worker.state === 'redundant') {
          done(false)
        }
      }

      worker.addEventListener('statechange', handleStateChange)
      cleanupCallbacks.push(() => worker.removeEventListener('statechange', handleStateChange))
      handleStateChange()
    }

    const handleUpdateFound = () => watchWorker(registration.installing)

    const timeoutId = window.setTimeout(() => done(false), timeoutMs)
    registration.addEventListener('updatefound', handleUpdateFound)
    cleanupCallbacks.push(() => registration.removeEventListener('updatefound', handleUpdateFound))
    watchWorker(registration.installing)
  })
}

// prompt mode + no skipWaiting: new SW installs in background and waits.
// Activates automatically on next app start (when old clients are gone).
// No mid-session reloads.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    markUpdateAvailable()
    const store = useAppStore.getState()
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
  onRegisteredSW(swUrl, registration) {
    serviceWorkerRegistration = registration
    console.log('[SW] Registered:', swUrl)
  },
  onRegisterError(error) {
    console.error('[SW] Registration failed:', error)
  },
})

async function checkForAppUpdate(): Promise<AppUpdateCheckResult> {
  const registration = await getCurrentRegistration()
  if (!registration) return 'unavailable'

  if (registration.waiting || useAppStore.getState().updateAvailable) {
    markUpdateAvailable()
    return 'available'
  }

  const updatedRegistration = await registration.update()
  serviceWorkerRegistration = updatedRegistration

  const isAvailable = updatedRegistration.waiting
    || await waitForWaitingWorker(updatedRegistration)
    || useAppStore.getState().updateAvailable

  if (isAvailable) {
    markUpdateAvailable()
    return 'available'
  }

  return 'current'
}

export { updateSW, checkForAppUpdate }
