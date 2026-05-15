/**
 * TransferLifecycleService — 단위 테스트
 *
 * Mock Store + Mock Operator + Spy EventBus로 전체 상태 머신 검증
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PendingTransfer, TransferPhase } from '@/core/domain/pending-transfer'
import { createPendingTransfer, transitionPhase } from '@/core/domain/pending-transfer'
import { amount } from '@/core/domain/amount'
import { createEventBus, type EventBus } from '@/core/events/event-bus'
import { InMemoryPendingTransferStore } from '@/core/services/transfer-lifecycle.service.mock-store'
import { TransferLifecycleService } from '@/core/services/transfer-lifecycle.service'
import type { TransferIntent, TransferOperator } from '@/core/ports/driven/transfer-operator.port'

describe('TransferLifecycleService', () => {
  let store: InMemoryPendingTransferStore
  let eventBus: EventBus
  let service: TransferLifecycleService
  let emittedEvents: Array<{ type: string; payload: unknown }>

  beforeEach(() => {
    store = new InMemoryPendingTransferStore()
    eventBus = createEventBus()
    emittedEvents = []

    // 모든 이벤트를 가로채서 기록
    const originalEmit = eventBus.emit.bind(eventBus)
    eventBus.emit = (event) => {
      emittedEvents.push({ type: event.type, payload: (event as { payload: unknown }).payload })
      originalEmit(event)
    }
  })

  function createService(operators: Map<string, TransferOperator>) {
    service = new TransferLifecycleService(store, operators, eventBus)
  }

  function makeMockOperator(overrides?: Partial<TransferOperator>): TransferOperator {
    return {
      protocol: 'mock',
      prepare: vi.fn().mockResolvedValue(
        createPendingTransfer({
          id: 'transfer-1',
          txId: 'tx-1',
          direction: 'outgoing',
          finality: 'immediate',
          onExpiry: 'fail',
          transportRef: { protocol: 'mock' },
          now: Date.now(),
        }),
      ),
      execute: vi.fn().mockImplementation((transfer: PendingTransfer) =>
        Promise.resolve(transitionPhase(transfer, 'submitted', Date.now())),
      ),
      poll: vi.fn().mockResolvedValue('settled' as TransferPhase),
      reclaim: vi.fn().mockResolvedValue(undefined),
      processIncoming: vi.fn().mockImplementation((transfer: PendingTransfer) =>
        Promise.resolve(transitionPhase(transfer, 'awaiting_confirmation', Date.now())),
      ),
      ...overrides,
    }
  }

  // ─── initiateTransfer ───

  describe('initiateTransfer', () => {
    it('prepare → store.create → execute → store.update 순서대로 진행', async () => {
      const mockOp = makeMockOperator()
      createService(new Map([['mock', mockOp]]))

      const intent: TransferIntent = {
        txId: 'tx-1',
        accountId: 'mint-1',
        amount: amount(1000, 'sat'),
      }

      const result = await service.initiateTransfer(intent, 'mock')

      expect(mockOp.prepare).toHaveBeenCalledWith(intent)
      expect(mockOp.execute).toHaveBeenCalled()
      expect(store.size()).toBe(1)
      expect(result.phase).toBe('submitted')

      // 이벤트 검증
      const submittedEvent = emittedEvents.find((e) => e.type === 'transfer:submitted')
      expect(submittedEvent).toBeDefined()
    })

    it('execute 실패 시 failed로 전이', async () => {
      const mockOp = makeMockOperator({
        execute: vi.fn().mockRejectedValue(new Error('network error')),
      })
      createService(new Map([['mock', mockOp]]))

      const result = await service.initiateTransfer(
        { txId: 'tx-1', accountId: 'mint-1', amount: amount(1000, 'sat') },
        'mock',
      )

      expect(result.phase).toBe('failed')
      const failedEvent = emittedEvents.find((e) => e.type === 'transfer:failed')
      expect(failedEvent).toBeDefined()
    })

    it('알 수 없는 프로토콜이면 에러', async () => {
      createService(new Map())

      await expect(
        service.initiateTransfer(
          { txId: 'tx-1', accountId: 'mint-1', amount: amount(1000, 'sat') },
          'unknown',
        ),
      ).rejects.toThrow('Unknown protocol')
    })
  })

  // ─── pollPendingTransfers ───

  describe('pollPendingTransfers', () => {
    it('phase 변경 시 store 업데이트 + 이벤트 발행', async () => {
      const mockOp = makeMockOperator({
        poll: vi.fn().mockResolvedValue('settled'),
      })
      createService(new Map([['mock', mockOp]]))

      const transfer = createPendingTransfer({
        id: 't1',
        txId: 'tx-1',
        direction: 'outgoing',
        finality: 'immediate',
        onExpiry: 'fail',
        transportRef: { protocol: 'mock' },
        now: Date.now(),
      })
      await store.create(transitionPhase(transfer, 'in_transit', Date.now()))

      await service.pollPendingTransfers()

      const updated = await store.get('t1')
      expect(updated?.phase).toBe('settled')

      const phaseEvent = emittedEvents.find((e) => e.type === 'transfer:phase-changed')
      expect(phaseEvent).toBeDefined()
      expect(phaseEvent?.payload).toMatchObject({ previousPhase: 'in_transit' })
    })

    it('settled/failed면 finalizeTransfer 호출 (정리 이벤트)', async () => {
      const mockOp = makeMockOperator({
        poll: vi.fn().mockResolvedValue('settled'),
      })
      createService(new Map([['mock', mockOp]]))

      const transfer = createPendingTransfer({
        id: 't1',
        txId: 'tx-1',
        direction: 'outgoing',
        finality: 'immediate',
        onExpiry: 'fail',
        transportRef: { protocol: 'mock' },
        now: Date.now(),
      })
      await store.create(transitionPhase(transfer, 'in_transit', Date.now()))

      await service.pollPendingTransfers()

      const settledEvent = emittedEvents.find((e) => e.type === 'transfer:settled')
      expect(settledEvent).toBeDefined()
    })

    it('operator를 찾을 수 없으면 skip', async () => {
      createService(new Map())

      const transfer = createPendingTransfer({
        id: 't1',
        txId: 'tx-1',
        direction: 'outgoing',
        finality: 'immediate',
        onExpiry: 'fail',
        transportRef: { protocol: 'unknown' },
        now: Date.now(),
      })
      await store.create(transitionPhase(transfer, 'in_transit', Date.now()))

      await service.pollPendingTransfers()

      // 아무 변화 없음
      const unchanged = await store.get('t1')
      expect(unchanged?.phase).toBe('in_transit')
    })
  })

  // ─── reclaimTransfer ───

  describe('reclaimTransfer', () => {
    it('recoverable + onExpiry: reclaim이면 rollback 호출', async () => {
      const mockOp = makeMockOperator()
      createService(new Map([['mock', mockOp]]))

      const transfer = createPendingTransfer({
        id: 't1',
        txId: 'tx-1',
        direction: 'outgoing',
        finality: 'deferred',
        onExpiry: 'reclaim',
        expiresAt: Date.now() - 1000,
        transportRef: { protocol: 'mock' },
        now: Date.now(),
      })
      await store.create(transitionPhase(transfer, 'recoverable', Date.now()))

      await service.reclaimTransfer('t1')

      expect(mockOp.reclaim).toHaveBeenCalled()
      const updated = await store.get('t1')
      expect(updated?.phase).toBe('settled')

      const reclaimedEvent = emittedEvents.find((e) => e.type === 'transfer:reclaimed')
      expect(reclaimedEvent).toBeDefined()
    })

    it('settled이면 Cannot reclaim 에러', async () => {
      createService(new Map())

      const transfer = createPendingTransfer({
        id: 't1',
        txId: 'tx-1',
        direction: 'outgoing',
        finality: 'immediate',
        onExpiry: 'fail',
        transportRef: {},
        now: Date.now(),
      })
      await store.create(transitionPhase(transfer, 'settled', Date.now()))

      await expect(service.reclaimTransfer('t1')).rejects.toThrow('Cannot reclaim')
    })

    it('operator에 reclaim이 없으면 에러', async () => {
      const mockOp = makeMockOperator({ reclaim: undefined })
      createService(new Map([['mock', mockOp]]))

      const transfer = createPendingTransfer({
        id: 't1',
        txId: 'tx-1',
        direction: 'outgoing',
        finality: 'deferred',
        onExpiry: 'reclaim',
        expiresAt: Date.now() - 1000,
        transportRef: { protocol: 'mock' },
        now: Date.now(),
      })
      await store.create(transitionPhase(transfer, 'recoverable', Date.now()))

      await expect(service.reclaimTransfer('t1')).rejects.toThrow('Reclaim not supported')
    })
  })

  // ─── processIncomingTransfer ───

  describe('processIncomingTransfer', () => {
    it('incoming transfer를 operator.processIncoming로 위임', async () => {
      const mockOp = makeMockOperator()
      createService(new Map([['mock', mockOp]]))

      const transfer = createPendingTransfer({
        id: 't1',
        txId: 'tx-1',
        direction: 'incoming',
        finality: 'deferred',
        onExpiry: 'expire',
        transportRef: { protocol: 'mock' },
        now: Date.now(),
      })
      await store.create(transitionPhase(transfer, 'submitted', Date.now()))

      await service.processIncomingTransfer('t1')

      expect(mockOp.processIncoming).toHaveBeenCalled()
      const updated = await store.get('t1')
      expect(updated?.phase).toBe('awaiting_confirmation')
    })

    it('direction이 incoming이 아니면 skip', async () => {
      const mockOp = makeMockOperator()
      createService(new Map([['mock', mockOp]]))

      const transfer = createPendingTransfer({
        id: 't1',
        txId: 'tx-1',
        direction: 'outgoing',
        finality: 'immediate',
        onExpiry: 'fail',
        transportRef: { protocol: 'mock' },
        now: Date.now(),
      })
      await store.create(transitionPhase(transfer, 'submitted', Date.now()))

      await service.processIncomingTransfer('t1')

      expect(mockOp.processIncoming).not.toHaveBeenCalled()
    })
  })

  // ─── recoverTransfers ───

  describe('recoverTransfers', () => {
    it('active transfer마다 needs-polling 이벤트 발행', async () => {
      createService(new Map())

      const t1 = createPendingTransfer({
        id: 't1',
        txId: 'tx-1',
        direction: 'outgoing',
        finality: 'immediate',
        onExpiry: 'fail',
        transportRef: {},
        now: Date.now(),
      })
      await store.create(transitionPhase(t1, 'in_transit', Date.now()))

      const t2 = createPendingTransfer({
        id: 't2',
        txId: 'tx-2',
        direction: 'outgoing',
        finality: 'deferred',
        onExpiry: 'reclaim',
        transportRef: {},
        now: Date.now(),
      })
      await store.create(transitionPhase(t2, 'awaiting_confirmation', Date.now()))

      await service.recoverTransfers()

      const needsPolling = emittedEvents.filter((e) => e.type === 'transfer:needs-polling')
      expect(needsPolling).toHaveLength(2)
    })
  })
})
