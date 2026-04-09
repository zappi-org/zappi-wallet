import { useServiceRegistry } from './use-service-registry'

export function usePaymentRequest() {
  return useServiceRegistry().paymentRequest
}
