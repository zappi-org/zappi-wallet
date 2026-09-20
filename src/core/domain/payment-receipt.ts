import type { Amount } from './amount'
import type { Transaction } from './transaction'
import { mintUrlKey } from './mint-url'

/** A local receipt must match the redeemed token, including its receive fee. */
export function matchesTokenReceipt(
  transaction: Transaction | null,
  token: { token: string; mintUrl: string; amount: Amount },
): transaction is Transaction {
  if (!transaction || transaction.direction !== 'receive' || transaction.status !== 'settled') return false
  const fee = transaction.fee?.effective
  return transaction.amount.unit === token.amount.unit &&
    (transaction.amount.value === token.amount.value ||
      (fee?.unit === transaction.amount.unit && transaction.amount.value + fee.value === token.amount.value)) &&
    mintUrlKey(transaction.accountId) === mintUrlKey(token.mintUrl) &&
    transaction.metadata?.token === token.token
}
