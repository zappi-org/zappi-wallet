/**
 * createCashuBackend — CashuModuleBackend factory
 *
 * cashu-backend.ts의 standalone 함수들을 CashuModuleBackend 인터페이스에 맞게 조립.
 * 유일하게 internal/을 import하는 파일. bootstrap에서 호출하여 CashuModule에 주입.
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
    createMintQuote: backend.createMintQuote,
    redeemMintQuote: backend.redeemMintQuote,
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
    // Mint quote 결제 완료 감지 (스왑 완료 대기에 필요)
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
