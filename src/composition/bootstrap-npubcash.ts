/**
 * Bootstrap fragment — Npubcash quote watcher assembly.
 *
 * Mirrors bootstrap-incoming.ts pattern: creates the watcher with its
 * dependencies and returns it for lifecycle wiring in bootstrap-lifecycle.ts.
 */

import { createNpubcashQuoteWatcher } from './npubcash-quote-watcher'
import { DexieLightningReceiptCursorStore } from '@/adapters/storage/dexie/dexie-lightning-receipt-cursor.store'
import { DexiePaymentAliasProcessedQuotesRepository } from '@/adapters/storage/dexie/dexie-payment-alias-processed-quotes.repository'
import { Secp256k1NostrSignerAdapter } from '@/adapters/crypto/secp256k1-nostr-signer'
import { useAppStore } from '@/store'

import type { PaymentAliasProvider } from '@/core/ports/driven/payment-alias-provider.port'
import type { RoutePaymentOperator } from '@/core/ports/driven/route-payment-operator.port'
import type { EventBus } from '@/core/events/event-bus'

export function assembleNpubcashWatcher(deps: {
  npubcashAdapter: PaymentAliasProvider
  routePaymentOperator: RoutePaymentOperator
  eventBus: EventBus
}) {
  const { npubcashAdapter, routePaymentOperator, eventBus } = deps

  const cursorStore = new DexieLightningReceiptCursorStore()
  const processedQuotesRepo = new DexiePaymentAliasProcessedQuotesRepository()

  const npubcashQuoteWatcher = createNpubcashQuoteWatcher({
    provider: npubcashAdapter,
    mint: routePaymentOperator,
    createSigner: (privkey: string) => new Secp256k1NostrSignerAdapter(privkey),
    getPrivkey: () => useAppStore.getState().nostrPrivkey,
    getPubkey: () => useAppStore.getState().nostrPubkey,
    eventBus,
    processedQuotesRepo,
    cursorStore,
  })

  return { npubcashQuoteWatcher }
}
