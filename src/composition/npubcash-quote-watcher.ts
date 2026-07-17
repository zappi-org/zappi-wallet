import type { PaymentAliasProvider } from '@/core/ports/driven/payment-alias-provider.port'
import type { RoutePaymentOperator } from '@/core/ports/driven/route-payment-operator.port'
import type { NostrSigner } from '@/core/ports/driven/nostr-signer.port'
import type { EventBus } from '@/core/events/event-bus'
import type { PaidQuote } from '@/core/ports/driven/payment-alias-provider.port'
import type { PaymentAliasProcessedQuotesRepository } from '@/core/ports/driven/payment-alias-processed-quotes.repository.port'
import {
  lightningReceiptCursorKey,
  lightningReceiptSince,
} from '@/core/domain/lightning-receipt-cursor'

export type SignerFactory = (privkey: string) => NostrSigner

export function createNpubcashQuoteWatcher(deps: {
  provider: PaymentAliasProvider
  mint: Pick<RoutePaymentOperator, 'mintAndReceive'>
  createSigner: SignerFactory
  getPrivkey: () => string | null
  getPubkey: () => string | null
  eventBus: EventBus
  processedQuotesRepo: PaymentAliasProcessedQuotesRepository
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
    cursorStore,
  } = deps

  let unsubscribe: (() => void) | null = null
  let isStarting = false
  let syncing = false
  let reconnectAttempts = 0
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
          txId: `tx-lightning-address-${q.quoteId}`,
          direction: 'incoming',
          phase: 'settled',
          finality: 'immediate',
          onExpiry: 'expire',
          transportRef: { type: 'lightning-address', receivedAmount: q.amount, fee: 0 },
          createdAt: now,
          updatedAt: now,
          amount: q.amount,
        },
      },
    })
    await processedQuotesRepo.markProcessed(q.quoteId)
  }

  const handleQuote = async (q: PaidQuote) => {
    const maxRetries = 5
    const baseDelay = 500
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await mint.mintAndReceive(q.quoteId, q.mintUrl, q.amount)
        await emitSettled(q)
        return
      } catch (err) {
        const msg = String(err)
        if (msg.includes('already tracked') && msg.includes('finalized')) {
          await emitSettled(q)
          return
        }
        if (attempt === maxRetries - 1) {
          console.warn(`[NpubcashQuoteWatcher] mintAndReceive failed after ${maxRetries} attempts for ${q.quoteId}:`, err)
          return
        }
        await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt)))
      }
    }
  }

  const syncMissedQuotes = async (privkey: string) => {
    const pubkey = getPubkey()
    const cursorKey = pubkey ? lightningReceiptCursorKey(pubkey) : null

    const signer = createSigner(privkey)
    const session = await provider.authenticate(signer)
    if (!session.ok) return

    const record = cursorKey ? await cursorStore.get(cursorKey) : null
    const since = lightningReceiptSince(record)

    const quotes = await provider.getPaidQuotes(session.value, since)
    if (!quotes.ok) return

    let maxPaidAt = since ?? 0
    for (const q of quotes.value) {
      await handleQuote(q)
      if (q.paidAt > maxPaidAt) maxPaidAt = q.paidAt
    }

    if (cursorKey && maxPaidAt > (since ?? 0)) {
      await cursorStore.upsert(cursorKey, maxPaidAt)
    }
  }

  const wsOnMessage = async (signer: NostrSigner, quoteId: string) => {
    const pubkey = getPubkey()
    const cursorKey = pubkey ? lightningReceiptCursorKey(pubkey) : null

    const session = await provider.authenticate(signer)
    if (!session.ok) return

    const record = cursorKey ? await cursorStore.get(cursorKey) : null
    const since = lightningReceiptSince(record)

    const quotes = await provider.getPaidQuotes(session.value, since)
    if (!quotes.ok) return

    let maxPaidAt = since ?? 0
    for (const q of quotes.value) {
      if (q.quoteId === quoteId) {
        await handleQuote(q)
      }
      if (q.paidAt > maxPaidAt) maxPaidAt = q.paidAt
    }

    if (cursorKey && maxPaidAt > (since ?? 0)) {
      await cursorStore.upsert(cursorKey, maxPaidAt)
    }
  }

  const runSubscribe = async () => {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }

    const privkey = getPrivkey()
    if (!privkey) {
      console.log('[NpubcashQuoteWatcher] runSubscribe — no privkey, skip')
      return
    }

    const signer = createSigner(privkey)

    // Fire catch-up in parallel with WS connection (WS-first pattern)
    syncMissedQuotes(privkey).catch((err) =>
      console.warn('[NpubcashQuoteWatcher] syncMissedQuotes failed:', err)
    )

    const result = await provider.subscribePaidQuotes(
      signer,
      (quoteId) => wsOnMessage(signer, quoteId),
      () => {
        unsubscribe = null
        const delay = Math.min(
          baseReconnectDelay * Math.pow(2, reconnectAttempts),
          maxReconnectDelay,
        )
        reconnectAttempts++
        console.log(
          `[NpubcashQuoteWatcher] onDisconnect — WS dead, scheduling restart #${reconnectAttempts} in ${delay}ms`,
        )
        setTimeout(() => { internalReconnect() }, delay)
      },
    )

    if (result.ok) {
      unsubscribe = result.value
      console.log('[NpubcashQuoteWatcher] WS subscription established')
    } else {
      console.warn('[NpubcashQuoteWatcher] WS subscription failed:', result.error)
      const delay = Math.min(baseReconnectDelay, maxReconnectDelay)
      setTimeout(() => { internalReconnect() }, delay)
    }
  }

  const internalReconnect = async () => {
    if (isStarting) {
      console.log('[NpubcashQuoteWatcher] internalReconnect skipped — already starting')
      return
    }
    isStarting = true
    try {
      await runSubscribe()
    } finally {
      isStarting = false
    }
  }

  const start = async () => {
    if (isStarting) {
      console.log('[NpubcashQuoteWatcher] start() skipped — already starting')
      return
    }
    isStarting = true
    reconnectAttempts = 0
    try {
      const privkey = getPrivkey()
      if (!privkey) {
        console.log('[NpubcashQuoteWatcher] start() skipped — no privkey')
        return
      }
      const signer = createSigner(privkey)
      const session = await provider.authenticate(signer)
      if (!session.ok) {
        console.log('[NpubcashQuoteWatcher] start() skipped — auth failed')
        return
      }
      const info = await provider.getAccountInfo(session.value)
      if (!info.ok) {
        console.log('[NpubcashQuoteWatcher] start() skipped — getAccountInfo failed')
        return
      }
      console.log('[NpubcashQuoteWatcher] start() — begin (infinite retry)')
      await runSubscribe()
    } finally {
      isStarting = false
    }
  }

  const stop = () => {
    if (unsubscribe) {
      console.log('[NpubcashQuoteWatcher] stop() — closing subscription')
      unsubscribe()
      unsubscribe = null
      reconnectAttempts = 0
    } else {
      console.log('[NpubcashQuoteWatcher] stop() — nothing to close')
    }
  }

  const syncNow = async () => {
    if (syncing) {
      console.log('[NpubcashQuoteWatcher] syncNow() skipped — already syncing')
      return
    }
    const privkey = getPrivkey()
    if (!privkey) {
      console.log('[NpubcashQuoteWatcher] syncNow() skipped — no privkey')
      return
    }
    syncing = true
    try {
      console.log('[NpubcashQuoteWatcher] syncNow() — manual sync triggered')
      await syncMissedQuotes(privkey)
      console.log('[NpubcashQuoteWatcher] syncNow() — done')
    } catch (err) {
      console.warn('[NpubcashQuoteWatcher] syncNow() failed:', err)
    } finally {
      syncing = false
    }
  }

  return { start, stop, syncNow }
}
