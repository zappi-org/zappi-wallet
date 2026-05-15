import type { Transaction } from '@/core/domain/transaction'
import { getTxMeta } from '@/core/domain/transaction'

export function isNpubTransaction(tx: Transaction): boolean {
  const meta = getTxMeta(tx)
  return (
    meta.counterpartyAddressType === 'npub' ||
    meta.counterpartyAddressType === 'nprofile' ||
    (tx.direction === 'receive' && meta.source === 'gift-wrap' && !!(meta.counterpartyPubkey || meta.sender))
  )
}
