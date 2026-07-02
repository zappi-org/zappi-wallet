import { sat } from '@/core/domain/amount'
import { Ok, Err } from '@/core/domain/result'
import { UnknownError } from '@/core/errors/base'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { ServiceProvider } from '@/ui/hooks/service-context'
import { useReclaim } from '@/ui/hooks/use-reclaim'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockBroadcastSync = vi.fn()

vi.mock('@/utils/cross-tab-sync', () => ({
  broadcastSync: (...args: unknown[]) => mockBroadcastSync(...args),
}))

function createMockRegistry(reclaimService: ReturnType<typeof vi.fn>, txMgmt?: { getById: ReturnType<typeof vi.fn> }): ServiceRegistry {
  return {
    payment: {} as unknown as ServiceRegistry['payment'],
    reclaim: {
      reclaim: reclaimService,
    } as unknown as ServiceRegistry['reclaim'],
    mintInfo: { getInfo: vi.fn() } as unknown as ServiceRegistry['mintInfo'],
    recoveryScheduler: {
      reconcile: vi.fn().mockResolvedValue({ settled: 0, reclaimed: 0, failed: 0, cleaned: 0 }),
      recoverTargeted: vi.fn().mockResolvedValue({ moduleId: 'cashu', recovered: 0, failed: 0 }),
      drainReviewQueue: vi.fn().mockResolvedValue({ redeemed: 0, amount: 0 }),
      runFullNetworkRecovery: vi.fn().mockResolvedValue({ moduleId: 'cashu', recovered: 0, failed: 0 }),
    } as unknown as ServiceRegistry['recoveryScheduler'],
    incomingReviewQueue: {
      enqueue: vi.fn(), listAll: vi.fn().mockResolvedValue([]), listByMint: vi.fn().mockResolvedValue([]), remove: vi.fn(),
    } as unknown as ServiceRegistry['incomingReviewQueue'],
    eventBus: { emit: vi.fn(), on: vi.fn().mockReturnValue(() => { }), off: vi.fn() },
    balance: { getTotal: vi.fn(), getByModule: vi.fn() } as unknown as ServiceRegistry['balance'],
    swap: { getAvailableSwaps: vi.fn(), estimateSwap: vi.fn(), executeSwap: vi.fn() } as unknown as ServiceRegistry['swap'],
    contact: { list: vi.fn(), getById: vi.fn(), findByAddress: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() } as unknown as ServiceRegistry['contact'],
    inputRouter: { classify: vi.fn() } as unknown as ServiceRegistry['inputRouter'],
    addressResolver: { resolve: vi.fn() } as unknown as ServiceRegistry['addressResolver'],
    profile: { getProfile: vi.fn(), updateProfile: vi.fn(), publish: vi.fn() } as unknown as ServiceRegistry['profile'],
    recovery: { syncAll: vi.fn(), reconstructState: vi.fn(), retryFailedIncomings: vi.fn(), getFailedIncomings: vi.fn(), getSyncStatus: vi.fn(), cleanupOldData: vi.fn() } as unknown as ServiceRegistry['recovery'],
    incomingPayment: { processIncoming: vi.fn() } as unknown as ServiceRegistry['incomingPayment'],
    processedStore: { save: vi.fn(), exists: vi.fn(), existsByTxId: vi.fn(), findById: vi.fn(), findByTxId: vi.fn() } as unknown as ServiceRegistry['processedStore'],
    nostrGateway: { sendPrivateDirectMessage: vi.fn() } as unknown as ServiceRegistry['nostrGateway'],
    pendingItems: { getByMint: vi.fn(), getAll: vi.fn(), getActivePendingQuotes: vi.fn(), checkEffectiveExpiry: vi.fn(), expireById: vi.fn() } as unknown as ServiceRegistry['pendingItems'],
    withdraw: {} as unknown as ServiceRegistry['withdraw'],
    lnurlAuth: {} as unknown as ServiceRegistry['lnurlAuth'],
    mintMetadata: {} as unknown as ServiceRegistry['mintMetadata'],
    mintHealth: {} as unknown as ServiceRegistry['mintHealth'],
    crypto: {} as unknown as ServiceRegistry['crypto'],
    receiveRequest: {} as unknown as ServiceRegistry['receiveRequest'],
    transactionMgmt: {
      getById: txMgmt?.getById ?? vi.fn(),
    } as unknown as ServiceRegistry['transactionMgmt'],
    inputParser: {} as unknown as ServiceRegistry['inputParser'],
    paymentRequest: {} as unknown as ServiceRegistry['paymentRequest'],
    routing: {} as unknown as ServiceRegistry['routing'],
    username: {} as unknown as ServiceRegistry['username'],
    trustRegistry: { isTrusted: vi.fn(), addTrust: vi.fn(), revokeTrust: vi.fn(), getTrustedAccounts: vi.fn() } as unknown as ServiceRegistry['trustRegistry'],
    support: {} as unknown as ServiceRegistry['support'],
    nostrDirectPayment: { resolve: vi.fn() } as unknown as ServiceRegistry['nostrDirectPayment'],
    externalWalletRecovery: { recoverFromMnemonic: vi.fn() } as unknown as ServiceRegistry['externalWalletRecovery'],
    transferLifecycle: {
      initiateTransfer: vi.fn(),
      pollPendingTransfers: vi.fn(),
      reclaimTransfer: vi.fn(),
      processIncomingTransfer: vi.fn(),
      claimIncomingTransfer: vi.fn(),
      recoverTransfers: vi.fn(),
    } as unknown as ServiceRegistry['transferLifecycle'],
  }
}

