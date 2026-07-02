/**
 * coco-sdk enableWatchers — 오프라인 재시도 (설계 §7.1-3)
 *
 * 오프라인 unlock 시 watcher가 영구 비활성으로 남던 결함의 회귀 테스트.
 * 모듈 싱글턴 상태(watchersEnabled, retry 리스너) 때문에 테스트마다
 * vi.resetModules() + 동적 import로 새 모듈 인스턴스를 쓴다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  enableMintOperationWatcher: vi.fn(),
  enableProofStateWatcher: vi.fn(),
  disableMintOperationWatcher: vi.fn(),
  dispose: vi.fn(),
}))

vi.mock('@cashu/coco-core', () => ({
  initializeCoco: vi.fn(async () => ({
    enableMintOperationWatcher: mocks.enableMintOperationWatcher,
    enableProofStateWatcher: mocks.enableProofStateWatcher,
    disableMintOperationWatcher: mocks.disableMintOperationWatcher,
    dispose: mocks.dispose,
  })),
  normalizeMintUrl: (url: string) => url,
}))

vi.mock('@cashu/coco-indexeddb', () => ({
  IndexedDbRepositories: class {
    db = { runTransaction: vi.fn() }
    mintQuoteRepository = {}
  },
}))

vi.mock('@/modules/cashu/internal/seed-getter', () => ({
  getSeed: vi.fn(async () => new Uint8Array(64)),
}))

vi.mock('@/modules/cashu/internal/logger', () => ({
  cocoLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function setOnline(value: boolean): void {
  // setup.ts가 onLine을 writable(비configurable)로 정의 — 재정의 대신 할당
  ;(navigator as unknown as { onLine: boolean }).onLine = value
}

async function importCocoSdk() {
  vi.resetModules()
  return import('@/modules/cashu/internal/coco-sdk')
}

describe('coco-sdk enableWatchers — offline retry', () => {
  beforeEach(() => {
    mocks.enableMintOperationWatcher.mockClear().mockResolvedValue(undefined)
    mocks.enableProofStateWatcher.mockClear().mockResolvedValue(undefined)
    mocks.dispose.mockClear().mockResolvedValue(undefined)
    setOnline(true)
  })

  it('enables both watchers when online', async () => {
    const sdk = await importCocoSdk()

    await sdk.enableWatchers()

    expect(mocks.enableMintOperationWatcher).toHaveBeenCalledWith({ watchExistingPendingOnStart: true })
    expect(mocks.enableProofStateWatcher).toHaveBeenCalledTimes(1)
  })

  it('defers when offline and retries once the browser comes online', async () => {
    setOnline(false)
    const sdk = await importCocoSdk()

    await sdk.enableWatchers()
    expect(mocks.enableMintOperationWatcher).not.toHaveBeenCalled()

    setOnline(true)
    window.dispatchEvent(new Event('online'))

    await vi.waitFor(() => {
      expect(mocks.enableMintOperationWatcher).toHaveBeenCalledTimes(1)
      expect(mocks.enableProofStateWatcher).toHaveBeenCalledTimes(1)
    })
  })

  it('schedules the online retry at most once for repeated offline attempts', async () => {
    setOnline(false)
    const sdk = await importCocoSdk()

    await sdk.enableWatchers()
    await sdk.enableWatchers()

    setOnline(true)
    window.dispatchEvent(new Event('online'))

    await vi.waitFor(() => {
      expect(mocks.enableMintOperationWatcher).toHaveBeenCalledTimes(1)
    })
  })

  it('resetCocoManager cancels a pending retry — no Coco re-init after logout', async () => {
    setOnline(false)
    const sdk = await importCocoSdk()

    await sdk.enableWatchers()
    await sdk.resetCocoManager()

    setOnline(true)
    window.dispatchEvent(new Event('online'))

    // 리스너가 정리됐으므로 online 이벤트가 watcher를 켜지 않아야 한다
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mocks.enableMintOperationWatcher).not.toHaveBeenCalled()
  })

  it('does not double-enable after a successful enable', async () => {
    const sdk = await importCocoSdk()

    await sdk.enableWatchers()
    await sdk.enableWatchers()

    expect(mocks.enableMintOperationWatcher).toHaveBeenCalledTimes(1)
  })
})
