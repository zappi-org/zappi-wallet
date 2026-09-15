import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNpubcashQuoteWatcher } from '@/composition/npubcash-quote-watcher'
import { lightningReceiptCursorKey } from '@/core/domain/lightning-receipt-cursor'
import { Ok, Err, type Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'
import { NpubcashApiError } from '@/core/errors/npubcash'
import type {
  AuthSession,
  AccountInfo,
  PaidQuote,
} from '@/core/ports/driven/payment-alias-provider.port'
import type { PaymentAliasPendingQuote } from '@/core/ports/driven/payment-alias-pending-quotes.repository.port'
import type { NostrSigner } from '@/core/ports/driven/nostr-signer.port'

const PRIVKEY = 'privkey-hex'
const PUBKEY = 'pubkey-hex'
const CURSOR_KEY = lightningReceiptCursorKey(PUBKEY)
const MINT_URL = 'https://mint.example'
const SESSION: AuthSession = { token: 'tok', expiresAt: 0 }
const ACCOUNT: AccountInfo = { alias: 'alice', domain: 'npub.cash', mintUrl: MINT_URL, lockQuote: false }
const OVERLAP = 5 * 60 * 1000

function quote(overrides: Partial<PaidQuote>): PaidQuote {
  return {
    quoteId: 'q1',
    amount: 100,
    mintUrl: MINT_URL,
    unit: 'sat',
    paidAt: 0,
    expiry: 0,
    ...overrides,
  }
}

const signer: NostrSigner = {
  createNip98Token: vi.fn(() => 'nip98'),
  getPublicKey: vi.fn(() => PUBKEY),
  getNpub: vi.fn(() => 'npub1test'),
}

function createHarness(overrides: { getPrivkey?: () => string | null } = {}) {
  const { getPrivkey = () => PRIVKEY } = overrides

  const provider = {
    authenticate: vi.fn().mockResolvedValue(Ok(SESSION)),
    getAccountInfo: vi.fn().mockResolvedValue(Ok(ACCOUNT)),
    getPaidQuotes: vi.fn().mockResolvedValue(Ok([])),
    subscribePaidQuotes: vi.fn().mockResolvedValue(Ok(() => {})),
    purchaseAlias: vi.fn(),
    setPreferredMint: vi.fn(),
    toggleLock: vi.fn(),
  }
  const mint = { mintAndReceive: vi.fn().mockResolvedValue(undefined) }
  const createSigner = vi.fn(() => signer)
  const eventBus = { emit: vi.fn(), on: vi.fn(() => () => {}), off: vi.fn() }

  // In-memory doubles so cross-call behavior (mark → isProcessed) is real,
  // not mock-sequence bookkeeping.
  const processedQuotesRepo = (() => {
    const processed = new Set<string>()
    return {
      isProcessed: vi.fn(async (id: string) => Ok(processed.has(id))),
      markProcessed: vi.fn(async (id: string) => {
        processed.add(id)
        return Ok(undefined)
      }),
      list: vi.fn(async () => Ok([])),
    }
  })()
  const cursorStore = (() => {
    const store = new Map<string, { key: string; lastSyncAtMs: number }>()
    return {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      upsert: vi.fn(async (key: string, lastSyncAtMs: number) => {
        store.set(key, { key, lastSyncAtMs })
      }),
    }
  })()
  const pendingQuotesRepo = (() => {
    const rows = new Map<string, PaymentAliasPendingQuote>()
    return {
      get: vi.fn(async (id: string) => Ok(rows.get(id) ?? null)),
      save: vi.fn(async (q: PaymentAliasPendingQuote) => {
        rows.set(q.quoteId, q)
        return Ok(undefined)
      }),
      getRetryable: vi.fn(async () =>
        Ok([...rows.values()].filter((r) => r.state === 'retry')),
      ),
      update: vi.fn(async (id: string, patch: Partial<PaymentAliasPendingQuote>) => {
        const row = rows.get(id)
        if (row) rows.set(id, { ...row, ...patch })
        return Ok(undefined)
      }),
      delete: vi.fn(async (id: string) => {
        rows.delete(id)
        return Ok(undefined)
      }),
    }
  })()

  const watcher = createNpubcashQuoteWatcher({
    provider,
    mint,
    createSigner,
    getPrivkey,
    getPubkey: () => PUBKEY,
    eventBus,
    processedQuotesRepo,
    pendingQuotesRepo,
    cursorStore,
  })

  return { provider, mint, createSigner, eventBus, processedQuotesRepo, pendingQuotesRepo, cursorStore, watcher }
}

describe('NpubcashQuoteWatcher', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('syncNow — cursor-based incremental sync', () => {
    it('fetches all quotes with undefined since when no cursor exists, then saves the max paidAt', async () => {
      const h = createHarness()
      h.provider.getPaidQuotes.mockResolvedValue(
        Ok([
          quote({ quoteId: 'q1', paidAt: 1_000 }),
          quote({ quoteId: 'q2', amount: 200, paidAt: 2_000 }),
        ]),
      )

      await h.watcher.syncNow()

      expect(h.provider.getPaidQuotes).toHaveBeenCalledWith(SESSION, undefined)
      expect(h.mint.mintAndReceive).toHaveBeenCalledTimes(2)
      expect(h.mint.mintAndReceive).toHaveBeenCalledWith('q1', MINT_URL, 100)
      expect(h.mint.mintAndReceive).toHaveBeenCalledWith('q2', MINT_URL, 200)
      expect(h.cursorStore.upsert).toHaveBeenCalledWith(CURSOR_KEY, 2_000)
      expect(h.eventBus.emit).toHaveBeenCalledTimes(2)
    })

    it('uses since = lastSyncAt - overlap and does not advance the cursor when nothing is newer', async () => {
      const h = createHarness()
      h.cursorStore.get.mockResolvedValue({ key: CURSOR_KEY, lastSyncAtMs: 600_000 })
      h.provider.getPaidQuotes.mockResolvedValue(
        Ok([quote({ quoteId: 'old', paidAt: 100_000 })]),
      )

      await h.watcher.syncNow()

      expect(h.provider.getPaidQuotes).toHaveBeenCalledWith(SESSION, 600_000 - OVERLAP)
      // The overlapping old quote is still minted, but the cursor is not advanced.
      expect(h.mint.mintAndReceive).toHaveBeenCalledTimes(1)
      expect(h.cursorStore.upsert).not.toHaveBeenCalled()
    })
  })

  describe('settlement dedup', () => {
    it('emits transfer:settled and marks processed exactly once per quote across syncs', async () => {
      const h = createHarness()
      h.provider.getPaidQuotes.mockResolvedValue(Ok([quote({ quoteId: 'q1', paidAt: 1_000 })]))

      await h.watcher.syncNow()
      await h.watcher.syncNow()

      expect(h.eventBus.emit).toHaveBeenCalledTimes(1)
      expect(h.processedQuotesRepo.markProcessed).toHaveBeenCalledTimes(1)
      expect(h.eventBus.emit).toHaveBeenCalledWith({
        type: 'transfer:settled',
        payload: {
          transfer: expect.objectContaining({
            id: 'lightning-address-q1',
            txId: 'tx-q1',
            direction: 'incoming',
            amount: 100,
          }),
        },
      })
    })

    it('does not emit or re-mint quotes already processed in a previous session (repo check)', async () => {
      const h = createHarness()
      h.provider.getPaidQuotes.mockResolvedValue(Ok([quote({ quoteId: 'q1', paidAt: 1_000 })]))
      await h.processedQuotesRepo.markProcessed('q1')

      await h.watcher.syncNow()

      expect(h.eventBus.emit).not.toHaveBeenCalled()
      expect(h.mint.mintAndReceive).not.toHaveBeenCalled()
    })
  })

  describe('handleQuote — mint retry', () => {
    it('settles immediately when the mint says the quote is already tracked/finalized', async () => {
      const h = createHarness()
      h.provider.getPaidQuotes.mockResolvedValue(Ok([quote({ quoteId: 'q1', paidAt: 1_000 })]))
      h.mint.mintAndReceive.mockRejectedValue(new Error('quote already tracked — finalized'))

      await h.watcher.syncNow()

      expect(h.mint.mintAndReceive).toHaveBeenCalledTimes(1)
      expect(h.eventBus.emit).toHaveBeenCalledTimes(1)
    })

    it('retries with backoff and settles once the mint succeeds', async () => {
      vi.useFakeTimers()
      const h = createHarness()
      h.provider.getPaidQuotes.mockResolvedValue(Ok([quote({ quoteId: 'q1', paidAt: 1_000 })]))
      h.mint.mintAndReceive
        .mockRejectedValueOnce(new Error('mint down'))
        .mockResolvedValueOnce(undefined)

      const done = h.watcher.syncNow()
      await vi.runAllTimersAsync()
      await done

      expect(h.mint.mintAndReceive).toHaveBeenCalledTimes(2)
      expect(h.eventBus.emit).toHaveBeenCalledTimes(1)
    })

    it('gives up after 5 attempts, persists a retry, and does not emit', async () => {
      vi.useFakeTimers()
      const h = createHarness()
      h.provider.getPaidQuotes.mockResolvedValue(Ok([quote({ quoteId: 'q1', paidAt: 1_000 })]))
      h.mint.mintAndReceive.mockRejectedValue(new Error('mint down'))

      const done = h.watcher.syncNow()
      await vi.runAllTimersAsync()
      await done

      expect(h.mint.mintAndReceive).toHaveBeenCalledTimes(5)
      expect(h.eventBus.emit).not.toHaveBeenCalled()
      expect(h.processedQuotesRepo.markProcessed).not.toHaveBeenCalled()
      expect(h.pendingQuotesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ quoteId: 'q1', state: 'retry' }),
      )
    })

    it('treats an already-issued quote as claimed (no pending, cursor advances)', async () => {
      const h = createHarness()
      h.provider.getPaidQuotes.mockResolvedValue(Ok([quote({ quoteId: 'q1', paidAt: 1_000 })]))
      h.mint.mintAndReceive.mockRejectedValue(new Error('quote already issued'))

      await h.watcher.syncNow()

      expect(h.eventBus.emit).toHaveBeenCalledTimes(1)
      expect(h.pendingQuotesRepo.save).not.toHaveBeenCalled()
      expect(h.cursorStore.upsert).toHaveBeenCalledWith(CURSOR_KEY, 1_000)
    })
  })

  describe('cursor gating on unhandled quotes', () => {
    it('persists the failure, still processes later quotes, and advances the cursor past them', async () => {
      vi.useFakeTimers()
      const h = createHarness()
      h.provider.getPaidQuotes.mockResolvedValue(
        Ok([
          quote({ quoteId: 'q1', paidAt: 1_000 }),
          quote({ quoteId: 'q2', amount: 200, paidAt: 2_000 }),
        ]),
      )
      // q1 실패는 pending에 영속화되고, q2는 같은 패스에서 계속 처리된다.
      h.mint.mintAndReceive.mockImplementation(async (quoteId: string) => {
        if (quoteId === 'q1') throw new Error('mint down')
      })

      const done = h.watcher.syncNow()
      await vi.runAllTimersAsync()
      await done

      // q1은 pending에 남고, q2도 처리되며, 커서는 q2.paidAt까지 전진한다.
      expect(h.pendingQuotesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ quoteId: 'q1', state: 'retry' }),
      )
      expect(h.mint.mintAndReceive).toHaveBeenCalledWith('q2', MINT_URL, 200)
      expect(h.cursorStore.upsert).toHaveBeenCalledWith(CURSOR_KEY, 2_000)
    })

    it('영속화 실패 시에는 커서를 넘기지 않는다', async () => {
      vi.useFakeTimers()
      const h = createHarness()
      h.provider.getPaidQuotes.mockResolvedValue(
        Ok([
          quote({ quoteId: 'q1', paidAt: 1_000 }),
          quote({ quoteId: 'q2', amount: 200, paidAt: 2_000 }),
        ]),
      )
      h.mint.mintAndReceive.mockImplementation(async (quoteId: string) => {
        if (quoteId === 'q1') throw new Error('mint down')
      })
      // 실패를 영속화하지 못했으므로 커서를 넘기면 q1이 유실된다 — 전진 금지.
      h.pendingQuotesRepo.save.mockResolvedValue(
        Err(new NpubcashApiError(500, 'db down')) as never,
      )

      const done = h.watcher.syncNow()
      await vi.runAllTimersAsync()
      await done

      expect(h.cursorStore.upsert).not.toHaveBeenCalled()
    })

    it('drains a persisted failure once the mint recovers', async () => {
      const h = createHarness()
      h.provider.getPaidQuotes.mockResolvedValue(Ok([]))
      await h.pendingQuotesRepo.save({
        quoteId: 'q1',
        mintUrl: MINT_URL,
        amount: 100,
        unit: 'sat',
        paidAt: 1_000,
        expiry: 0,
        attemptCount: 1,
        lastAttemptAt: Date.now() - 60_000,
        state: 'retry',
      })

      await h.watcher.syncNow()

      expect(h.mint.mintAndReceive).toHaveBeenCalledWith('q1', MINT_URL, 100)
      expect(h.eventBus.emit).toHaveBeenCalledTimes(1)
      expect(h.pendingQuotesRepo.delete).toHaveBeenCalledWith('q1')
    })
  })

  describe('start/stop', () => {
    it('skips start when there is no privkey', async () => {
      const h = createHarness({ getPrivkey: () => null })

      await h.watcher.start()

      expect(h.provider.authenticate).not.toHaveBeenCalled()
      expect(h.provider.subscribePaidQuotes).not.toHaveBeenCalled()
    })

    it('starts the WS subscription and stop() calls the returned unsubscribe', async () => {
      const h = createHarness()
      const unsubscribe = vi.fn()
      h.provider.subscribePaidQuotes.mockResolvedValue(Ok(unsubscribe))

      await h.watcher.start()
      expect(h.provider.subscribePaidQuotes).toHaveBeenCalled()

      h.watcher.stop()
      expect(unsubscribe).toHaveBeenCalled()

      // A second stop is a no-op — the unsubscribe is already cleared.
      h.watcher.stop()
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('backs off when the WS subscription keeps failing', async () => {
      vi.useFakeTimers()
      const h = createHarness()
      h.provider.subscribePaidQuotes.mockResolvedValue(Err(new NpubcashApiError(500, 'ws down')))

      const done = h.watcher.start()
      await done
      expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(1)

      // Exponential from 2s: 2s → 4s → 8s → 16s → capped at 30s.
      await vi.advanceTimersByTimeAsync(2_000)
      expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(4_000)
      expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(3)

      await vi.advanceTimersByTimeAsync(8_000)
      expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(4)

      await vi.advanceTimersByTimeAsync(16_000)
      expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(5)

      await vi.advanceTimersByTimeAsync(30_000)
      expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(6)

      await vi.advanceTimersByTimeAsync(30_000)
      expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(7)
    })

    it('stop() cancels a scheduled reconnect (no resubscribe after disconnect→stop)', async () => {
      vi.useFakeTimers()
      const h = createHarness()
      h.provider.subscribePaidQuotes.mockResolvedValue(Err(new NpubcashApiError(500, 'ws down')))

      await h.watcher.start()
      expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(1)

      h.watcher.stop()
      await vi.advanceTimersByTimeAsync(60_000)

      expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(1)
    })

    it('closes a subscription established after stop()', async () => {
      const h = createHarness()
      let resolveSub!: (result: Result<() => void, BaseError>) => void
      h.provider.subscribePaidQuotes.mockReturnValue(
        new Promise((resolve) => { resolveSub = resolve }),
      )

      const startP = h.watcher.start()
      await vi.waitFor(() =>
        expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(1),
      )

      h.watcher.stop()
      const unsubscribe = vi.fn()
      resolveSub(Ok(unsubscribe))
      await startP

      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('a start() landing mid-subscribe still ends with a live subscription', async () => {
      const h = createHarness()
      let resolveFirst!: (result: Result<() => void, BaseError>) => void
      const liveSub = vi.fn()
      h.provider.subscribePaidQuotes
        .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
        .mockResolvedValueOnce(Ok(liveSub))

      const start1 = h.watcher.start()
      await vi.waitFor(() => expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(1))

      // pause → resume while the first subscribe is still pending
      h.watcher.stop()
      const start2 = h.watcher.start()

      const staleSub = vi.fn()
      resolveFirst(Ok(staleSub))
      await start1
      await start2

      // superseded socket discarded, fresh one established
      expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(2)
      expect(staleSub).toHaveBeenCalledTimes(1)

      h.watcher.stop()
      expect(liveSub).toHaveBeenCalledTimes(1)
    })

    it('retries a failed HTTP sync on its own backoff while the WS stays up', async () => {
      vi.useFakeTimers()
      const h = createHarness()
      h.provider.subscribePaidQuotes.mockResolvedValue(Ok(vi.fn()))
      h.provider.authenticate
        .mockResolvedValueOnce(Err(new NpubcashApiError(500, 'auth down')))
        .mockResolvedValueOnce(Err(new NpubcashApiError(500, 'auth down')))
        .mockResolvedValue(Ok(SESSION))
      h.provider.getPaidQuotes.mockResolvedValue(Ok([]))

      await h.watcher.start()

      // First catch-up failed → retries at 2s without touching the WS.
      await vi.advanceTimersByTimeAsync(2_000)
      expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(1)
      expect(h.provider.authenticate).toHaveBeenCalledTimes(2)

      // Second failure backs off double (4s): no attempt at 3s, one at 6s.
      await vi.advanceTimersByTimeAsync(1_000)
      expect(h.provider.authenticate).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(3_000)
      expect(h.provider.authenticate).toHaveBeenCalledTimes(3)

      // Success resets the retry cycle — no further attempts.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(h.provider.authenticate).toHaveBeenCalledTimes(3)
    })
  })

  describe('wsOnMessage — quote pushed over the subscription', () => {
    it('mints the pushed quote, settles it, and advances the cursor', async () => {
      const h = createHarness()
      h.provider.subscribePaidQuotes.mockResolvedValue(Ok(vi.fn()))

      await h.watcher.start()
      const onQuoteId = h.provider.subscribePaidQuotes.mock.calls[0][1] as (quoteId: string) => Promise<void>

      h.provider.getPaidQuotes.mockResolvedValue(
        Ok([quote({ quoteId: 'q1', paidAt: 1_000 })]),
      )

      await onQuoteId('q1')

      await vi.waitFor(() => {
        expect(h.eventBus.emit).toHaveBeenCalledTimes(1)
      })
      expect(h.mint.mintAndReceive).toHaveBeenCalledWith('q1', MINT_URL, 100)
      expect(h.cursorStore.upsert).toHaveBeenCalledWith(CURSOR_KEY, 1_000)
    })
  })
})