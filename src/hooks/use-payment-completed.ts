import { useEffect, useContext } from 'react'
import { ServiceContext } from '@/hooks/service-context-value'

/**
 * Subscribe to payment:completed events filtered by transactionId.
 * Used by TokenCreatedStep to detect when recipient claims the token.
 */
export function usePaymentCompleted(
  transactionId: string | undefined,
  callback: () => void,
): void {
  const registry = useContext(ServiceContext)

  useEffect(() => {
    if (!transactionId || !registry?.eventBus) return

    const unsub = registry.eventBus.on('payment:completed', (event) => {
      if (event.payload.txId === transactionId) callback()
    })

    return unsub
  }, [transactionId, registry, callback])
}
