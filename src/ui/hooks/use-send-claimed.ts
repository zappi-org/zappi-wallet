import { useEffect, useContext } from 'react'
import { ServiceContext } from '@/ui/hooks/service-context-value'

/**
 * Subscribe to send:claimed events filtered by transactionId.
 * Used by CreatedStep / TokenCreatedStep to detect when the recipient
 * claims the outgoing token.
 */
export function useSendClaimed(
  transactionId: string | undefined,
  callback: () => void,
): void {
  const registry = useContext(ServiceContext)

  useEffect(() => {
    if (!transactionId || !registry?.eventBus) return

    const unsubSendClaimed = registry.eventBus.on('send:claimed', (event) => {
      if (event.payload.txId === transactionId) callback()
    })

    const unsubTransferSettled = registry.eventBus.on('transfer:settled', (event) => {
      const transfer = event.payload.transfer
      if (transfer.txId === transactionId && transfer.direction === 'outgoing') {
        callback()
      }
    })

    return () => {
      unsubSendClaimed()
      unsubTransferSettled()
    }
  }, [transactionId, registry, callback])
}
