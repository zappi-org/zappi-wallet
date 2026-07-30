import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const manager = {
    ops: {
      send: {
        get: vi.fn(),
        cancel: vi.fn(),
        reclaim: vi.fn(),
      },
    },
  }

  return { manager, getCocoManager: vi.fn() }
})

vi.mock('./coco-sdk', () => ({
  getCocoManager: mocks.getCocoManager,
  getPendingMintQuotes: vi.fn(),
}))

import { rollbackSend } from './cashu-backend'

describe('rollbackSend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCocoManager.mockResolvedValue(mocks.manager)
    mocks.manager.ops.send.cancel.mockResolvedValue(undefined)
    mocks.manager.ops.send.reclaim.mockResolvedValue(undefined)
  })

  it('cancels a send that was prepared but never executed', async () => {
    mocks.manager.ops.send.get.mockResolvedValue({ id: 'op-1', state: 'prepared' })

    await rollbackSend('op-1')

    expect(mocks.manager.ops.send.cancel).toHaveBeenCalledWith('op-1')
    expect(mocks.manager.ops.send.reclaim).not.toHaveBeenCalled()
  })

  it('reclaims a send whose funds are already committed', async () => {
    mocks.manager.ops.send.get.mockResolvedValue({ id: 'op-2', state: 'pending' })

    await rollbackSend('op-2')

    expect(mocks.manager.ops.send.reclaim).toHaveBeenCalledWith('op-2')
    expect(mocks.manager.ops.send.cancel).not.toHaveBeenCalled()
  })

  // A missing operation used to reach reclaim(), which throws "not found" inside
  // coco and masks the failure the caller was compensating for.
  it('is a no-op when the operation no longer exists', async () => {
    mocks.manager.ops.send.get.mockResolvedValue(null)

    await expect(rollbackSend('op-gone')).resolves.toBeUndefined()

    expect(mocks.manager.ops.send.cancel).not.toHaveBeenCalled()
    expect(mocks.manager.ops.send.reclaim).not.toHaveBeenCalled()
  })
})
