import { sat } from '@/core/domain/amount'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { ServiceProvider } from '@/ui/hooks/service-context'
import { useReclaim } from '@/ui/hooks/use-reclaim'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRefreshBalance = vi.fn().mockResolvedValue(undefined)
const mockBroadcastSync = vi.fn()

vi.mock('@/utils/cross-tab-sync', () => ({
  broadcastSync: (...args: unknown[]) => mockBroadcastSync(...args),
}))

vi.mock('@/ui/hooks/use-wallet', () => ({
  useWallet: () => ({ refreshBalance: mockRefreshBalance }),
}))

function createMockRegistry(withReclaim: ReturnType<typeof vi.fn>, txMgmt?: {getById: ReturnType<typeof vi.fn>; reclaimSendToken: ReturnType<typeof vi.fn>}): ServiceRegistry {
  return {
    payment: {
      reclaim: withReclaim,
    } as unknown as ServiceRegistry['payment'],
    eventBus: { emit: vi.fn(), on: vi.fn().mockReturnValue(() => {}), off: vi.fn() },
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
      reclaimSendToken: txMgmt?.reclaimSendToken ?? vi.fn(),
    } as unknown as ServiceRegistry['transactionMgmt'],

    inputParser: {} as unknown as ServiceRegistry['inputParser'],
    paymentRequest: {} as unknown as ServiceRegistry['paymentRequest'],
    routing: {} as unknown as ServiceRegistry['routing'],
    username: {} as unknown as ServiceRegistry['username'],
    trustRegistry: { isTrusted: vi.fn(), addTrust: vi.fn(), revokeTrust: vi.fn(), getTrustedAccounts: vi.fn() } as unknown as ServiceRegistry['trustRegistry'],
    support: {} as unknown as ServiceRegistry['support'],
    nostrDirectPayment: { resolve: vi.fn() } as unknown as ServiceRegistry['nostrDirectPayment'],
    externalWalletRecovery: { recoverFromMnemonic: vi.fn() } as unknown as ServiceRegistry['externalWalletRecovery'],
  }
}

describe('useReclaim', () => {
  let reclaimMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    reclaimMock = vi.fn()
    mockRefreshBalance.mockClear()
    mockBroadcastSync.mockClear()
  })

  function wrapper({ children }: { children: ReactNode }) {
    const registry = createMockRegistry(reclaimMock)
    return <ServiceProvider registry={registry}>{children}</ServiceProvider>
  }

  it('returns reclaimed amount on success', async () => {
    reclaimMock.mockResolvedValue({ ok: true, value: { amount: sat(500), transactionId: 'tx-1' } })

    const { result } = renderHook(() => useReclaim(), { wrapper })

    const res = await act(() => result.current.reclaim('tx-1'))

    expect(res).toEqual({ amount: 500 })
    expect(reclaimMock).toHaveBeenCalledWith({ transactionId: 'tx-1' })
  })

  it('throws when service not available', async () => {
    const { result } = renderHook(() => useReclaim(), {
      wrapper: ({ children }: { children: ReactNode }) => <ServiceProvider registry={null as unknown as ServiceRegistry}>{children}</ServiceProvider>,
    })

    await expect(result.current.reclaim('tx-1')).rejects.toThrow('Service not available')
  })

  it('throws PaymentError when reclaim fails', async () => {
    const error = { code: 'TOKEN_SPENT', message: 'Already spent' }
    reclaimMock.mockResolvedValue({ ok: false, error })

    const { result } = renderHook(() => useReclaim(), { wrapper })

    await expect(result.current.reclaim('tx-1')).rejects.toBe(error)
  })

  it('calls refreshBalance and broadcastSync after successful reclaim', async () => {
    reclaimMock.mockResolvedValue({ ok: true, value: { amount: sat(100), transactionId: 'tx-1' } })

    const { result } = renderHook(() => useReclaim(), { wrapper })
    await act(() => result.current.reclaim('tx-1'))

    expect(mockRefreshBalance).toHaveBeenCalled()
    expect(mockBroadcastSync).toHaveBeenCalledWith('balance_changed')
  })
  
  describe('relcaimToken', () => {
    let getByIdMock: ReturnType<typeof vi.fn>
    let reclaimSendTokenMock: ReturnType<typeof vi.fn>

    beforeEach(()=> {
      getByIdMock = vi.fn()
      reclaimSendTokenMock = vi.fn()
      mockRefreshBalance.mockClear()
      mockBroadcastSync.mockClear()
    })
    function txWrapper({children }: {children:ReactNode}){
      const registry= createMockRegistry(reclaimMock, {
        getById: getByIdMock,
        reclaimSendToken: reclaimSendTokenMock,
    })
    return <ServiceProvider registry={registry}>{children}</ServiceProvider>
    } 
    
    it('reclaims token and refreshes balance', async () => {
      getByIdMock.mockResolvedValue({
        id:'tx-1',
        metadata: {operationId: 'op-1', token: 'cashuBtoken123' },
      })
      reclaimSendTokenMock.mockResolvedValue({success:true})
      
      const {result} = renderHook(()=> useReclaim(), {wrapper: txWrapper})
      await act(() => result.current.reclaimToken('tx-1'))

      expect(reclaimSendTokenMock).toHaveBeenCalledWith('tx-1','op-1', 'cashuBtoken123')
      expect(mockRefreshBalance).toHaveBeenCalled()
      expect(mockBroadcastSync).toHaveBeenCalledWith('balance_changed')
    })

    it('throws when service not available', async () => {
      const { result } = renderHook(() => useReclaim(), {
        wrapper: ({ children }) => <ServiceProvider registry={null as unknown as ServiceRegistry}>{children}</ServiceProvider>,
      })
      await expect(result.current.reclaimToken('tx-1')).rejects.toThrow('Service not available')
    })
    it('throws when transaction not found', async () => {
      getByIdMock.mockResolvedValue(null)
      const { result } = renderHook(() => useReclaim(), { wrapper: txWrapper })
      await expect(result.current.reclaimToken('tx-1')).rejects.toThrow('Token reclaim failed')
    })
    it('throws TOKEN_SPENT error when token already spent', async () => {
      getByIdMock.mockResolvedValue({
        id: 'tx-1',
        metadata: { operationId: 'op-1' },
      })
      reclaimSendTokenMock.mockResolvedValue({ success: false, alreadySpent: true })
      const { result } = renderHook(() => useReclaim(), { wrapper: txWrapper })
      try {
        await result.current.reclaimToken('tx-1')
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe('Token already spent')
        expect((error as { code?: string }).code).toBe('TOKEN_SPENT')
      }
    })
  })
})
