import { useServiceRegistry } from './use-service-registry'

export function useCrypto() {
  return useServiceRegistry().crypto
}
