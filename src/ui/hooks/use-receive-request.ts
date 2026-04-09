import { useServiceRegistry } from './use-service-registry'

export function useReceiveRequest() {
  return useServiceRegistry().receiveRequest
}
