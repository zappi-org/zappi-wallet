import { registerSW } from 'virtual:pwa-register'
import { useAppStore } from '@/store'
import i18n from '@/i18n'

let serviceWorkerRegistration: ServiceWorkerRegistration | undefined
let manualUpdateCheckInFlight = false
let suppressAutoUpdateToastUntil = 0
let updateToastShown = false
let inFlightCheck: Promise<AppUpdateCheckResult> | null = null

export type AppUpdateCheckResult = 'available' | 'current' | 'unavailable'
type WaitingWorkerResult = 'available' | 'current' | 'unavailable'

function markUpdateAvailable() {
  useAppStore.getState().setUpdateAvailable(true)
}

function setUpdatePhase(phase: 'idle' | 'checking' | 'installing') {
  useAppStore.getState().setUpdatePhase(phase)
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

/** Single availability predicate shared by the phase watcher and the manual
 *  check: an install counts as an update only when an old SW controls the
 *  page — a first install has no controller and is not an "update". */
function isUpdateReady(registration: ServiceWorkerRegistration, worker?: ServiceWorker | null): boolean {
  return hasActiveController() && (Boolean(registration.waiting) || worker?.state === 'installed')
}

// A worker that hangs mid-install emits no further statechange; without a
// backstop the settings button would stay disabled for the whole session.
const INSTALL_WATCHDOG_MS = 5 * 60_000

/**
 * Single owner of the store's updatePhase for install progress — covers both
 * browser-initiated background installs and manual checks, so the settings
 * button reflects reality across screen changes.
 */
function watchRegistrationForInstalls(registration: ServiceWorkerRegistration) {
  const watchWorker = (worker: ServiceWorker | null) => {
    if (!worker) return
    setUpdatePhase('installing')
    const watchdog = window.setTimeout(() => {
      if (worker.state === 'installing') setUpdatePhase('idle')
    }, INSTALL_WATCHDOG_MS)
    const handleStateChange = () => {
      if (isUpdateReady(registration, worker)) {
        markUpdateAvailable()
      }
      // Still mid-install (the immediate call below): an update already parked
      // in registration.waiting must not repaint this phase as settled.
      if (worker.state === 'installing') return
      window.clearTimeout(watchdog)
      // Replaced by a newer installing worker — that install owns the phase.
      // 'redundant' itself is terminal here: the spec clears
      // registration.installing asynchronously after the event.
      if (registration.installing && registration.installing !== worker) return
      setUpdatePhase('idle')
    }
    worker.addEventListener('statechange', handleStateChange)
    handleStateChange()
  }
  registration.addEventListener('updatefound', () => watchWorker(registration.installing))
  watchWorker(registration.installing)
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
  timeoutMs = 30000,
): Promise<WaitingWorkerResult> {
  if (isUpdateReady(registration)) return Promise.resolve('available')

  return new Promise((resolve) => {
    let settled = false
    let installingSeen = false
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
      installingSeen = true

      const handleStateChange = () => {
        if (isUpdateReady(registration, worker)) {
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

    const timeoutId = window.setTimeout(() => done(installingSeen ? 'unavailable' : 'current'), timeoutMs)
    registration.addEventListener('updatefound', handleUpdateFound)
    cleanupCallbacks.push(() => registration.removeEventListener('updatefound', handleUpdateFound))
    watchWorker(registration.installing)
  })
}

// prompt mode + no skipWaiting: new SW installs in background and waits.
// Activates automatically on next app start (when old clients are gone).
// Applying now is user-driven (toast tap / settings button).
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    markUpdateAvailable()
    setUpdatePhase('idle')
    if (!shouldSuppressAutoUpdateToast()) {
      notifyUpdateAvailable()
    }
  },
  onOfflineReady() {
    console.log('[SW] Offline ready')
  },
  onRegisteredSW(swUrl, registration) {
    serviceWorkerRegistration = registration
    if (registration) watchRegistrationForInstalls(registration)
    console.log('[SW] Registered:', swUrl)
  },
  onRegisterError(error) {
    console.error('[SW] Registration failed:', error)
  },
})

function checkForAppUpdate(): Promise<AppUpdateCheckResult> {
  // Shared promise: a re-entered settings screen (or double tap) must not fire
  // a second registration.update() mid-check.
  if (inFlightCheck) return inFlightCheck
  inFlightCheck = doCheckForAppUpdate().finally(() => { inFlightCheck = null })
  return inFlightCheck
}

async function doCheckForAppUpdate(): Promise<AppUpdateCheckResult> {
  manualUpdateCheckInFlight = true
  if (useAppStore.getState().updatePhase === 'idle') {
    setUpdatePhase('checking')
  }
  try {
    const registration = await getCurrentRegistration()
    if (!registration) return 'unavailable'

    if (isUpdateReady(registration) || useAppStore.getState().updateAvailable) {
      markUpdateAvailable()
      return 'available'
    }

    if (registration.installing) {
      const existingWorkerResult = await waitForWaitingWorker(registration)
      if (existingWorkerResult === 'available' || useAppStore.getState().updateAvailable) {
        markUpdateAvailable()
        return 'available'
      }
      return existingWorkerResult
    }

    const updatedRegistration = await registration.update()
    serviceWorkerRegistration = updatedRegistration

    const isAvailable = isUpdateReady(updatedRegistration)
      || useAppStore.getState().updateAvailable

    if (isAvailable) {
      markUpdateAvailable()
      return 'available'
    }

    if (!updatedRegistration.installing) {
      return 'current'
    }

    const workerResult = await waitForWaitingWorker(updatedRegistration)
    if (workerResult === 'available' || useAppStore.getState().updateAvailable) {
      markUpdateAvailable()
      return 'available'
    }

    return workerResult
  } finally {
    manualUpdateCheckInFlight = false
    suppressAutoUpdateToastUntil = Date.now() + 1500
    // Only settle a plain check back to idle — an in-flight install keeps its
    // phase until the global watcher sees the worker leave the installing state
    // (a 30s-timeout return must not repaint "installing" as done).
    if (useAppStore.getState().updatePhase === 'checking') {
      setUpdatePhase('idle')
    }
  }
}

export { updateSW, checkForAppUpdate }
