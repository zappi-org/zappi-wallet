import { registerSW } from 'virtual:pwa-register'
import { useAppStore } from '@/store'
import i18n from '@/i18n'

let serviceWorkerRegistration: ServiceWorkerRegistration | undefined
let manualUpdateCheckInFlight = false
let suppressAutoUpdateToastUntil = 0
let updateToastShown = false

export type AppUpdateCheckResult = 'available' | 'current' | 'unavailable'
type WaitingWorkerResult = 'available' | 'current' | 'unavailable'

export interface AppUpdateCheckOptions {
  onInstalling?: () => void
}

function markUpdateAvailable() {
  useAppStore.getState().setUpdateAvailable(true)
}

function shouldSuppressAutoUpdateToast(): boolean {
  return manualUpdateCheckInFlight || Date.now() < suppressAutoUpdateToastUntil
}

function notifyUpdateAvailable() {
  if (updateToastShown) return
  updateToastShown = true
  const store = useAppStore.getState()
  store.addToast({
    type: 'info',
    message: i18n.t('settings.updateAvailable'),
    duration: 6000,
    onAction: () => updateSW(),
  })
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
  options: AppUpdateCheckOptions = {},
  timeoutMs = 30000,
): Promise<WaitingWorkerResult> {
  if (registration.waiting) return Promise.resolve('available')

  return new Promise((resolve) => {
    let settled = false
    let installingNotified = false
    const cleanupCallbacks: Array<() => void> = []

    const done = (result: WaitingWorkerResult) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      cleanupCallbacks.forEach((cleanup) => cleanup())
      resolve(result)
    }

    const watchWorker = (worker: ServiceWorker | null) => {
      if (!worker) return
      if (!installingNotified) {
        installingNotified = true
        options.onInstalling?.()
      }

      const handleStateChange = () => {
        if (registration.waiting || (worker.state === 'installed' && hasActiveController())) {
          done('available')
        } else if (worker.state === 'redundant') {
          done('current')
        }
      }

      worker.addEventListener('statechange', handleStateChange)
      cleanupCallbacks.push(() => worker.removeEventListener('statechange', handleStateChange))
      handleStateChange()
    }

    const handleUpdateFound = () => watchWorker(registration.installing)

    const timeoutId = window.setTimeout(() => done(installingNotified ? 'unavailable' : 'current'), timeoutMs)
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
    if (!shouldSuppressAutoUpdateToast()) {
      notifyUpdateAvailable()
    }
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

async function checkForAppUpdate(options: AppUpdateCheckOptions = {}): Promise<AppUpdateCheckResult> {
  manualUpdateCheckInFlight = true
  try {
    const registration = await getCurrentRegistration()
    if (!registration) return 'unavailable'

    if (registration.waiting || useAppStore.getState().updateAvailable) {
      markUpdateAvailable()
      return 'available'
    }

    if (registration.installing) {
      const existingWorkerResult = await waitForWaitingWorker(registration, options)
      if (existingWorkerResult === 'available' || useAppStore.getState().updateAvailable) {
        markUpdateAvailable()
        return 'available'
      }
      return existingWorkerResult
    }

    const updatedRegistration = await registration.update()
    serviceWorkerRegistration = updatedRegistration

    const isAvailable = updatedRegistration.waiting
      || useAppStore.getState().updateAvailable

    if (isAvailable) {
      markUpdateAvailable()
      return 'available'
    }

    if (!updatedRegistration.installing) {
      return 'current'
    }

    const workerResult = await waitForWaitingWorker(updatedRegistration, options)
    if (workerResult === 'available' || useAppStore.getState().updateAvailable) {
      markUpdateAvailable()
      return 'available'
    }

    return workerResult
  } finally {
    manualUpdateCheckInFlight = false
    suppressAutoUpdateToastUntil = Date.now() + 1500
  }
}

export { updateSW, checkForAppUpdate }
