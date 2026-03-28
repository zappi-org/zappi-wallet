import i18n from '@/i18n'
import type { BaseError } from './base'
import type { InsufficientBalanceError, MintConnectionError } from './cashu'
import { formatSats } from '@/utils/format'

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
  // Lightning errors
  INVALID_INVOICE: 'errors.invalidInvoice',
  INVOICE_EXPIRED: 'errors.invoiceExpired',
  LIGHTNING_ROUTING: 'errors.lightningRouting',
  LIGHTNING_PAYMENT: 'errors.lightningPayment',
  // Zappi Link errors
  ZAPPI_LINK_REGISTRATION_FAILED: 'errors.zappiLinkRegistrationFailed',
  ZAPPI_LINK_NOT_FOUND: 'errors.zappiLinkNotFound',
  ZAPPI_LINK_API_ERROR: 'errors.zappiLinkApiError',
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

let mintNameResolver: ((mintUrl: string) => string | null) | null = null

export function setMintNameResolver(resolver: (mintUrl: string) => string | null): void {
  mintNameResolver = resolver
}

export function translateError(error: BaseError): string {
  const key = ERROR_KEY_MAP[error.code]
  if (!key) return error.toUserMessage()

  if (error.code === 'MINT_CONNECTION') {
    const e = error as MintConnectionError
    let mintName = e.mintUrl
    try {
      const hostname = new URL(e.mintUrl).hostname
      mintName = hostname
    } catch { /* fallback to url */ }
    if (mintNameResolver) {
      mintName = mintNameResolver(e.mintUrl) || mintName
    }
    return i18n.t(key, { mint: mintName })
  }

  if (error.code === 'INSUFFICIENT_BALANCE') {
    const e = error as InsufficientBalanceError
    const required = formatSats(e.required)
    const available = formatSats(e.available)
    if (e.isFeeShortage) {
      return i18n.t('errors.insufficientBalanceForFee', { required, available })
    }
    return i18n.t(key, { required, available })
  }

  return i18n.t(key)
}
