export interface ReclaimResult {
    success: boolean
    alreadySpent?: boolean
    errorCode?: string
}

export interface ReclaimUseCase{
    reclaim(txId: string): Promise<ReclaimResult>
    finalizeSend(txId: string): Promise<void>
    markSendReclaimed(txId: string): Promise<boolean>

}