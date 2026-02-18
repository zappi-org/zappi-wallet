import i18n from '@/i18n'
import type { BaseError } from './base'
import type { InsufficientBalanceError } from './cashu'

const ERROR_KEY_MAP: Record<string, string> = {
  // Security errors
  INVALID_MNEMONIC: 'errors.invalidMnemonic',
  INVALID_PASSWORD: 'errors.invalidPassword',
  NO_WALLET: 'errors.noWallet',
  CREATE_WALLET_FAILED: 'errors.createWalletFailed',
  UNLOCK_FAILED: 'errors.unlockFailed',
  CHANGE_PASSWORD_FAILED: 'errors.changePasswordFailed',
  GET_MNEMONIC_FAILED: 'errors.getMnemonicFailed',
  VERIFY_FAILED: 'errors.verifyFailed',
  ENCRYPTION_FAILED: 'errors.encryptionFailed',
  DECRYPTION_FAILED: 'errors.decryptionFailed',
  SECURITY_ERROR: 'errors.securityError',
  // Cashu errors
  TOKEN_SPENT: 'errors.tokenSpent',
  INSUFFICIENT_BALANCE: 'errors.insufficientBalance',
  MINT_CONNECTION: 'errors.mintConnection',
  MINT_ERROR: 'errors.mintError',
  INVALID_TOKEN: 'errors.invalidToken',
  INVALID_PROOF: 'errors.invalidProof',
  QUOTE_NOT_FOUND: 'errors.quoteNotFound',
  QUOTE_EXPIRED: 'errors.quoteExpired',
  P2PK_UNLOCK_FAILED: 'errors.p2pkUnlockFailed',
  // Nostr errors
  RELAY_CONNECTION: 'errors.relayConnection',
  EVENT_PUBLISH_FAILED: 'errors.eventPublishFailed',
  EVENT_NOT_FOUND: 'errors.eventNotFound',
  MESSAGE_DECRYPTION_FAILED: 'errors.messageDecryptionFailed',
  NIP05_LOOKUP_FAILED: 'errors.nip05LookupFailed',
  INVALID_SIGNATURE: 'errors.invalidSignature',
  // Base errors
  NETWORK_ERROR: 'errors.networkError',
  TIMEOUT: 'errors.timeoutError',
  UNKNOWN: 'errors.unknownError',
}

export function translateError(error: BaseError): string {
  const key = ERROR_KEY_MAP[error.code]
  if (!key) return error.toUserMessage()

  if (error.code === 'INSUFFICIENT_BALANCE') {
    const e = error as InsufficientBalanceError
    return i18n.t(key, { required: e.required, available: e.available })
  }

  return i18n.t(key)
}
