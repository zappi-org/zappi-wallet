/**
 * createCashuBackend — CashuModuleBackend factory
 *
 * Assembles the standalone functions from cashu-backend.ts into the
 * CashuModuleBackend interface. The only file that imports internal/;
 * called from bootstrap and injected into CashuModule.
 */

import type { PendingOperationRepository } from '@/core/ports/driven/pending-operation.repository.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { CashuModuleBackend } from './cashu.module'
import * as backend from './internal/cashu-backend'
import {
  recoverPendingMelts,
  recoverPendingSendTokens,
  recoverPendingQuotes,
} from './internal/cashu-recovery'
import { abandonMintQuote, getMintQuote } from './internal/coco-sdk'
import type { OfflineTokenStore } from '@/core/ports/driven/offline-token-store.port'
import {
  redeemPendingReceivedTokens,
  storeOfflineToken,
} from './internal/offline-token-recovery'

export interface CreateCashuBackendDeps {
  pendingOpRepo: PendingOperationRepository
  txRepo: TransactionRepository
  offlineTokenStore: OfflineTokenStore
  getActiveMintUrls?: () => string[]
}

export function createCashuBackend(deps: CreateCashuBackendDeps): CashuModuleBackend {
  const activeMintOptions = () => ({
    trustedMintUrls: deps.getActiveMintUrls?.(),
    getCurrentTrustedMintUrls: deps.getActiveMintUrls,
  })

  return {
    // LightningBackend
    prepareMelt: backend.prepareMelt,
    executeMelt: backend.executeMelt,
    rollbackMelt: backend.rollbackMelt,
    checkMelt: backend.checkMelt,
    refreshMelt: backend.refreshMelt,
    getMintOpStateLocal: backend.getMintOpStateLocal,
    createMintQuote: backend.createMintQuote,
    redeemMintQuote: backend.redeemMintQuote,
    mintAndReceive: backend.mintAndReceive,
    getMintQuote,
    checkMintQuote: backend.checkMintQuote,
    async recoverPendingMelts() {
      const meltOps = await backend.getMeltRecoveryOps()
      return recoverPendingMelts({ pendingOpRepo: deps.pendingOpRepo, meltOps })
    },
    // EcashBackend
    prepareSend: backend.prepareSend,
    executeSend: backend.executeSend,
    rollbackSend: backend.rollbackSend,
    finalizeSend: backend.finalizeSend,
    getSendOperationState: backend.getSendOperationState,
    checkProofStates: backend.checkProofStates,
    receiveToken: (token: string) => backend.receiveToken(token, activeMintOptions()),
    estimateReceiveFee: (token: string) => backend.estimateReceiveFee(token, activeMintOptions()),
    async recoverPendingSendTokens() {
      const sendOps = await backend.getSendRecoveryOps()
      return recoverPendingSendTokens({
        pendingOpRepo: deps.pendingOpRepo,
        txRepo: deps.txRepo,
        sendOps,
        receiveToken: async (token: string) => backend.receiveToken(token, activeMintOptions()),
      })
    },
    // Detects mint quote payment completion (needed to await swap completion)
    onMintQuotePaid: backend.onMintQuotePaid,
    // Recovery (quotes) — exposed for CashuBolt11Adapter
    restoreWallet: backend.restoreWallet,
    async recoverPendingQuotes() {
      const quoteOps = await backend.getQuoteRecoveryOps()
      return recoverPendingQuotes({
        pendingOpRepo: deps.pendingOpRepo,
        txRepo: deps.txRepo,
        quoteOps,
        activeMintUrls: deps.getActiveMintUrls?.(),
      })
    },
    // Offline received token recovery
    async redeemPendingReceivedTokens() {
      return redeemPendingReceivedTokens(
        deps.offlineTokenStore,
        (token: string) => backend.receiveToken(token, activeMintOptions()),
      )
    },
    async storeOfflineToken(token: string, amount: number, mintUrl: string, dleqStatus: 'valid' | 'missing') {
      return storeOfflineToken(deps.offlineTokenStore, token, amount, mintUrl, dleqStatus)
    },
    // Token inspection (lock + DLEQ)
    inspectInput: backend.inspectInput,
    abandonMintQuote,
    // PaymentRequest (NUT-18)
    parsePaymentRequest: backend.parsePaymentRequest,
    preparePaymentRequest: backend.preparePaymentRequest,
    executePaymentRequest: backend.executePaymentRequest,
    // Module-level
    getBalances: backend.getBalances,
  }
}
