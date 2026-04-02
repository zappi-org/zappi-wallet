import type { ErrorCode } from './codes'

/** Plain error shape for Result<T, PaymentError> usage */
export interface PaymentError {
  code: ErrorCode
  message: string
}
