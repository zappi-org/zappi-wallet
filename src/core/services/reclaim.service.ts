//core/service/reclaim.serivce.ts
import {
    isClaimedSend
} from '@/core/domain/transaction';
import type { SendTokenOperator } from '@/core/ports/driven/send-token-operator.port';
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port';
import { isReclaimableSend, isReclaimed, settleAsReclaimed } from "../domain/transaction";
import type { EventBus } from '../events/event-bus';
import type { PendingOperationRepository } from "../ports/driven/pending-operation.repository.port";
import type { TokenReceiver } from "../ports/driven/token-receiver.port";
import type { ReclaimResult, ReclaimUseCase } from "../ports/driving/reclaim.usecase";

export class ReclaimService implements ReclaimUseCase {
    constructor (
        private readonly txRepo: TransactionRepository,
        private readonly sendOp: SendTokenOperator,
        private readonly tokenReceiver: TokenReceiver,
        private readonly pendingOps: PendingOperationRepository,
        private readonly eventBus: EventBus,
    ) {}

    

    async reclaim(txId: string): Promise<ReclaimResult>{
        const tx = await this.txRepo.getById(txId)

        //check domain state
       if (tx && isReclaimed(tx)) {
        await this.pendingOps.delete(txId)
        return {success:true}
       }
       // already spent
       if(tx && isClaimedSend(tx)) {
        return {success:false, alreadySpent:true}
       }

       if(!isReclaimableSend(tx)){
            return {success:false, errorCode: 'NOT_RECLAIMABLE' }
       }


       const opId = tx.metadata?.operationId as string | undefined
       const token = tx.metadata?.token as string | undefined
       
       //by opId
       if(opId) {
        //coco ops.send.cancel / reclaim
        try {
            await this.sendOp.rollbackSendToken(opId)
        } catch {
            const txAgain= await this.txRepo.getById(txId)
            if(txAgain && isReclaimed(txAgain)) {
                return {success:true }
            }
            return {success: false, errorCode: 'ROLLBACK_FAILED' }
        }
        //tokenReceiver is already made receive TX
        //not making companion TX, just update send TX
        await this.markSendReclaimed(txId)
        return {success: true}
       }
       //by token 
       if(token){
        const result = await this.tokenReceiver.receiveToken(token)
        if(!result.ok){
            return { success: false, errorCode: result.error.code }
        }
        await this.markSendReclaimed(txId)
        return {success : true}
       }
       return {success: false, errorCode: 'NO_TOKEN_OR_OPERATION' }
    }
    async finalizeSend(txId: string): Promise<void> {
        const tx = await this.txRepo.getById(txId)
            if(!tx) return

        const opId = tx.metadata?.operationId as string | undefined
        if(opId){
            await this.sendOp.finalizeSend(opId)
        }
    }
    async markSendReclaimed(txId:string): Promise<boolean> {

        const tx = await this.txRepo.getById(txId)

        if(!tx || !isReclaimableSend(tx)) return false

        const reclaimed = settleAsReclaimed(tx) 
        await this.txRepo.update(txId, {
            status: reclaimed.status,
            outcome: reclaimed.outcome,
            completedAt: reclaimed.completedAt
        })

        await this.pendingOps.delete(txId)
        this.eventBus.emit({
            type:'transactions:changed',
            payload: {reason: 'send-reclaimed', txId},
        })

        this.eventBus.emit({
            type: 'balance:changed',
            payload: {
                moduleId: tx.method.split(':')[0] || tx.method,
                accountId: tx.accountId,
            },
        })
        return true;
    }
}