import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sat } from '@/core/domain/amount'
import { OUTGOING_ECASH_SYNC } from '@/core/constants'
import type {
  OutgoingClaimState,
  OutgoingDeliveryState,
  OutgoingEcashOperation,
} from '@/core/domain/outgoing-ecash-lifecycle'
import { createTransaction } from '@/core/domain/transaction'
import type { EventBus } from '@/core/events/event-bus'
import type { OutgoingClaimStateProbe } from '@/core/ports/driven/outgoing-claim-state-probe.port'
import type { OutgoingEcashOperationStore } from '@/core/ports/driven/outgoing-ecash-operation-store.port'
import type { PendingOperationRepository } from '@/core/ports/driven/pending-operation.repository.port'
import type { SendTokenOperator } from '@/core/ports/driven/send-token-operator.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import { OutgoingEcashLifecycleService } from '@/core/services/outgoing-ecash-lifecycle.service'

class MemoryOutgoingStore implements OutgoingEcashOperationStore {
  records = new Map<string, OutgoingEcashOperation>()

  async save(operation: OutgoingEcashOperation): Promise<void> {
    this.records.set(operation.txId, operation)
  }

  async getByTxId(txId: string): Promise<OutgoingEcashOperation | null> {
    return this.records.get(txId) ?? null
  }

  async update(txId: string, patch: Partial<OutgoingEcashOperation>): Promise<void> {
    const current = this.records.get(txId)
    if (!current) return
    this.records.set(txId, { ...current, ...patch })
  }

  async listOpen(): Promise<OutgoingEcashOperation[]> {
    return [...this.records.values()].filter((record) => record.claim !== 'claimed' && record.claim !== 'reclaimed')
  }

  async listByClaimState(claim: OutgoingClaimState): Promise<OutgoingEcashOperation[]> {
    return [...this.records.values()].filter((record) => record.claim === claim)
  }

  async listByDeliveryState(delivery: OutgoingDeliveryState): Promise<OutgoingEcashOperation[]> {
    return [...this.records.values()].filter((record) => record.delivery === delivery)
  }
}

