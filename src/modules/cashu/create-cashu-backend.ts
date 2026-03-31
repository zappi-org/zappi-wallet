/**
 * createCashuBackend — CashuModuleBackend factory
 *
 * cashu-backend.ts의 standalone 함수들을 CashuModuleBackend 인터페이스에 맞게 조립.
 * 유일하게 internal/을 import하는 파일. bootstrap에서 호출하여 CashuModule에 주입.
 */

import type { CashuModuleBackend } from './cashu.module'
import * as backend from './internal/cashu-backend'

export function createCashuBackend(): CashuModuleBackend {
  return {
    // LightningBackend
    prepareMelt: backend.prepareMelt,
    executeMelt: backend.executeMelt,
    rollbackMelt: backend.rollbackMelt,
    createMintQuote: backend.createMintQuote,
    redeemMintQuote: backend.redeemMintQuote,
    recoverPendingMelts: backend.recoverPendingMelts,
    // EcashBackend
    prepareSend: backend.prepareSend,
    executeSend: backend.executeSend,
    rollbackSend: backend.rollbackSend,
    receiveToken: backend.receiveToken,
    recoverPendingSendTokens: backend.recoverPendingSendTokens,
    // Module-level
    getBalances: backend.getBalances,
  }
}
