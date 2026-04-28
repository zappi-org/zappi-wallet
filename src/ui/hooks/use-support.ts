import { useServiceRegistry } from './use-service-registry'

export function useSupport() {
  return useServiceRegistry().support
}
