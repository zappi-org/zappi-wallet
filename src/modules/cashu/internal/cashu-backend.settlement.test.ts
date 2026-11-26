import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const manager = {
    ops: {
      melt: {
        get: vi.fn(),
        refresh: vi.fn(),
      },
    },
  }
  return { manager, getCocoManager: vi.fn() }
})

vi.mock('./coco-sdk', () => ({
  getCocoManager: mocks.getCocoManager,
  getPendingMintQuotes: vi.fn(),
  getProofsByOperationId: vi.fn(),
}))

import { checkMeltSettlement } from './cashu-backend'

describe('checkMeltSettlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCocoManager.mockResolvedValue(mocks.manager)
  })

  it('never refreshes an operation another context is executing', async () => {
    mocks.manager.ops.melt.get.mockResolvedValue({ id: 'op-1', state: 'executing' })

    await expect(checkMeltSettlement('op-1')).resolves.toEqual({ state: 'executing' })
    expect(mocks.manager.ops.melt.refresh).not.toHaveBeenCalled()
  })

  it('reports a settled operation without refreshing it', async () => {
    mocks.manager.ops.melt.get.mockResolvedValue({ id: 'op-1', state: 'finalized' })

    await expect(checkMeltSettlement('op-1')).resolves.toEqual({ state: 'finalized' })
    expect(mocks.manager.ops.melt.refresh).not.toHaveBeenCalled()
  })

  it('refreshes a pending operation to learn its settlement', async () => {
    mocks.manager.ops.melt.get.mockResolvedValue({ id: 'op-1', state: 'pending' })
    mocks.manager.ops.melt.refresh.mockResolvedValue({ id: 'op-1', state: 'finalized' })

    await expect(checkMeltSettlement('op-1')).resolves.toEqual({ state: 'finalized' })
    expect(mocks.manager.ops.melt.refresh).toHaveBeenCalledWith('op-1')
  })

  it('reports an unknown operation without refreshing', async () => {
    mocks.manager.ops.melt.get.mockResolvedValue(null)

    await expect(checkMeltSettlement('op-1')).resolves.toEqual({ state: 'unknown' })
    expect(mocks.manager.ops.melt.refresh).not.toHaveBeenCalled()
  })
})
