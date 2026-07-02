import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ServiceProvider } from '@/ui/hooks/service-context'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import type { ReactNode } from 'react'

function createMockRegistry(): ServiceRegistry {
  return {
    eventBus: {
      emit: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
      off: vi.fn(),
    },
    payment: {
      getAccounts: vi.fn(),
      getMethodsForAccount: vi.fn(),
      send: vi.fn(),
      receive: vi.fn(),
      redeem: vi.fn(),
      estimateFee: vi.fn(),
      recoverAll: vi.fn(),
    } as unknown as ServiceRegistry['payment'],
    balance: {
      getTotal: vi.fn(),
      getByModule: vi.fn(),
    } as unknown as ServiceRegistry['balance'],
    swap: {
      getAvailableSwaps: vi.fn(),
      estimateSwap: vi.fn(),
      executeSwap: vi.fn(),
    } as unknown as ServiceRegistry['swap'],
    contact: {
      list: vi.fn(),
      getById: vi.fn(),
      findByAddress: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as ServiceRegistry['contact'],
    inputRouter: {
      classify: vi.fn(),
    } as unknown as ServiceRegistry['inputRouter'],
    addressResolver: {
      resolve: vi.fn(),
    } as unknown as ServiceRegistry['addressResolver'],
    profile: {
      getProfile: vi.fn(),
      updateProfile: vi.fn(),
      publish: vi.fn(),
    } as unknown as ServiceRegistry['profile'],
    mintInfo: {
      getInfo: vi.fn(),
    } as unknown as ServiceRegistry['mintInfo'],
    recovery: {
      syncAll: vi.fn(),
      reconstructState: vi.fn(),
      resyncFull: vi.fn(),
      retryFailedIncomings: vi.fn(),
      getFailedIncomings: vi.fn(),
      getSyncStatus: vi.fn(),
      cleanupOldData: vi.fn(),
    } as unknown as ServiceRegistry['recovery'],
    reclaim: {
      reclaim: vi.fn(),
      finalizeSend: vi.fn(),
      markSendReclaimed: vi.fn(),
    } as unknown as ServiceRegistry['reclaim'],
    incomingPayment: {
      processIncoming: vi.fn(),
    } as unknown as ServiceRegistry['incomingPayment'],
    processedStore: {
      save: vi.fn(),
      exists: vi.fn(),
      existsByTxId: vi.fn(),
      findById: vi.fn(),
      findByTxId: vi.fn(),
    } as unknown as ServiceRegistry['processedStore'],
    nostrGateway: {
      sendPrivateDirectMessage: vi.fn(),
    } as unknown as ServiceRegistry['nostrGateway'],
    pendingItems: {
      getByMint: vi.fn(),
      getAll: vi.fn(),
      getActivePendingQuotes: vi.fn(),
      checkEffectiveExpiry: vi.fn(),
      expireById: vi.fn(),
    } as unknown as ServiceRegistry['pendingItems'],
    withdraw: {} as unknown as ServiceRegistry['withdraw'],
    lnurlAuth: {} as unknown as ServiceRegistry['lnurlAuth'],
    mintMetadata: {} as unknown as ServiceRegistry['mintMetadata'],
    mintHealth: {} as unknown as ServiceRegistry['mintHealth'],
    crypto: {} as unknown as ServiceRegistry['crypto'],
    receiveRequest: {} as unknown as ServiceRegistry['receiveRequest'],
    transactionMgmt: {} as unknown as ServiceRegistry['transactionMgmt'],
    inputParser: {} as unknown as ServiceRegistry['inputParser'],
    paymentRequest: {} as unknown as ServiceRegistry['paymentRequest'],
    routing: {} as unknown as ServiceRegistry['routing'],
    username: {} as unknown as ServiceRegistry['username'],
    trustRegistry: {
      isTrusted: vi.fn(),
      addTrust: vi.fn(),
      revokeTrust: vi.fn(),
      getTrustedAccounts: vi.fn(),
    } as unknown as ServiceRegistry['trustRegistry'],
    support: {} as unknown as ServiceRegistry['support'],
    nostrDirectPayment: {
      resolve: vi.fn(),
    } as unknown as ServiceRegistry['nostrDirectPayment'],
    externalWalletRecovery: {
      recoverFromMnemonic: vi.fn(),
    } as unknown as ServiceRegistry['externalWalletRecovery'],
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

describe('ServiceContext', () => {
  it('should provide ServiceRegistry to children', () => {
    const mockRegistry = createMockRegistry()

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServiceProvider registry={mockRegistry}>{children}</ServiceProvider>
    )

    const { result } = renderHook(() => useServiceRegistry(), { wrapper })

    expect(result.current).toBe(mockRegistry)
    expect(result.current.payment).toBe(mockRegistry.payment)
    expect(result.current.balance).toBe(mockRegistry.balance)
    expect(result.current.swap).toBe(mockRegistry.swap)
    expect(result.current.contact).toBe(mockRegistry.contact)
    expect(result.current.eventBus).toBe(mockRegistry.eventBus)
  })

  it('should throw when used outside ServiceProvider', () => {
    // Suppress expected console.error from React
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      renderHook(() => useServiceRegistry())
    }).toThrow('useServiceRegistry must be used within ServiceProvider')

    spy.mockRestore()
  })
})
