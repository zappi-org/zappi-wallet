import type { PaymentAliasProvider } from '@/core/ports/driven/payment-alias-provider.port'
import type { RoutePaymentOperator } from '@/core/ports/driven/route-payment-operator.port'
import type { NostrSigner } from '@/core/ports/driven/nostr-signer.port'
import type { EventBus } from '@/core/events/event-bus'
import type { PaidQuote } from '@/core/ports/driven/payment-alias-provider.port'
import type { PaymentAliasProcessedQuotesRepository } from '@/core/ports/driven/payment-alias-processed-quotes.repository.port'
import type { PaymentAliasPendingQuotesRepository } from '@/core/ports/driven/payment-alias-pending-quotes.repository.port'
import { isAlreadyRedeemedQuote } from '@/core/services/route-execution.service'
import { RETRY } from '@/core/constants'
import {
  lightningReceiptCursorKey,
  lightningReceiptSince,
} from '@/core/domain/lightning-receipt-cursor'

export type SignerFactory = (privkey: string) => NostrSigner

/** Per-quote result. `retry` is persisted for a later drain; `dead` (expired) and `claimed` are terminal. */
type QuoteHandling =
  | { outcome: 'claimed' }
  | { outcome: 'retry' | 'dead'; error: string }

const isExpired = (q: PaidQuote): boolean => q.expiry > 0 && Date.now() > toMs(q.expiry)

// ponytail: server unit is unverified for expiry; paidAt is ms, so accept both.
// Below 1e12 it can only be seconds (that's year 2001 in ms).
const toMs = (t: number): number => (t > 0 && t < 1e12 ? t * 1000 : t)

/** Coco reports an already-issued mint quote as "already tracked ... finalized". */
const isAlreadyTrackedFinalized = (err: unknown): boolean => {
  const msg = String(err)
  return msg.includes('already tracked') && msg.includes('finalized')
}

const isAlreadySettled = (err: unknown): boolean =>
  isAlreadyRedeemedQuote(err) || isAlreadyTrackedFinalized(err)

