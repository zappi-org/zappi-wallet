import { useServiceRegistry } from './use-service-registry'

export function useTransactionMgmt() {
  return useServiceRegistry().transactionMgmt
}
