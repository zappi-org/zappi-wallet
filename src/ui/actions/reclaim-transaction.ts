import { toNumber } from '@/core/domain/amount'
import { ServiceNotReadyError } from '@/core/errors/base'
import type { BaseError } from '@/core/errors/base'
import { TranscationNotFoundError } from '@/core/errors/transaction'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import type { ReclaimSuccess } from '@/core/ports/driving/reclaim.usecase'
import { broadcastSync } from '@/utils/cross-tab-sync'

type ReclaimRegistry = Pick<ServiceRegistry, 'reclaim' | 'transactionMgmt'>

export interface ReclaimActionResult {
  success: boolean
  amount?: {
    value: number
    unit: string
  }
  accountId?: string
  error?: BaseError
  alreadySpent?: boolean
}

export async function reclaimTransaction(
  registry: ReclaimRegistry | null | undefined,
  txId: string,
): Promise<ReclaimActionResult> {
  if (!registry?.reclaim?.reclaim || !registry?.transactionMgmt?.getById) {
    console.error('[reclaimTransaction] Service not available')
    return {
      success: false,
      error: new ServiceNotReadyError('reclaim'),
    }
  }

  const tx = await registry.transactionMgmt.getById(txId)

  if (!tx) {
    return {
      success: false,
      error: new TranscationNotFoundError(txId),
    }
  }

  const result = await registry.reclaim.reclaim(txId)

  if (!result.ok) {
    const error = result.error
    console.error('[reclaimTransaction] Reclaim failed:', { code: error.code })

    return {
      success: false,
      error,
      alreadySpent: error.code === 'TOKEN_SPENT',
      amount: {
        value: toNumber(tx.amount),
        unit: tx.amount.unit || 'sat',
      },
      accountId: tx.accountId,
    }
  }

  const successData: ReclaimSuccess = result.value
  broadcastSync('balance_changed')

  return {
    success: true,
    amount: successData.amount,
    accountId: successData.accountId,
  }
}
