import { sat } from '@/core/domain/amount'
import { Err, Ok } from '@/core/domain/result'
import { UnknownError } from '@/core/errors/base'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { reclaimTransaction } from '@/ui/actions/reclaim-transaction'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockBroadcastSync = vi.fn()

vi.mock('@/utils/cross-tab-sync', () => ({
  broadcastSync: (...args: unknown[]) => mockBroadcastSync(...args),
}))

function createRegistry(params: {
  getById?: ReturnType<typeof vi.fn>
  reclaim?: ReturnType<typeof vi.fn>
}): Pick<ServiceRegistry, 'reclaim' | 'transactionMgmt'> {
  return {
    transactionMgmt: {
      getById: params.getById ?? vi.fn(),
    } as unknown as ServiceRegistry['transactionMgmt'],
    reclaim: {
      reclaim: params.reclaim ?? vi.fn(),
    } as unknown as ServiceRegistry['reclaim'],
  }
}

describe('reclaimTransaction', () => {
  beforeEach(() => {
    mockBroadcastSync.mockClear()
  })

  it('executes reclaim with an explicit registry instead of React context', async () => {
    const getById = vi.fn().mockResolvedValue({
      id: 'tx-1',
      accountId: 'mint-1',
      amount: sat(100),
    })
    const reclaim = vi.fn().mockResolvedValue(Ok({
      amount: { value: 100, unit: 'sat' },
      accountId: 'mint-1',
    }))

    const result = await reclaimTransaction(createRegistry({ getById, reclaim }), 'tx-1')

    expect(result.success).toBe(true)
    expect(reclaim).toHaveBeenCalledWith('tx-1')
    expect(mockBroadcastSync).toHaveBeenCalledWith('balance_changed')
  })

  it('returns service-not-ready when no registry is available', async () => {
    const result = await reclaimTransaction(null, 'tx-1')

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SERVICE_NOT_READY')
  })

  it('keeps transaction amount context when reclaim fails', async () => {
    const getById = vi.fn().mockResolvedValue({
      id: 'tx-1',
      accountId: 'mint-1',
      amount: sat(250),
    })
    const reclaim = vi.fn().mockResolvedValue(Err(new UnknownError('rollback failed')))

    const result = await reclaimTransaction(createRegistry({ getById, reclaim }), 'tx-1')

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('UNKNOWN')
    expect(result.amount).toEqual({ value: 250, unit: 'sat' })
    expect(result.accountId).toBe('mint-1')
  })
})
