import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GiftWrapWatcher, type GiftWrapWatcherDeps } from '@/composition/gift-wrap.watcher'

function encodeBase64Url(value: string): string {
  return btoa(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function makeCashuToken(mintUrl = 'https://mint.test', amount = 100): string {
  const payload = {
    token: [
      {
        mint: mintUrl,
        proofs: [
          { amount, secret: 'secret-1', C: 'C-1', id: 'keyset-1' },
        ],
      },
    ],
  }

  return `cashuA${encodeBase64Url(JSON.stringify(payload))}`
}

describe('GiftWrapWatcher', () => {
  let deps: GiftWrapWatcherDeps

  beforeEach(() => {
    deps = {
      nostrGateway: {
        connect: vi.fn().mockResolvedValue(undefined),
        subscribeGiftWraps: vi.fn().mockReturnValue(vi.fn()),
        getRelayStatus: vi.fn().mockReturnValue([]),
        sendPrivateDirectMessage: vi.fn().mockResolvedValue(undefined),
      } as unknown as GiftWrapWatcherDeps['nostrGateway'],
      incomingPayment: {
        processIncoming: vi.fn().mockResolvedValue({ status: 'success', amount: 100, fee: 1 }),
      },
      eventBus: {
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
      recipientPubkey: 'recipient-pubkey',
      getRelays: () => [],
      getPosDevices: () => undefined,
      getPendingRequestId: () => null,
      trustedMintProvider: {
        hasTrustedMint: vi.fn().mockResolvedValue(true),
      },
      incomingReviewQueue: {
        enqueue: vi.fn().mockResolvedValue(undefined),
      },
      tokenCodec: {
        inspectCashuToken: vi.fn((token: string) => {
          // Decode base64 to extract mint and amount
          try {
            const base64 = token.slice(6) // remove 'cashuA' prefix
            const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'))
            const parsed = JSON.parse(json)
            const mint = parsed.token?.[0]?.mint || 'https://mint.test'
            const amount = parsed.token?.[0]?.proofs?.[0]?.amount || 100
            return {
              mint,
              amount: { value: BigInt(amount), unit: 'sat' as const },
              memo: undefined,
            }
          } catch {
            return {
              mint: 'https://mint.test',
              amount: { value: 100n, unit: 'sat' as const },
              memo: undefined,
            }
          }
        }),
      } as unknown as GiftWrapWatcherDeps['tokenCodec'],
    }
  })

  it('queues untrusted incoming tokens instead of auto-redeeming them', async () => {
    const token = makeCashuToken('https://unknown.mint', 123)
    vi.mocked(deps.trustedMintProvider.hasTrustedMint).mockResolvedValue(false)

    const watcher = new GiftWrapWatcher(deps)
    await (watcher as unknown as {
      handleMessage: (msg: { eventId: string; content: string; sender: string }) => Promise<void>
    }).handleMessage({
      eventId: 'ev-1',
      content: token,
      sender: 'sender-pubkey',
    })

    expect(deps.incomingReviewQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'ev-1',
        source: 'gift-wrap',
        senderPubkey: 'sender-pubkey',
        token: expect.objectContaining({
          token,
          mintUrl: 'https://unknown.mint',
          amount: { value: 123n, unit: 'sat' },
        }),
      }),
    )
    expect(deps.incomingPayment.processIncoming).not.toHaveBeenCalled()
    expect(deps.eventBus.emit).not.toHaveBeenCalled()
  })

  it('continues to settle trusted NUT-18 gift-wrap payments', async () => {
    const token = makeCashuToken('https://mint.test', 77)
    const watcher = new GiftWrapWatcher(deps)
    await (watcher as unknown as {
      handleMessage: (msg: { eventId: string; content: string; sender: string }) => Promise<void>
    }).handleMessage({
      eventId: 'ev-2',
      sender: 'sender-pubkey',
      content: JSON.stringify({
        type: 'cashu_token',
        token,
        request_id: 'request-1',
        sent_at: Date.now(),
      }),
    })

    expect(deps.incomingPayment.processIncoming).toHaveBeenCalledWith({
      payload: token,
      externalId: 'ev-2',
      memo: undefined,
      metadata: { sender: 'sender-pubkey' },
      receiveRequestPaymentRef: 'request-1',
      receiveRequestMethod: 'ecash',
    })
    expect(deps.eventBus.emit).toHaveBeenCalledWith({
      type: 'receive:settled',
      payload: {
        requestId: 'request-1',
        amount: 100,
        fee: 1,
        accountId: 'cashu:ecash',
        method: 'nostr-gift-wrap',
        isSwapStep: false,
        wasRequestFulfilled: false,
        metadata: undefined,
      },
    })
  })
})
