import { useServiceRegistry } from './use-service-registry'
// Expose PaymentRoute constants from driving port for UI consumption
export { PaymentRoute, ROUTE_LABELS } from '@/core/ports/driving/routing.usecase'

export function useRouting() {
  return useServiceRegistry().routing
}
