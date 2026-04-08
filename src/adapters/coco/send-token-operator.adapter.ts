import type { SendTokenOperator, ProofStateResult } from '@/core/ports/driven/send-token-operator.port'

export class SendTokenOperatorAdapter implements SendTokenOperator {
  async rollbackSendToken(operationId: string): Promise<void> {
    const { rollbackSendToken } = await import('@/modules/cashu')
    await rollbackSendToken(operationId)
  }

  async finalizeSend(_operationId: string): Promise<void> {
    // Coco SDK doesn't have explicit finalizeSend.
    // Finalization is handled by the send token observer when the recipient claims.
    // This is a no-op — the actual state update is done via markSendFinalized.
  }

  async markSendFinalized(txId: string): Promise<void> {
    const { markSendFinalized } = await import('@/composition/send-token-observer')
    await markSendFinalized(txId)
  }

  async markSendReclaimed(txId: string): Promise<void> {
    const { markSendReclaimed } = await import('@/composition/send-token-observer')
    await markSendReclaimed(txId)
  }

  async checkProofStates(token: string): Promise<ProofStateResult> {
    const cashuTs = await import('@cashu/cashu-ts')
    const decoded = cashuTs.getDecodedToken(token)

    // Use cashu-ts wallet to check proof states
    const wallet = new (cashuTs as unknown as { CashuWallet: new (mint: unknown) => { checkProofsStates(proofs: unknown[]): Promise<unknown[]> } }).CashuWallet(
      new (cashuTs as unknown as { CashuMint: new (url: string) => unknown }).CashuMint(decoded.mint)
    )
    const states = await wallet.checkProofsStates(decoded.proofs)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = (states as any[]).map((s) => ({
      secret: String(s.secret ?? s.Y ?? ''),
      state: String(s.state ?? 'unknown') as 'unspent' | 'pending' | 'spent',
    }))

    return {
      allSpent: mapped.every((s) => s.state === 'spent'),
      allPending: mapped.every((s) => s.state === 'pending'),
      states: mapped,
    }
  }
}