export function createNpubcashQuoteWatcher(deps: {
  provider: PaymentAliasProvider
  mint: Pick<RoutePaymentOperator, 'mintAndReceive'>
  createSigner: SignerFactory
  getPrivkey: () => string | null
  getPubkey: () => string | null
  eventBus: EventBus
  processedQuotesRepo: PaymentAliasProcessedQuotesRepository
  pendingQuotesRepo: PaymentAliasPendingQuotesRepository
  cursorStore: {
    get(key: string): Promise<{ key: string; lastSyncAtMs: number } | null>
    upsert(key: string, lastSyncAtMs: number): Promise<void>
  }
}) {
  const {
    provider,
    mint,
    createSigner,
    getPrivkey,
    getPubkey,
    eventBus,
    processedQuotesRepo,
    pendingQuotesRepo,
    cursorStore,
  } = deps

  // desired = intent, closeSub = live socket, generation = invalidates in-flight work on start/stop. One reconcile step is the only (re)subscribe path, so a start() mid-subscribe is never dropped.
  let desired = false
  let closeSub: (() => void) | null = null
  let generation = 0
  let reconcileInFlight: Promise<void> | null = null
  let syncing = false
  let syncQueued = false
  let syncAttempts = 0
  let syncTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const maxReconnectDelay = 30_000
  const baseReconnectDelay = 2_000
  const emittedThisSession = new Set<string>()

  const emitSettled = async (q: PaidQuote) => {
    if (emittedThisSession.has(q.quoteId)) return
    const check = await processedQuotesRepo.isProcessed(q.quoteId)
    if (check.ok && check.value) return
    emittedThisSession.add(q.quoteId)
    const now = Date.now()
    eventBus.emit({
      type: 'transfer:settled',
      payload: {
        transfer: {
          id: `lightning-address-${q.quoteId}`,
          // observer(mint-quote-observer) fallback과 같은 id → 같은 Dexie row에 덮어써 중복 방지
          txId: `tx-${q.quoteId}`,
          direction: 'incoming',
          phase: 'settled',
          finality: 'immediate',
          onExpiry: 'expire',
          transportRef: {
            // npubcash 입금은 남이 지불한 mint quote → 내가 민팅. 지갑맥락상
            // 라이트닝 수신이며, 실제 ecash가 사는 민트는 mintUrl.
            type: 'lightning-address',
            protocol: 'bolt11', // 브릿지 Lightning 분기로 연결 ('lightning' fallback 우연에 의존하지 않음)
            mintUrl: q.mintUrl, // accountId = 실제 수신 민트 (unknown 방지), + quote_id는 어차피 bolt11분기에 와이어링 불가. 저장 불필요
            receivedAmount: q.amount,
            fee: 0,
          },
          createdAt: now,
          updatedAt: now,
          amount: q.amount,
        },
      },
    })
    await processedQuotesRepo.markProcessed(q.quoteId)
  }

  /**
   * Mint and settle one quote. Returns an explicit outcome so the caller can
   * decide the cursor and persistence — never swallows a failure as success.
   */
  const handleQuote = async (q: PaidQuote): Promise<QuoteHandling> => {
    // Expired quotes can still be ISSUED (claimed earlier); try once, then retire.
    const maxRetries = isExpired(q) ? 1 : 5
    const baseDelay = 500
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await mint.mintAndReceive(q.quoteId, q.mintUrl, q.amount)
        await emitSettled(q)
        return { outcome: 'claimed' }
      } catch (err) {
        if (isAlreadySettled(err)) {
          await emitSettled(q)
          return { outcome: 'claimed' }
        }
        if (attempt === maxRetries - 1) {
          const error = String(err)
          console.warn(
            `[NpubcashQuoteWatcher] mintAndReceive failed after ${maxRetries} attempts for ${q.quoteId}:`,
            err,
          )
          return { outcome: isExpired(q) ? 'dead' : 'retry', error }
        }
        await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt)))
      }
    }
    return { outcome: 'retry', error: 'unreachable' }
  }

  /** Persist a failure without resetting its attempt count. */
  const savePending = async (
    q: PaidQuote,
    error: string,
  ): Promise<boolean> => {
    const existing = await pendingQuotesRepo.get(q.quoteId)
    const attemptCount = (existing.ok && existing.value ? existing.value.attemptCount : 0) + 1
    const saved = await pendingQuotesRepo
      .save({
        quoteId: q.quoteId,
        mintUrl: q.mintUrl,
        amount: q.amount,
        unit: q.unit,
        paidAt: q.paidAt,
        expiry: q.expiry,
        attemptCount,
        lastAttemptAt: Date.now(),
        lastError: error,
        state: 'retry',
      })
      .catch(() => null)
    return saved != null && saved.ok
  }

  /**
   * Drain persisted failures. Backoff mirrors the cashu recovery sweeps.
   * Returns true while any quote is still owed (failed this round or waiting
   * out its backoff), so the caller can schedule an independent retry.
   */
  const drainPending = async (): Promise<boolean> => {
    const listed = await pendingQuotesRepo.getRetryable()
    if (!listed.ok) return false
    const now = Date.now()
    let remaining = false

    for (const item of listed.value) {
      if (item.attemptCount > 0) {
        const delay = Math.min(
          RETRY.INITIAL_DELAY * Math.pow(RETRY.BACKOFF_MULTIPLIER, item.attemptCount - 1),
          RETRY.MAX_DELAY,
        )
        if (now - item.lastAttemptAt < delay) {
          remaining = true // still owed, just not due yet — keep the retry loop alive
          continue
        }
      }

      const q: PaidQuote = {
        quoteId: item.quoteId,
        mintUrl: item.mintUrl,
        amount: item.amount,
        unit: item.unit,
        paidAt: item.paidAt,
        expiry: item.expiry,
      }
      const result = await handleQuote(q)

      if (result.outcome === 'claimed' || result.outcome === 'dead') {
        await pendingQuotesRepo.delete(item.quoteId).catch(() => {})
      } else {
        remaining = true
        await pendingQuotesRepo
          .update(item.quoteId, {
            lastError: result.error,
            attemptCount: item.attemptCount + 1,
            lastAttemptAt: Date.now(),
          })
          .catch(() => {})
      }
    }
    return remaining
  }

  // Fetch paid quotes since the cursor and claim them oldest-first. False on auth/fetch failure.
  const syncOnce = async (privkey: string): Promise<boolean> => {
    const pubkey = getPubkey()
    const cursorKey = pubkey ? lightningReceiptCursorKey(pubkey) : null

    const signer = createSigner(privkey)
    const session = await provider.authenticate(signer)
    if (!session.ok) return false

    const record = cursorKey ? await cursorStore.get(cursorKey) : null
    const since = lightningReceiptSince(record)
    const prevCursor = record?.lastSyncAtMs ?? 0

    const quotes = await provider.getPaidQuotes(session.value, since)
    if (!quotes.ok) return false

    const ordered = [...quotes.value].sort((a, b) => a.paidAt - b.paidAt)
    let handledThrough = prevCursor

    for (const q of ordered) {
      const check = await processedQuotesRepo.isProcessed(q.quoteId)
      if (check.ok && check.value) {
        if (q.paidAt > handledThrough) handledThrough = q.paidAt
        continue
      }

      const result = await handleQuote(q)

      let holdCursor = false
      switch (result.outcome) {
        case 'retry':
          if (!(await savePending(q, result.error))) holdCursor = true;
          break
        case 'dead':
        case 'claimed':
          await pendingQuotesRepo.delete(q.quoteId).catch(() => { })
          break
      }
      if (holdCursor) break
      if (q.paidAt > handledThrough) handledThrough = q.paidAt
    }

    if (cursorKey && handledThrough > prevCursor) {
      await cursorStore.upsert(cursorKey, handledThrough)
    }
    return true
  }

  /** Serialized sync + drain — one in-flight run at a time; re-runs if one was queued. False if the last sync failed OR pending quotes remain to retry. */
  const runSync = async (privkey: string): Promise<boolean> => {
    if (syncing) {
      syncQueued = true
      return true
    }
    syncing = true
    let ok = true
    try {
      do {
        syncQueued = false
        ok = (await syncOnce(privkey)) && ok
        // drainPending returns true while quotes remain owed (bad) — invert it:
        // pending remaining counts as not-ok so scheduleSyncRetry fires and the
        // pending loop runs on its own backoff, not just on the next WS
        // notification, reconnect, or manual sync.
        ok = !(await drainPending()) && ok
      } while (syncQueued)
    } finally {
      syncing = false
    }
    return ok
  }

  /** Backoff delay for both failure paths (connect failure & drop). A fresh subscribe resets it. */
  const nextReconnectDelay = (): number => {
    const delay = Math.min(
      baseReconnectDelay * Math.pow(2, reconnectAttempts),
      maxReconnectDelay,
    )
    reconnectAttempts++
    return delay
  }

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  /** Schedule a reconcile step only while the intent is still to run. */
  const scheduleReconnect = () => {
    if (!desired) return
    const delay = nextReconnectDelay()
    console.log(
      `[NpubcashQuoteWatcher] scheduling reconnect #${reconnectAttempts} in ${delay}ms`,
    )
    clearReconnectTimer()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void reconcile()
    }, delay)
  }

  const clearSyncTimer = () => {
    if (syncTimer !== null) {
      clearTimeout(syncTimer)
      syncTimer = null
    }
  }

  // HTTP sync retry: WS alone can stay up while auth/quotes fail, so a failed catch-up must retry on its own timer or offline-arrived quotes stay unclaimed.
  const scheduleSyncRetry = () => {
    if (!desired) return
    const delay = Math.min(baseReconnectDelay * Math.pow(2, syncAttempts), maxReconnectDelay)
    syncAttempts++
    console.log(`[NpubcashQuoteWatcher] scheduling sync retry #${syncAttempts} in ${delay}ms`)
    clearSyncTimer()
    syncTimer = setTimeout(() => {
      syncTimer = null
      const privkey = getPrivkey()
      if (privkey && desired) void triggerSync(privkey)
    }, delay)
  }

  const triggerSync = async (privkey: string): Promise<void> => {
    const ok = await runSync(privkey).catch((err) => {
      console.warn('[NpubcashQuoteWatcher] sync failed:', err)
      return false
    })
    if (ok) {
      syncAttempts = 0
      clearSyncTimer()
      return
    }
    scheduleSyncRetry()
  }

  // One reconcile step: never rejects, every await is followed by a generation check so a mid-flight stop/start wins.
  const reconcileOnce = async (): Promise<void> => {
    const gen = generation
    if (!desired) return

    // start() while already subscribed: drop the old socket before replacing it.
    if (closeSub) {
      closeSub()
      closeSub = null
    }

    const privkey = getPrivkey()
    if (!privkey) {
      console.log('[NpubcashQuoteWatcher] reconcile — no privkey, skip')
      return
    }

    const signer = createSigner(privkey)

    // Fire catch-up in parallel with WS connection (WS-first pattern)
    void triggerSync(privkey)

    let result: Awaited<ReturnType<PaymentAliasProvider['subscribePaidQuotes']>>
    try {
      result = await provider.subscribePaidQuotes(
        signer,
        // Notification is only a wake-up signal: re-poll the full window rather
        // than trusting the single quoteId, so un-notified quotes aren't skipped.
        () => void triggerSync(privkey),
        () => {
          // Ignore a drop from a superseded socket.
          if (gen !== generation || !desired) return
          closeSub = null
          scheduleReconnect()
        },
      )
    } catch (err) {
      console.warn('[NpubcashQuoteWatcher] subscribe failed:', err)
      if (gen === generation && desired) scheduleReconnect()
      return
    }

    // Intent changed while subscribing — discard whatever came back.
    if (gen !== generation || !desired) {
      if (result.ok) result.value()
      console.log('[NpubcashQuoteWatcher] discarded superseded subscription')
      return
    }

    if (result.ok) {
      closeSub = result.value
      reconnectAttempts = 0
      console.log('[NpubcashQuoteWatcher] WS subscription established')
    } else {
      console.warn('[NpubcashQuoteWatcher] WS subscription failed:', result.error)
      scheduleReconnect()
    }
  }

  /** Single-flight: concurrent callers (start, retry timer) share one reconcile step. */
  const reconcile = (): Promise<void> => {
    if (reconcileInFlight) return reconcileInFlight
    const p = reconcileOnce().catch((err) => {
      console.warn('[NpubcashQuoteWatcher] reconcile failed:', err)
      if (desired) scheduleReconnect()
    })
    reconcileInFlight = p
    void p.finally(() => {
      if (reconcileInFlight === p) reconcileInFlight = null
    })
    return p
  }

  const start = async (): Promise<void> => {
    desired = true
    generation++
    reconnectAttempts = 0
    syncAttempts = 0
    clearReconnectTimer()
    clearSyncTimer()

    if (!getPrivkey()) {
      console.log('[NpubcashQuoteWatcher] start() skipped — no privkey')
      return
    }

    // Let a superseded in-flight step settle, then reconcile fresh — a start() mid-subscribe must not be dropped.
    if (reconcileInFlight) await reconcileInFlight
    await reconcile()
  }

  const stop = (): void => {
    desired = false
    generation++
    reconnectAttempts = 0
    clearReconnectTimer()
    clearSyncTimer()
    if (closeSub) {
      console.log('[NpubcashQuoteWatcher] stop() — closing subscription')
      closeSub()
      closeSub = null
    } else {
      console.log('[NpubcashQuoteWatcher] stop() — nothing to close')
    }
  }

  const syncNow = async () => {
    const privkey = getPrivkey()
    if (!privkey) {
      console.log('[NpubcashQuoteWatcher] syncNow() skipped — no privkey')
      return
    }
    console.log('[NpubcashQuoteWatcher] syncNow() — manual sync triggered')
    await triggerSync(privkey)
    console.log('[NpubcashQuoteWatcher] syncNow() — done')
  }

  return { start, stop, syncNow }
}
