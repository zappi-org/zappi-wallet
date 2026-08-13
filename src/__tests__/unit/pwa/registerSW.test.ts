/**
 * registerSW — global update-phase ownership: browser-initiated installs,
 * manual checks, duplicate-call guard, timeout semantics, and the
 * first-install case (no controller) that must never strand the phase.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AppUpdateCheckResult } from '@/registerSW'

interface RegisterSWOptions {
  onNeedRefresh?: () => void
  onRegisteredSW?: (url: string, registration: unknown) => void
}

const holder = vi.hoisted(() => {
  const state = {
    updateAvailable: false,
    updatePhase: 'idle' as 'idle' | 'checking' | 'installing',
    setUpdateAvailable(v: boolean) { state.updateAvailable = v },
    setUpdatePhase(p: 'idle' | 'checking' | 'installing') { state.updatePhase = p },
    addToast: (_t: unknown) => {},
  }
  return {
    state,
    capturedOptions: null as RegisterSWOptions | null,
    reset() {
      state.updateAvailable = false
      state.updatePhase = 'idle'
      holder.capturedOptions = null
    },
  }
})

vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: RegisterSWOptions) => {
    holder.capturedOptions = options
    return vi.fn()
  },
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => holder.state } }))
vi.mock('@/i18n', () => ({ default: { t: (k: string) => k } }))

class FakeWorker extends EventTarget {
  state: string = 'installing'
  setState(next: string) {
    this.state = next
    this.dispatchEvent(new Event('statechange'))
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null
  waiting: FakeWorker | null = null
  active: FakeWorker | null = null
  update = vi.fn(async (): Promise<FakeRegistration> => this)

  startInstall(): FakeWorker {
    const worker = new FakeWorker()
    this.installing = worker
    this.dispatchEvent(new Event('updatefound'))
    return worker
  }
  /** installed: the worker moves installing → waiting (per SW spec). */
  finishInstall(worker: FakeWorker) {
    this.installing = null
    this.waiting = worker
    worker.setState('installed')
  }
  activate(worker: FakeWorker) {
    this.waiting = null
    this.active = worker
    worker.setState('activating')
  }
}

function setController(controller: object | null) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller, getRegistration: vi.fn(async () => undefined) },
  })
}

async function boot(registration: FakeRegistration) {
  const mod = await import('@/registerSW')
  holder.capturedOptions?.onRegisteredSW?.('/service-worker.js', registration)
  return mod
}

describe('registerSW update phase', () => {
  beforeEach(() => {
    vi.resetModules()
    holder.reset()
    setController(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('browser auto-install: updatefound → installing, installed+controller → idle + available', async () => {
    setController({})
    const reg = new FakeRegistration()
    await boot(reg)

    const worker = reg.startInstall()
    expect(holder.state.updatePhase).toBe('installing')

    reg.finishInstall(worker)
    expect(holder.state.updatePhase).toBe('idle')
    expect(holder.state.updateAvailable).toBe(true)
  })

  it('first install (no controller): never marks an update and settles back to idle', async () => {
    const reg = new FakeRegistration()
    await boot(reg)

    const worker = reg.startInstall()
    expect(holder.state.updatePhase).toBe('installing')

    reg.finishInstall(worker)
    reg.activate(worker)
    expect(holder.state.updatePhase).toBe('idle')
    expect(holder.state.updateAvailable).toBe(false)
  })

  it("manual check with no update: 'current', phase checking → idle", async () => {
    const reg = new FakeRegistration()
    const { checkForAppUpdate } = await boot(reg)

    const seenPhases: string[] = []
    const originalSet = holder.state.setUpdatePhase.bind(holder.state)
    holder.state.setUpdatePhase = (p) => { seenPhases.push(p); originalSet(p) }

    await expect(checkForAppUpdate()).resolves.toBe('current')
    expect(seenPhases).toEqual(['checking', 'idle'])
    expect(reg.update).toHaveBeenCalledTimes(1)
  })

  it('duplicate calls share one in-flight check (a single registration.update())', async () => {
    const reg = new FakeRegistration()
    let release: (r: FakeRegistration) => void = () => {}
    reg.update = vi.fn(() => new Promise<FakeRegistration>((resolve) => { release = resolve }))
    const { checkForAppUpdate } = await boot(reg)

    const first = checkForAppUpdate()
    const second = checkForAppUpdate()
    expect(second).toBe(first)

    // update() is only reached after async registration lookup — wait for it
    // so `release` holds the real resolver before we call it.
    await vi.waitFor(() => expect(reg.update).toHaveBeenCalledTimes(1))
    release(reg)
    await expect(first).resolves.toBe('current')
    expect(reg.update).toHaveBeenCalledTimes(1)
  })

  it("30s install timeout returns 'unavailable' but keeps the phase at installing until the worker settles", async () => {
    vi.useFakeTimers()
    const reg = new FakeRegistration()
    const { checkForAppUpdate } = await boot(reg)
    const worker = reg.startInstall()

    const pending: Promise<AppUpdateCheckResult> = checkForAppUpdate()
    await vi.advanceTimersByTimeAsync(30000)
    await expect(pending).resolves.toBe('unavailable')
    expect(holder.state.updatePhase).toBe('installing')

    // The stalled worker finally dies. Per the SW spec, registration.installing
    // is cleared asynchronously AFTER the redundant statechange — the watcher
    // must treat 'redundant' as terminal without waiting for that.
    worker.setState('redundant')
    reg.installing = null
    expect(holder.state.updatePhase).toBe('idle')
  })

  it('a failing update() propagates and restores the phase to idle', async () => {
    const reg = new FakeRegistration()
    reg.update = vi.fn(async () => { throw new Error('offline') })
    const { checkForAppUpdate } = await boot(reg)

    await expect(checkForAppUpdate()).rejects.toThrow('offline')
    expect(holder.state.updatePhase).toBe('idle')
  })
})
