import { describe, expect, it, vi } from 'vitest'
import { resolveIncomingReview } from '@/composition/incoming-review'
import type { PendingIncomingReview } from '@/core/types'

function createReview(overrides: Partial<PendingIncomingReview> = {}): PendingIncomingReview {
  return {
    externalId: 'event-1',
    queuedAt: Date.now(),
    requestId: 'creq-1',
    senderPubkey: 'sender-pubkey',
    txId: 'tx-1',
    source: 'gift-wrap',
    token: {
      type: 'cashu-token',
      token: 'cashuA...',
      amountSats: 100,
      mintUrl: 'https://mint.test',
    },
    ...overrides,
  }
}

describe('resolveIncomingReview', () => {
  it('completes the linked request before marking processed and removing the queue entry', async () => {
    const receiveRequest = {
      findByRequestId: vi.fn().mockResolvedValue({ id: 'receive-1', fulfillmentStatus: 'pending' }),
      complete: vi.fn().mockResolvedValue(undefined),
    }
    const processedStore = {
      save: vi.fn().mockResolvedValue(undefined),
    }
    const removeIncomingReview = vi.fn()
    const sendPrivateDirectMessage = vi.fn().mockResolvedValue(undefined)

    await resolveIncomingReview({
      receiveRequest,
      processedStore,
      removeIncomingReview,
      nostrGateway: {
        getRelayStatus: () => [{ url: 'wss://relay.test', connected: true }],
        sendPrivateDirectMessage,
      },
      posDevices: [{
        index: 0,
        label: 'POS',
        p2pkPublicKey: 'p2pk',
        nostrPublicKey: 'sender-pubkey',
        createdAt: Date.now(),
      }],
    }, {
      review: createReview(),
      transactionId: 'tx-settled',
    })

    expect(receiveRequest.complete).toHaveBeenCalledWith('receive-1', 'ecash')
    expect(processedStore.save).toHaveBeenCalledWith(expect.objectContaining({
      externalId: 'event-1',
      txId: 'tx-settled',
      result: 'success',
    }))
    expect(removeIncomingReview).toHaveBeenCalledWith('event-1')
    expect(sendPrivateDirectMessage).toHaveBeenCalledWith({
      recipientPubkey: 'sender-pubkey',
      content: JSON.stringify({ type: 'delivery_ack', txId: 'tx-1' }),
      relays: ['wss://relay.test'],
    })

    expect(receiveRequest.complete.mock.invocationCallOrder[0]).toBeLessThan(
      processedStore.save.mock.invocationCallOrder[0],
    )
    expect(processedStore.save.mock.invocationCallOrder[0]).toBeLessThan(
      removeIncomingReview.mock.invocationCallOrder[0],
    )
  })

  it('does not mark processed or remove the queue entry when linked request completion fails', async () => {
    const receiveRequest = {
      findByRequestId: vi.fn().mockResolvedValue({ id: 'receive-1', fulfillmentStatus: 'pending' }),
      complete: vi.fn().mockRejectedValue(new Error('write failed')),
    }
    const processedStore = {
      save: vi.fn().mockResolvedValue(undefined),
    }
    const removeIncomingReview = vi.fn()

    await expect(resolveIncomingReview({
      receiveRequest,
      processedStore,
      removeIncomingReview,
    }, {
      review: createReview(),
    })).rejects.toThrow('write failed')

    expect(processedStore.save).not.toHaveBeenCalled()
    expect(removeIncomingReview).not.toHaveBeenCalled()
  })

  it('records additional ecash settlement even when the linked request was already fulfilled', async () => {
    const receiveRequest = {
      findByRequestId: vi.fn().mockResolvedValue({ id: 'receive-1', fulfillmentStatus: 'fulfilled' }),
      complete: vi.fn().mockResolvedValue(undefined),
    }
    const processedStore = {
      save: vi.fn().mockResolvedValue(undefined),
    }
    const removeIncomingReview = vi.fn()

    await resolveIncomingReview({
      receiveRequest,
      processedStore,
      removeIncomingReview,
    }, {
      review: createReview(),
    })

    expect(receiveRequest.complete).toHaveBeenCalledWith('receive-1', 'ecash')
    expect(processedStore.save).toHaveBeenCalled()
    expect(removeIncomingReview).toHaveBeenCalledWith('event-1')
  })

  it('treats ACK delivery as best-effort after the review is already resolved', async () => {
    const receiveRequest = {
      findByRequestId: vi.fn().mockResolvedValue(null),
      complete: vi.fn(),
    }
    const processedStore = {
      save: vi.fn().mockResolvedValue(undefined),
    }
    const removeIncomingReview = vi.fn()
    const sendPrivateDirectMessage = vi.fn().mockRejectedValue(new Error('relay down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(resolveIncomingReview({
      receiveRequest,
      processedStore,
      removeIncomingReview,
      nostrGateway: {
        getRelayStatus: () => [{ url: 'wss://relay.test', connected: true }],
        sendPrivateDirectMessage,
      },
      posDevices: [{
        index: 0,
        label: 'POS',
        p2pkPublicKey: 'p2pk',
        nostrPublicKey: 'sender-pubkey',
        createdAt: Date.now(),
      }],
    }, {
      review: createReview(),
    })).resolves.toBeUndefined()

    expect(processedStore.save).toHaveBeenCalled()
    expect(removeIncomingReview).toHaveBeenCalledWith('event-1')
    warnSpy.mockRestore()
  })
})
