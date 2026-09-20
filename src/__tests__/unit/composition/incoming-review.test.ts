import { describe, expect, it, vi } from 'vitest'
import { resolveIncomingReview } from '@/composition/incoming-review'
import type { PendingIncomingReview } from '@/core/types'
import { amount } from '@/core/domain/amount'

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
      amount: amount(100, 'sat'),
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

describe('approved receipt binding', () => {
  it.each([100n, 98n])('links the authenticated delivery after approved redemption (%s sat)', async (value) => {
    const review = createReview({ recipientPubkey: 'receiver' });
    const tx = { id: 'local-receive', direction: 'receive', status: 'settled',
      amount: amount(value, 'sat'), accountId: review.token.mintUrl,
      fee: { effective: amount(2, 'sat'), quoted: amount(2, 'sat') },
      metadata: { token: review.token.token },
    };
    const update = vi.fn();
    const save = vi.fn();
    await resolveIncomingReview({
      transactionMgmt: { getById: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(tx), update },
      processedStore: { save },
      receiveRequest: { findByRequestId: vi.fn().mockResolvedValue(null), complete: vi.fn() },
      removeIncomingReview: vi.fn(),
    }, { review, transactionId: tx.id });
    expect(update).toHaveBeenCalledWith(tx.id, { metadata: {
      token: review.token.token,
      paymentDelivery: { id: review.externalId, sender: review.senderPubkey, recipient: review.recipientPubkey, amount: 100, requestId: review.requestId },
    } });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ externalId: review.externalId, txId: tx.id, result: 'success' }));
  });
  it.each([{ direction: 'send' }, { status: 'pending' }, { metadata: { token: 'other-token' } }, { accountId: 'https://other.mint' }])('keeps the review when the receipt mismatches %#', async (patch) => {
    const review = createReview({ recipientPubkey: 'receiver' });
    const remove = vi.fn();
    const update = vi.fn();
    await expect(resolveIncomingReview({
      transactionMgmt: { getById: vi.fn().mockResolvedValue({
        id: 'local', direction: 'receive', status: 'settled', amount: amount(100, 'sat'),
        accountId: review.token.mintUrl, metadata: { token: review.token.token }, ...patch,
      }), update },
      processedStore: { save: vi.fn() },
      receiveRequest: { findByRequestId: vi.fn(), complete: vi.fn() },
      removeIncomingReview: remove,
    }, { review, transactionId: 'local' })).rejects.toThrow('does not match');
    expect(remove).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
