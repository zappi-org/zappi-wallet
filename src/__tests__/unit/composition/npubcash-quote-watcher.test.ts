import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNpubcashQuoteWatcher } from '@/composition/npubcash-quote-watcher'
import { lightningReceiptCursorKey } from '@/core/domain/lightning-receipt-cursor'
import { Ok, Err } from '@/core/domain/result'
import { NpubcashAuthError, NpubcashApiError } from '@/core/errors/npubcash'
import type {
  AuthSession,
  AccountInfo,
  PaidQuote,
} from '@/core/ports/driven/payment-alias-provider.port'
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

  const watcher = createNpubcashQuoteWatcher({
    provider,
    mint,
    createSigner,
    getPrivkey,
    getPubkey: () => PUBKEY,
    eventBus,
    processedQuotesRepo,
    cursorStore,
  })

  return { provider, mint, createSigner, eventBus, processedQuotesRepo, cursorStore, watcher }
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
            txId: 'tx-lightning-address-q1',
            direction: 'incoming',
            amount: 100,
          }),
        },
      })
    })

    it('does not emit quotes already processed in a previous session (repo check)', async () => {
      const h = createHarness()
      h.provider.getPaidQuotes.mockResolvedValue(Ok([quote({ quoteId: 'q1', paidAt: 1_000 })]))
      await h.processedQuotesRepo.markProcessed('q1')

      await h.watcher.syncNow()

      expect(h.eventBus.emit).not.toHaveBeenCalled()
      expect(h.mint.mintAndReceive).toHaveBeenCalledTimes(1)
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

    it('gives up after 5 attempts and does not emit', async () => {
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
    })
  })

  describe('start/stop', () => {
    it('skips start when there is no privkey', async () => {
      const h = createHarness({ getPrivkey: () => null })

      await h.watcher.start()

      expect(h.provider.authenticate).not.toHaveBeenCalled()
      expect(h.provider.subscribePaidQuotes).not.toHaveBeenCalled()
    })

    it('skips start when auth fails', async () => {
      const h = createHarness()
      h.provider.authenticate.mockResolvedValue(Err(new NpubcashAuthError()))

      await h.watcher.start()

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

    it('schedules a reconnect when the WS subscription fails', async () => {
      vi.useFakeTimers()
      const h = createHarness()
      h.provider.subscribePaidQuotes.mockResolvedValue(Err(new NpubcashApiError(500, 'ws down')))

      const done = h.watcher.start()
      await done
      expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(1)

      // Failure path retries on the fixed base delay (2s), no backoff.
      await vi.advanceTimersByTimeAsync(2_000)
      expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(2_000)
      expect(h.provider.subscribePaidQuotes).toHaveBeenCalledTimes(3)
    })
  })

  describe('wsOnMessage — quote pushed over the subscription', () => {
    it('mints the pushed quote, settles it, and advances the cursor', async () => {
      const h = createHarness()
      h.provider.subscribePaidQuotes.mockResolvedValue(Ok(vi.fn()))

      await h.watcher.start()
      const onQuoteId = h.provider.subscribePaidQuotes.mock.calls[0][1] as (quoteId: string) => void

      h.provider.getPaidQuotes.mockResolvedValue(
        Ok([quote({ quoteId: 'q1', paidAt: 1_000 })]),
      )

      await onQuoteId('q1')

      expect(h.mint.mintAndReceive).toHaveBeenCalledWith('q1', MINT_URL, 100)
      expect(h.eventBus.emit).toHaveBeenCalledTimes(1)
      expect(h.cursorStore.upsert).toHaveBeenCalledWith(CURSOR_KEY, 1_000)
    })
  })
})