describe('useReclaim', () => {
  let reclaimMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    reclaimMock = vi.fn()
    mockBroadcastSync.mockClear()
  })

  it('returns success with amount on successful reclaim', async () => {
    reclaimMock.mockResolvedValue(Ok({
      amount: { value: 500, unit: 'sat' },
      accountId: 'mint-1',
    }))
    const getByIdMock = vi.fn().mockResolvedValue({
      id: 'tx-1',
      amount: sat(500),
      accountId: 'mint-1',
      unit: 'sat',
    })
    const registry = createMockRegistry(reclaimMock, { getById: getByIdMock })

    const { result } = renderHook(() => useReclaim(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ServiceProvider registry={registry}>{children}</ServiceProvider>
      ),
    })

    const res = await act(() => result.current.reclaim('tx-1'))

    expect(res).toEqual({
      success: true,
      amount: { value: 500, unit: 'sat' },
      accountId: 'mint-1',
    })
    expect(reclaimMock).toHaveBeenCalledWith('tx-1')
    expect(mockBroadcastSync).toHaveBeenCalledWith('balance_changed')
  })

  it('returns error result when service not available', async () => {
    const { result } = renderHook(() => useReclaim(), {
      wrapper: ({ children }: { children: ReactNode }) => <ServiceProvider registry={null as unknown as ServiceRegistry}>{children}</ServiceProvider>,
    })

    const res = await act(() => result.current.reclaim('tx-1'))

    expect(res.success).toBe(false)
    expect(res.error).toBeDefined()
    expect(res.error?.code).toBe('SERVICE_NOT_READY')
  })

  it('returns error result when transaction not found', async () => {
    const getByIdMock = vi.fn().mockResolvedValue(null)
    const registry = createMockRegistry(reclaimMock, { getById: getByIdMock })

    const { result } = renderHook(() => useReclaim(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ServiceProvider registry={registry}>{children}</ServiceProvider>
      ),
    })

    const res = await act(() => result.current.reclaim('tx-1'))

    expect(res.success).toBe(false)
    expect(res.error).toBeDefined()
    expect(res.error?.code).toBe('TRANSACTION_NOT_FOUND')
  })

  it('returns error result when reclaim fails', async () => {
    reclaimMock.mockResolvedValue(Err(new UnknownError('Rollback failed')))
    const getByIdMock = vi.fn().mockResolvedValue({
      id: 'tx-1',
      accountId: 'mint-1',
      amount: sat(1000),
      unit: 'sat',
    })
    const registry = createMockRegistry(reclaimMock, { getById: getByIdMock })

    const { result } = renderHook(() => useReclaim(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ServiceProvider registry={registry}>{children}</ServiceProvider>
      ),
    })

    const res = await act(() => result.current.reclaim('tx-1'))

    expect(res.success).toBe(false)
    expect(res.error).toBeDefined()
    expect(res.error?.code).toBe('UNKNOWN')
    expect(res.accountId).toBe('mint-1')
  })
})
