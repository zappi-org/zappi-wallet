import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AppLifecycleWatcher } from '@/composition/app-lifecycle.watcher'

describe('AppLifecycleWatcher', () => {
  let onResume: () => Promise<void>
  let onPause: () => Promise<void>
  let watcher: AppLifecycleWatcher

  beforeEach(() => {
    onResume = vi.fn().mockResolvedValue(undefined)
    onPause = vi.fn().mockResolvedValue(undefined)
    watcher = new AppLifecycleWatcher({ onResume, onPause })
  })

  afterEach(() => {
    watcher.stop()
  })

  it('should call onResume when document becomes visible', () => {
    watcher.start()

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(onResume).toHaveBeenCalledOnce()
    expect(onPause).not.toHaveBeenCalled()
  })

  it('should call onPause when document becomes hidden', () => {
    watcher.start()

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(onPause).toHaveBeenCalledOnce()
    expect(onResume).not.toHaveBeenCalled()
  })

  it('should not listen before start()', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(onResume).not.toHaveBeenCalled()
  })

  it('should not listen after stop()', () => {
    watcher.start()
    watcher.stop()

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(onResume).not.toHaveBeenCalled()
  })

  it('should not double-register on multiple start() calls', () => {
    watcher.start()
    watcher.start()

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(onResume).toHaveBeenCalledOnce()
  })
})
