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

export interface CreateCashuBackendDeps {
  pendingOpRepo: PendingOperationRepository
  txRepo: TransactionRepository
}

export function createCashuBackend(deps: CreateCashuBackendDeps): CashuModuleBackend {
  return {
    // LightningBackend
    prepareMelt: backend.prepareMelt,
    executeMelt: backend.executeMelt,
    rollbackMelt: backend.rollbackMelt,
    createMintQuote: backend.createMintQuote,
    redeemMintQuote: backend.redeemMintQuote,
    async recoverPendingMelts() {
      const meltOps = await backend.getMeltRecoveryOps()
      return recoverPendingMelts({ pendingOpRepo: deps.pendingOpRepo, meltOps })
    },
    // EcashBackend
    prepareSend: backend.prepareSend,
    executeSend: backend.executeSend,
    rollbackSend: backend.rollbackSend,
    finalizeSend: backend.finalizeSend,
    receiveToken: backend.receiveToken,
    async recoverPendingSendTokens() {
      const sendOps = await backend.getSendRecoveryOps()
      return recoverPendingSendTokens({
        pendingOpRepo: deps.pendingOpRepo,
        txRepo: deps.txRepo,
        sendOps,
        receiveToken: async (token: string) => backend.receiveToken(token),
      })
    },
    // Recovery (quotes) — exposed for CashuBolt11Adapter
    async recoverPendingQuotes() {
      const quoteOps = await backend.getQuoteRecoveryOps()
      return recoverPendingQuotes({
        pendingOpRepo: deps.pendingOpRepo,
        txRepo: deps.txRepo,
        quoteOps,
      })
    },
    // PaymentRequest (NUT-18)
    parsePaymentRequest: backend.parsePaymentRequest,
    preparePaymentRequest: backend.preparePaymentRequest,
    executePaymentRequest: backend.executePaymentRequest,
    // Module-level
    getBalances: backend.getBalances,
  }
}
