import { useServiceRegistry } from './use-service-registry'

export function useUsername() {
  return useServiceRegistry().username
}
