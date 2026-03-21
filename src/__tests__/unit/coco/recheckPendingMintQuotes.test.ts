import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockManager } = vi.hoisted(() => {
  const mockManager = {
    enableMintQuoteWatcher: vi.fn().mockResolvedValue(undefined),
    disableMintQuoteWatcher: vi.fn().mockResolvedValue(undefined),
    enableProofStateWatcher: vi.fn().mockResolvedValue(undefined),
    wallet: { getBalances: vi.fn().mockResolvedValue({}) },
    on: vi.fn().mockReturnValue(() => {}),
    dispose: vi.fn().mockResolvedValue(undefined),
  }
  return { mockManager }
})

vi.mock('coco-cashu-core', () => ({
  initializeCoco: vi.fn().mockResolvedValue(mockManager),
  ConsoleLogger: vi.fn(),
}))

vi.mock('coco-cashu-indexeddb', () => ({
  IndexedDbRepositories: class {
    mintQuoteRepository = { getPendingMintQuotes: vi.fn().mockResolvedValue([]) }
  },
}))

vi.mock('@/coco/seedGetter', () => ({
  getSeed: vi.fn(),
}))

vi.mock('@/coco/bridge', () => ({
  connectCocoToStore: vi.fn(),
}))

import { recheckPendingMintQuotes, enableWatchers, resetCocoManager, getCocoManager } from '@/coco/manager'

describe('recheckPendingMintQuotes', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await resetCocoManager()
  })

  it('does nothing when watchers are not enabled', async () => {
    await recheckPendingMintQuotes()

    expect(mockManager.disableMintQuoteWatcher).not.toHaveBeenCalled()
    expect(mockManager.enableMintQuoteWatcher).not.toHaveBeenCalled()
  })

  it('cycles watcher with watchExistingPendingOnStart when watchers are enabled', async () => {
    await getCocoManager()
    await enableWatchers()
    vi.clearAllMocks()

    await recheckPendingMintQuotes()

    expect(mockManager.disableMintQuoteWatcher).toHaveBeenCalledOnce()
    expect(mockManager.enableMintQuoteWatcher).toHaveBeenCalledWith({ watchExistingPendingOnStart: true })
  })

  it('calls disable before enable (correct order)', async () => {
    await getCocoManager()
    await enableWatchers()
    vi.clearAllMocks()

    const callOrder: string[] = []
    mockManager.disableMintQuoteWatcher.mockImplementation(async () => {
      callOrder.push('disable')
    })
    mockManager.enableMintQuoteWatcher.mockImplementation(async () => {
      callOrder.push('enable')
    })

    await recheckPendingMintQuotes()

    expect(callOrder).toEqual(['disable', 'enable'])
  })

  it('propagates errors from disableMintQuoteWatcher', async () => {
    await getCocoManager()
    await enableWatchers()
    vi.clearAllMocks()

    const error = new Error('disable failed')
    mockManager.disableMintQuoteWatcher.mockRejectedValueOnce(error)

    await expect(recheckPendingMintQuotes()).rejects.toThrow('disable failed')
  })
})
