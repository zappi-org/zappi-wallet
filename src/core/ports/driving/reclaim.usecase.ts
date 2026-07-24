import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'

export interface ReclaimSuccess {
    amount: { value: number; unit: string }
    accountId: string
}

export interface ReclaimUseCase {
    /**
     * Reclaim a pending send transaction.
     * @returns Ok(ReclaimSuccess) on success, Err(BaseError) on failure
     */
    reclaim(txId: string): Promise<Result<ReclaimSuccess, BaseError>>
    finalizeSend(txId: string): Promise<void>
    /**
     * @param companionTxId the receive row that already carries this reclaim's
     * 되찾음 label, so the send row keeps normal send presentation.
     */
    markSendReclaimed(txId: string, reclaimFee?: number, companionTxId?: string): Promise<boolean>
}