describe('OutgoingEcashLifecycleService', () => {
  let store: MemoryOutgoingStore
  let txRepo: TransactionRepository
  let claimProbe: OutgoingClaimStateProbe
  let eventBus: EventBus
  let sendTokenOperator: Pick<SendTokenOperator, 'finalizeSend'>
  let pendingOps: Pick<PendingOperationRepository, 'delete'>

  beforeEach(() => {
    store = new MemoryOutgoingStore()
    txRepo = {
      getById: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    } as unknown as TransactionRepository
    claimProbe = {
      checkClaimState: vi.fn().mockResolvedValue('claimable'),
    }
    eventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }
    sendTokenOperator = {
      finalizeSend: vi.fn<SendTokenOperator['finalizeSend']>().mockResolvedValue(undefined),
    }
    pendingOps = {
      delete: vi.fn<PendingOperationRepository['delete']>().mockResolvedValue(undefined),
    }
  })

  it('records delivery separately from claim state', async () => {
    const service = new OutgoingEcashLifecycleService(store, txRepo, claimProbe, eventBus)
    await service.recordCreated({
      txId: 'tx-1',
      kind: 'direct-nostr-send',
      accountId: 'https://mint.test',
      amount: 10,
      token: 'cashuAtoken',
      operationId: 'op-1',
      delivery: 'pending_publish',
    })

    const status = await service.recordDeliveryResult('tx-1', 'published')

    expect(status?.operation.delivery).toBe('published')
    expect(status?.operation.claim).toBe('unclaimed')
    expect(status?.displayState).toBe('published_waiting_claim')
  })

  it('fills token metadata when the same operation is recorded after execution', async () => {
    const service = new OutgoingEcashLifecycleService(store, txRepo, claimProbe, eventBus)
    await service.recordCreated({
      txId: 'tx-1',
      kind: 'token-create',
      accountId: 'https://mint.test',
      amount: 10,
      operationId: 'op-1',
      delivery: 'not_required',
    })
    await service.recordCreated({
      txId: 'tx-1',
      kind: 'token-create',
      accountId: 'https://mint.test',
      amount: 10,
      token: 'cashuAtoken',
      operationId: 'op-1',
      delivery: 'not_required',
    })

    expect(store.records.get('tx-1')).toEqual(expect.objectContaining({
      token: 'cashuAtoken',
      operationId: 'op-1',
    }))
  })

  it('moves stale publish-in-progress operations to recoverable unknown delivery', async () => {
    const service = new OutgoingEcashLifecycleService(store, txRepo, claimProbe, eventBus)
    await service.recordCreated({
      txId: 'tx-1',
      kind: 'direct-nostr-send',
      accountId: 'https://mint.test',
      amount: 10,
      token: 'cashuAtoken',
      operationId: 'op-1',
      delivery: 'pending_publish',
    })
    const current = store.records.get('tx-1')
    if (!current) throw new Error('expected outgoing operation')
    store.records.set('tx-1', {
      ...current,
      updatedAt: Date.now() - OUTGOING_ECASH_SYNC.PENDING_PUBLISH_STALE_MS - 1,
    })

    const status = await service.checkStatus('tx-1')

    expect(status?.operation.delivery).toBe('unknown')
    expect(status?.operation.claim).toBe('unclaimed')
    expect(status?.canReclaim).toBe(true)
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ reason: 'outgoing-publish-stale' }),
    }))
  })

  it('settles the transaction when adapter reports claimed', async () => {
    vi.mocked(claimProbe.checkClaimState).mockResolvedValue('claimed')
    vi.mocked(txRepo.getById).mockResolvedValue(createTransaction({
      id: 'tx-1',
      direction: 'send',
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      amount: sat(10),
      accountId: 'https://mint.test',
      outcome: 'unclaimed',
      metadata: { token: 'cashuAtoken', operationId: 'op-1' },
    }))
    const service = new OutgoingEcashLifecycleService(
      store,
      txRepo,
      claimProbe,
      eventBus,
      sendTokenOperator,
      pendingOps,
    )

    const status = await service.checkStatus('tx-1')

    expect(status?.operation.claim).toBe('claimed')
    expect(sendTokenOperator.finalizeSend).toHaveBeenCalledWith('op-1')
    expect(pendingOps.delete).toHaveBeenCalledWith('tx-1')
    expect(txRepo.update).toHaveBeenCalledWith('tx-1', expect.objectContaining({
      status: 'settled',
      outcome: 'claimed',
    }))
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'send:claimed' }))
  })

  it('absorbs legacy pending ecash sends during reconciliation', async () => {
    const legacyTx = createTransaction({
      id: 'tx-legacy',
      direction: 'send',
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      amount: sat(25),
      accountId: 'https://mint.test',
      outcome: 'unclaimed',
      metadata: { token: 'cashuAlegacy', operationId: 'op-legacy' },
    })
    vi.mocked(txRepo.list).mockResolvedValue([legacyTx])
    vi.mocked(txRepo.getById).mockResolvedValue(legacyTx)
    vi.mocked(claimProbe.checkClaimState).mockResolvedValue('claimable')
    const service = new OutgoingEcashLifecycleService(store, txRepo, claimProbe, eventBus)

    const report = await service.reconcileOpen()

    expect(report).toEqual({ checked: 1, claimed: 0, failed: 0 })
    expect(store.records.get('tx-legacy')).toEqual(expect.objectContaining({
      txId: 'tx-legacy',
      kind: 'token-create',
      accountId: 'https://mint.test',
      amount: 25,
      token: 'cashuAlegacy',
      operationId: 'op-legacy',
      delivery: 'not_required',
      claim: 'unclaimed',
    }))
    expect(claimProbe.checkClaimState).toHaveBeenCalledWith({
      token: 'cashuAlegacy',
      operationId: 'op-legacy',
    })
  })

  it('does not finalize SDK operation when observer already marked the send claimed', async () => {
    vi.mocked(txRepo.getById).mockResolvedValue(createTransaction({
      id: 'tx-1',
      direction: 'send',
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      amount: sat(10),
      accountId: 'https://mint.test',
      outcome: 'unclaimed',
      metadata: { token: 'cashuAtoken', operationId: 'op-1' },
    }))
    const service = new OutgoingEcashLifecycleService(
      store,
      txRepo,
      claimProbe,
      eventBus,
      sendTokenOperator,
      pendingOps,
    )

    await service.markClaimed('tx-1')

    expect(sendTokenOperator.finalizeSend).not.toHaveBeenCalled()
    expect(pendingOps.delete).toHaveBeenCalledWith('tx-1')
    expect(txRepo.update).toHaveBeenCalledWith('tx-1', expect.objectContaining({
      status: 'settled',
      outcome: 'claimed',
    }))
  })

  it('settles the transaction as reclaimed when adapter reports rolled back operation state', async () => {
    vi.mocked(claimProbe.checkClaimState).mockResolvedValue('reclaimed')
    vi.mocked(txRepo.getById).mockResolvedValue(createTransaction({
      id: 'tx-1',
      direction: 'send',
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      amount: sat(10),
      accountId: 'https://mint.test',
      outcome: 'unclaimed',
      metadata: { operationId: 'op-1' },
    }))
    const service = new OutgoingEcashLifecycleService(
      store,
      txRepo,
      claimProbe,
      eventBus,
      sendTokenOperator,
      pendingOps,
    )

    const status = await service.checkStatus('tx-1')

    expect(status?.operation.claim).toBe('reclaimed')
    expect(sendTokenOperator.finalizeSend).not.toHaveBeenCalled()
    expect(pendingOps.delete).toHaveBeenCalledWith('tx-1')
    expect(txRepo.update).toHaveBeenCalledWith('tx-1', expect.objectContaining({
      status: 'settled',
      outcome: 'reclaimed',
    }))
  })
})
