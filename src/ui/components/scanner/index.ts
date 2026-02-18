export { UnifiedScanner } from './UnifiedScanner'
export type { UnifiedScannerProps } from './UnifiedScanner'

export {
  detectInputType,
  requiresNetworkValidation,
  canProceedOffline,
  getInputTypeName,
  type InputType,
  type Bolt11Input,
  type LightningAddressInput,
  type LnurlInput,
  type CashuTokenInput,
  type CashuRequestInput,
  type NostrPubkeyInput,
  type NostrEventInput,
  type AmountInput,
  type UnknownInput,
} from './InputTypeDetector'

export {
  validateInput,
  type ValidationResult,
  type ValidationSuccess,
  type ValidationError,
  type ValidationErrorCode,
  type ValidatedData,
  type ValidatedBolt11,
  type ValidatedLightningAddress,
  type ValidatedLnurlPay,
  type ValidatedLnurlWithdraw,
  type ValidatedCashuToken,
  type ValidatedCashuRequest,
  type ValidatedNostrPubkey,
  type ValidatedNostrEvent,
  type ValidatedAmount,
  type LnurlWithdrawParams,
  type ParsedCashuRequest,
  type CashuRequestTransport,
} from './InputValidator'
