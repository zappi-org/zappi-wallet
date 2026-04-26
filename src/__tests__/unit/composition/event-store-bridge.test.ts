import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createEventBus, type EventBus } from '@/core/events/event-bus'
import { connectEventStoreBridge } from '@/composition/event-store-bridge'
import { useAppStore } from '@/store'
import { sat } from '@/core/domain/amount'

describe('EventStoreBridge', () => {
  let eventBus: EventBus
  let disconnect: () => void

  beforeEach(() => {
    eventBus = createEventBus()
    disconnect = connectEventStoreBridge(eventBus)
  })

  afterEach(() => {
    disconnect()
  })

  it('should show toast on payment:completed', () => {
    const addToast = vi.fn()
    vi.spyOn(useAppStore, 'getState').mockReturnValue({
      ...useAppStore.getState(),
      addToast,
    })

    eventBus.emit({
      type: 'payment:completed',
      payload: { txId: 'tx-1', method: 'cashu:bolt11', amount: sat(1000) },
    })

    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    )
  })

  it('should show error toast on payment:failed', () => {
    const addToast = vi.fn()
    vi.spyOn(useAppStore, 'getState').mockReturnValue({
      ...useAppStore.getState(),
      addToast,
    })

    eventBus.emit({
      type: 'payment:failed',
      payload: { txId: 'tx-2', method: 'cashu:bolt11', error: 'Insufficient balance' },
    })

    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Insufficient balance' }),
    )
  })

  it('should show toast on swap:completed', () => {
    const addToast = vi.fn()
    vi.spyOn(useAppStore, 'getState').mockReturnValue({
      ...useAppStore.getState(),
      addToast,
    })

    eventBus.emit({
      type: 'swap:completed',
      payload: {
        sendTxId: 'tx-3',
        receiveTxId: 'tx-4',
        sourceAccountId: 'mint-a',
        targetAccountId: 'mint-b',
        amount: sat(5000),
        fee: sat(10),
      },
    })

    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    )
  })

  it('should not show a global toast on swap:failed', () => {
    const addToast = vi.fn()
    vi.spyOn(useAppStore, 'getState').mockReturnValue({
      ...useAppStore.getState(),
      addToast,
    })

    eventBus.emit({
      type: 'swap:failed',
      payload: {
        sourceAccountId: 'mint-a',
        targetAccountId: 'mint-b',
        error: 'not enough proofs to send',
      },
    })

    expect(addToast).not.toHaveBeenCalled()
  })

  it('should show toast on recovery:completed with recovered > 0', () => {
    const addToast = vi.fn()
    vi.spyOn(useAppStore, 'getState').mockReturnValue({
      ...useAppStore.getState(),
      addToast,
    })

    eventBus.emit({
      type: 'recovery:completed',
      payload: { moduleId: 'cashu', recovered: 3, failed: 0 },
    })

    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    )
  })

  it('should not show toast on recovery:completed with recovered = 0', () => {
    const addToast = vi.fn()
    vi.spyOn(useAppStore, 'getState').mockReturnValue({
      ...useAppStore.getState(),
      addToast,
    })

    eventBus.emit({
      type: 'recovery:completed',
      payload: { moduleId: 'cashu', recovered: 0, failed: 0 },
    })

    expect(addToast).not.toHaveBeenCalled()
  })

  it('should cleanup all listeners on disconnect', () => {
    const addToast = vi.fn()
    vi.spyOn(useAppStore, 'getState').mockReturnValue({
      ...useAppStore.getState(),
      addToast,
    })

    disconnect()

    eventBus.emit({
      type: 'payment:completed',
      payload: { txId: 'tx-5', method: 'cashu:bolt11', amount: sat(100) },
    })

    expect(addToast).not.toHaveBeenCalled()
  })

  it('should not handle balance:changed by default', () => {
    // Default: handleBalance = false
    let balanceHandled = false
    const originalOn = eventBus.on.bind(eventBus)
    vi.spyOn(eventBus, 'on').mockImplementation((type, handler) => {
      if (type === 'balance:changed') balanceHandled = true
      return originalOn(type, handler)
    })

    const d = connectEventStoreBridge(eventBus, { handleBalance: false })
    expect(balanceHandled).toBe(false)
    d()
  })

  describe('receive:settled → ReceiveRequest completion', () => {
    it('ecash(wallet-xxx) requestId settlement을 ReceiveRequest use case로 전달', async () => {
      const receiveRequest = {
        settleByPaymentRef: vi.fn().mockResolvedValue(null),
      }

      const d = connectEventStoreBridge(eventBus, { receiveRequest })

      eventBus.emit({
        type: 'receive:settled',
        payload: {
          requestId: 'wallet-abc123',
          amount: 1000,
          accountId: 'account-1',
          method: 'nostr-gift-wrap',
          isSwapStep: false,
        },
      })

      await vi.waitFor(() => expect(receiveRequest.settleByPaymentRef).toHaveBeenCalledWith(
        'wallet-abc123',
        'nostr-gift-wrap',
      ))

      d()
    })

    it('bolt11 quote settlement을 ReceiveRequest use case로 전달', async () => {
      const receiveRequest = {
        settleByPaymentRef: vi.fn().mockResolvedValue(null),
      }

      const d = connectEventStoreBridge(eventBus, { receiveRequest })

      eventBus.emit({
        type: 'receive:settled',
        payload: {
          requestId: 'qt-deadbeef',
          amount: 2000,
          accountId: 'account-1',
          method: 'bolt11',
          isSwapStep: false,
        },
      })

      await vi.waitFor(() => expect(receiveRequest.settleByPaymentRef).toHaveBeenCalledWith(
        'qt-deadbeef',
        'bolt11',
      ))

      d()
    })

    it('swap step settlement은 ReceiveRequest lifecycle을 건드리지 않음', async () => {
      const receiveRequest = {
        settleByPaymentRef: vi.fn().mockResolvedValue(null),
      }

      const d = connectEventStoreBridge(eventBus, { receiveRequest })

      eventBus.emit({
        type: 'receive:settled',
        payload: {
          requestId: 'wallet-abc123',
          amount: 1000,
          accountId: 'account-1',
          method: 'nostr-gift-wrap',
          isSwapStep: true,
        },
      })

      expect(receiveRequest.settleByPaymentRef).not.toHaveBeenCalled()

      d()
    })

    it('receiveRequest 미주입 시 에러 없이 동작', () => {
      const d = connectEventStoreBridge(eventBus)

      expect(() => {
        eventBus.emit({
          type: 'receive:settled',
          payload: {
            requestId: 'wallet-abc123',
            amount: 1000,
            accountId: 'account-1',
            method: 'nostr-gift-wrap',
            isSwapStep: false,
          },
        })
      }).not.toThrow()

      d()
    })
  })

  it('should throttle balance:changed — running 중 추가 호출 무시', async () => {
    vi.useFakeTimers()

    let resolve: () => void
    const balanceRefresh = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r }),
    )

    const d = connectEventStoreBridge(eventBus, {
      handleBalance: true,
      balanceRefresh,
    })

    // 3회 연속 emit
    eventBus.emit({ type: 'balance:changed', payload: { moduleId: 'cashu', accountId: '' } })
    eventBus.emit({ type: 'balance:changed', payload: { moduleId: 'cashu', accountId: '' } })
    eventBus.emit({ type: 'balance:changed', payload: { moduleId: 'cashu', accountId: '' } })

    // 첫 호출만 실행
    expect(balanceRefresh).toHaveBeenCalledTimes(1)

    // 완료 후 trailing
    resolve!()
    await new Promise<void>((r) => queueMicrotask(r))
    vi.advanceTimersByTime(150)

    expect(balanceRefresh).toHaveBeenCalledTimes(2)

    d()
    vi.useRealTimers()
  })
})
