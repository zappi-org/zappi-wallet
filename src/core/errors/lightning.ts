import { BaseError } from './base'

/**
 * Invalid BOLT11 invoice format
 */
export class InvalidInvoiceError extends BaseError {
  readonly code = 'INVALID_INVOICE' as const
  readonly isRetryable = false

  constructor(message = 'Invalid Lightning invoice', cause?: unknown) {
    super(message, cause)
  }
}

/**
 * Lightning invoice has expired
 */
export class InvoiceExpiredError extends BaseError {
  readonly code = 'INVOICE_EXPIRED' as const
  readonly isRetryable = false

  constructor(message = 'Invoice has expired', cause?: unknown) {
    super(message, cause)
  }
}

/**
 * Lightning payment routing failed
 */
export class LightningRoutingError extends BaseError {
  readonly code = 'LIGHTNING_ROUTING' as const
  readonly isRetryable = true

  constructor(message = 'Lightning payment routing failed', cause?: unknown) {
    super(message, cause)
  }
}

/**
 * Lightning payment failed (generic)
 */
export class LightningPaymentError extends BaseError {
  readonly code = 'LIGHTNING_PAYMENT' as const
  readonly isRetryable = false

  constructor(message = 'Lightning payment failed', cause?: unknown) {
    super(message, cause)
  }
}
