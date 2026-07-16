import type { PaymentAliasProvider } from '@/core/ports/driven/payment-alias-provider.port'
import type { RoutePaymentOperator } from '@/core/ports/driven/route-payment-operator.port'
import type { NostrSigner } from '@/core/ports/driven/nostr-signer.port'
import type { EventBus } from '@/core/events/event-bus'
import type { PaidQuote } from '@/core/ports/driven/payment-alias-provider.port'
import type { PaymentAliasProcessedQuotesRepository } from '@/core/ports/driven/payment-alias-processed-quotes.repository.port'

export type SignerFactory = (privkey: string) => NostrSigner

export function createNpubcashQuoteWatcher(
  provider: PaymentAliasProvider,
  mint: Pick<RoutePaymentOperator, 'mintAndReceive'>,
  createSigner: SignerFactory,
  getPrivkey: () => string | null,
  eventBus: EventBus,
  processedQuotesRepo: PaymentAliasProcessedQuotesRepository,
) {
  let unsubscribe: (() => void) | null = null
  let isStarting = false
  let reconnectAttempts = 0
  const maxReconnectAttempts = 5
  const reconnectDelay = 2_000
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
    const signer = createSigner(privkey)
    const session = await provider.authenticate(signer)
    if (!session.ok) return
    const quotes = await provider.getPaidQuotes(session.value)
    if (!quotes.ok) return
    for (const q of quotes.value) {
      await handleQuote(q)
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

    console.log('[NpubcashQuoteWatcher] syncMissedQuotes() — start')
    await syncMissedQuotes(privkey)
    console.log('[NpubcashQuoteWatcher] syncMissedQuotes() — done')

    const signer = createSigner(privkey)
    const result = await provider.subscribePaidQuotes(
      signer,
      async (quoteId) => {
        const session = await provider.authenticate(signer)
        if (!session.ok) return
        const quotes = await provider.getPaidQuotes(session.value)
        if (!quotes.ok) return
        for (const q of quotes.value) {
          if (q.quoteId === quoteId) {
            await handleQuote(q)
          }
        }
      },
      () => {
        unsubscribe = null
        reconnectAttempts++
        if (reconnectAttempts > maxReconnectAttempts) {
          console.warn(`[NpubcashQuoteWatcher] onDisconnect — max retries (${maxReconnectAttempts}) exceeded, giving up`)
          return
        }
        console.log(`[NpubcashQuoteWatcher] onDisconnect — WS dead, scheduling restart ${reconnectAttempts}/${maxReconnectAttempts} in ${reconnectDelay}ms`)
        setTimeout(() => { internalReconnect() }, reconnectDelay)
      },
    )
    if (result.ok) {
      unsubscribe = result.value
      console.log('[NpubcashQuoteWatcher] WS subscription established')
    } else {
      console.warn('[NpubcashQuoteWatcher] WS subscription failed:', result.error)
    }
  }

  const internalReconnect = async () => {
    if (isStarting) {
      console.log('[NpubcashQuoteWatcher] internalReconnect skipped — already starting')
      return
    }
    isStarting = true
    try {
      console.log(`[NpubcashQuoteWatcher] internalReconnect — attempt ${reconnectAttempts}/${maxReconnectAttempts}`)
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
      if (!info.ok || !info.value.alias) {
        console.log('[NpubcashQuoteWatcher] start() skipped — no alias registered')
        return
      }
      console.log('[NpubcashQuoteWatcher] start() — begin (budget: 5, fresh)')
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

  return { start, stop }
}
