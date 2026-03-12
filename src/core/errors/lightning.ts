import { BaseError } from './base'

/**
 * Invalid BOLT11 invoice format
 */
export class InvalidInvoiceError extends BaseError {
  readonly code = 'INVALID_INVOICE'
  readonly isRetryable = false

  constructor(message = 'Invalid Lightning invoice', cause?: unknown) {
    super(message, cause)
  }

  toUserMessage(): string {
    return '올바르지 않은 Lightning 인보이스입니다'
  }
}

/**
 * Lightning invoice has expired
 */
export class InvoiceExpiredError extends BaseError {
  readonly code = 'INVOICE_EXPIRED'
  readonly isRetryable = false

  constructor(message = 'Invoice has expired', cause?: unknown) {
    super(message, cause)
  }

  toUserMessage(): string {
    return 'Lightning 인보이스가 만료되었습니다'
  }
}

/**
 * Lightning payment routing failed
 */
export class LightningRoutingError extends BaseError {
  readonly code = 'LIGHTNING_ROUTING'
  readonly isRetryable = true

  constructor(message = 'Lightning payment routing failed', cause?: unknown) {
    super(message, cause)
  }

  toUserMessage(): string {
    return 'Lightning 결제 경로를 찾을 수 없습니다'
  }
}

/**
 * Lightning payment failed (generic)
 */
export class LightningPaymentError extends BaseError {
  readonly code = 'LIGHTNING_PAYMENT'
  readonly isRetryable = false

  constructor(message = 'Lightning payment failed', cause?: unknown) {
    super(message, cause)
  }

  toUserMessage(): string {
    return 'Lightning 결제에 실패했습니다'
  }
}
