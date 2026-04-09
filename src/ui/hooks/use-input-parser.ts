import { useServiceRegistry } from './use-service-registry'

export function useInputParser() {
  return useServiceRegistry().inputParser
}
