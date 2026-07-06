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
import { InMemoryPendingTransferStore } from '../../../helpers/transfer-lifecycle.mock-store'
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
      prepareReceive: vi.fn().mockResolvedValue(
        createPendingTransfer({
          id: 'incoming-1',
          txId: 'tx-in-1',
          direction: 'incoming',
          finality: 'deferred',
          onExpiry: 'expire',
          transportRef: { protocol: 'mock', request: 'lnbc1...' },
          now: Date.now(),
        }),
      ),
      claimReceive: vi.fn().mockImplementation((transfer: PendingTransfer) =>
        Promise.resolve(transitionPhase(transfer, 'settled', Date.now())),
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

  // ─── initiateIncomingTransfer ───

  describe('initiateIncomingTransfer', () => {
    it('prepareReceive → store.create → transfer:submitted', async () => {
      const mockOp = makeMockOperator()
      createService(new Map([['mock', mockOp]]))

      const intent: TransferIntent = {
        txId: 'tx-in-1',
        accountId: 'mint-1',
        amount: amount(1000, 'sat'),
      }

      const result = await service.initiateIncomingTransfer(intent, 'mock')

      expect(mockOp.prepareReceive).toHaveBeenCalledWith(intent)
      expect(store.size()).toBe(1)
      expect(result.direction).toBe('incoming')
      expect(result.phase).toBe('submitted')

      const submittedEvent = emittedEvents.find((e) => e.type === 'transfer:submitted')
      expect(submittedEvent).toBeDefined()
    })

    it('prepareReceive 미지원 프로토콜이면 에러', async () => {
      const mockOp = makeMockOperator({ prepareReceive: undefined })
      createService(new Map([['mock', mockOp]]))

      await expect(
        service.initiateIncomingTransfer(
          { txId: 'tx-in-1', accountId: 'mint-1', amount: amount(1000, 'sat') },
          'mock',
        ),
      ).rejects.toThrow('does not support incoming')
    })
  })

  // ─── claimIncomingTransfer ───

  describe('claimIncomingTransfer', () => {
    it('awaiting_confirmation → claimReceive → settled', async () => {
      const mockOp = makeMockOperator()
      createService(new Map([['mock', mockOp]]))

      const transfer = createPendingTransfer({
        id: 't-in-1',
        txId: 'tx-in-1',
        direction: 'incoming',
        finality: 'deferred',
        onExpiry: 'expire',
        transportRef: { protocol: 'mock' },
        now: Date.now(),
      })
      await store.create(transitionPhase(transfer, 'awaiting_confirmation', Date.now()))

      await service.claimIncomingTransfer('t-in-1')

      expect(mockOp.claimReceive).toHaveBeenCalled()
      const updated = await store.get('t-in-1')
      expect(updated?.phase).toBe('settled')

      const settledEvent = emittedEvents.find((e) => e.type === 'transfer:settled')
      expect(settledEvent).toBeDefined()
    })

    it('awaiting_confirmation이 아니면 에러', async () => {
      const mockOp = makeMockOperator()
      createService(new Map([['mock', mockOp]]))

      const transfer = createPendingTransfer({
        id: 't-in-1',
        txId: 'tx-in-1',
        direction: 'incoming',
        finality: 'deferred',
        onExpiry: 'expire',
        transportRef: { protocol: 'mock' },
        now: Date.now(),
      })
      await store.create(transitionPhase(transfer, 'submitted', Date.now()))

      await expect(service.claimIncomingTransfer('t-in-1')).rejects.toThrow(
        'not ready to be completed',
      )
    })

    it('claimReceive 미지원이면 에러', async () => {
      const mockOp = makeMockOperator({ claimReceive: undefined })
      createService(new Map([['mock', mockOp]]))

      const transfer = createPendingTransfer({
        id: 't-in-1',
        txId: 'tx-in-1',
        direction: 'incoming',
        finality: 'deferred',
        onExpiry: 'expire',
        transportRef: { protocol: 'mock' },
        now: Date.now(),
      })
      await store.create(transitionPhase(transfer, 'awaiting_confirmation', Date.now()))

      await expect(service.claimIncomingTransfer('t-in-1')).rejects.toThrow(
        'Cannot claim this transfer',
      )
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

    it('preparing incoming은 submitted로 전이 후 needs-polling', async () => {
      createService(new Map())

      const t1 = createPendingTransfer({
        id: 't1',
        txId: 'tx-1',
        direction: 'incoming',
        finality: 'deferred',
        onExpiry: 'expire',
        transportRef: { protocol: 'mock' },
        now: Date.now(),
      })
      await store.create(t1) // phase: preparing

      await service.recoverTransfers()

      const updated = await store.get('t1')
      expect(updated?.phase).toBe('submitted')

      const phaseChanged = emittedEvents.find((e) => e.type === 'transfer:phase-changed')
      expect(phaseChanged).toBeDefined()

      // submitted가 되었으므로 needs-polling도 발행
      const needsPolling = emittedEvents.filter((e) => e.type === 'transfer:needs-polling')
      expect(needsPolling).toHaveLength(1)
    })

    it('preparing outgoing은 failed로 전이', async () => {
      createService(new Map())

      const t1 = createPendingTransfer({
        id: 't1',
        txId: 'tx-1',
        direction: 'outgoing',
        finality: 'immediate',
        onExpiry: 'fail',
        transportRef: { protocol: 'mock' },
        now: Date.now(),
      })
      await store.create(t1) // phase: preparing

      await service.recoverTransfers()

      const updated = await store.get('t1')
      expect(updated?.phase).toBe('failed')

      const failedEvent = emittedEvents.find((e) => e.type === 'transfer:failed')
      expect(failedEvent).toBeDefined()

      // preparing은 active가 아니므로 needs-polling은 없음
      const needsPolling = emittedEvents.filter((e) => e.type === 'transfer:needs-polling')
      expect(needsPolling).toHaveLength(0)
    })
  })

  // ─── 120s stuck-sweep (설계 §7.2/§7.3) ───

  describe('stuck-sweep', () => {
    let counters: { stuckDetected: () => void; stuckConfirmedSettled: () => void }

    function createSweepService(operators: Map<string, TransferOperator>) {
      counters = { stuckDetected: vi.fn(), stuckConfirmedSettled: vi.fn() }
      service = new TransferLifecycleService(store, operators, eventBus, undefined, counters)
    }

    function seedTransfer(overrides: Partial<PendingTransfer> = {}): PendingTransfer {
      const base = createPendingTransfer({
        id: 'sweep-1',
        txId: 'tx-sweep-1',
        direction: 'outgoing',
        finality: 'immediate',
        onExpiry: 'fail',
        transportRef: { protocol: 'mock' },
        now: Date.now(),
      })
      return { ...transitionPhase(base, 'in_transit', Date.now()), ...overrides }
    }

    const STUCK_AGE = { updatedAt: Date.now() - 121_000 }
    const FRESH_AGE = { updatedAt: Date.now() - 1_000 }

    it('applies a local transition without any remote confirm (1차 로컬 판정)', async () => {
      const operator = makeMockOperator({
        pollLocal: vi.fn().mockResolvedValue('settled' as TransferPhase),
        confirmStuck: vi.fn(),
      })
      createSweepService(new Map([['mock', operator]]))
      await store.create(seedTransfer(STUCK_AGE))

      await service.runStuckSweepOnce()

      expect((await store.get('sweep-1'))?.phase).toBe('settled')
      expect(operator.confirmStuck).not.toHaveBeenCalled()
      expect(counters.stuckDetected).not.toHaveBeenCalled()
      expect(emittedEvents.some((e) => e.type === 'transfer:settled')).toBe(true)
    })

    it('does not confirm transfers younger than the stuck threshold', async () => {
      const operator = makeMockOperator({
        pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
        confirmStuck: vi.fn(),
      })
      createSweepService(new Map([['mock', operator]]))
      await store.create(seedTransfer(FRESH_AGE))

      await service.runStuckSweepOnce()

      expect(operator.pollLocal).toHaveBeenCalledTimes(1)
      expect(operator.confirmStuck).not.toHaveBeenCalled()
      expect(counters.stuckDetected).not.toHaveBeenCalled()
    })

    it('confirms a stuck transfer once and settles it (매트릭스 경로 + 카운터)', async () => {
      const operator = makeMockOperator({
        pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
        confirmStuck: vi.fn().mockResolvedValue('settled' as TransferPhase),
      })
      createSweepService(new Map([['mock', operator]]))
      await store.create(seedTransfer(STUCK_AGE))

      await service.runStuckSweepOnce()

      expect(operator.confirmStuck).toHaveBeenCalledTimes(1)
      expect(counters.stuckDetected).toHaveBeenCalledTimes(1)
      expect(counters.stuckConfirmedSettled).toHaveBeenCalledTimes(1)
      expect((await store.get('sweep-1'))?.phase).toBe('settled')
    })

    it('unchanged confirm (사용자 대기 — UNPAID/미상환)은 계수하지 않는다 (§12 게이트)', async () => {
      const operator = makeMockOperator({
        pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
        confirmStuck: vi.fn().mockResolvedValue('in_transit' as TransferPhase),
      })
      createSweepService(new Map([['mock', operator]]))
      await store.create(seedTransfer(STUCK_AGE))

      await service.runStuckSweepOnce()

      expect(counters.stuckDetected).not.toHaveBeenCalled()
      expect(counters.stuckConfirmedSettled).not.toHaveBeenCalled()
      expect((await store.get('sweep-1'))?.phase).toBe('in_transit')
    })

    it('expiry-driven transition (recoverable)은 전이하되 계수하지 않는다 — 수명 이벤트', async () => {
      const operator = makeMockOperator({
        pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
        confirmStuck: vi.fn().mockResolvedValue('recoverable' as TransferPhase),
      })
      createSweepService(new Map([['mock', operator]]))
      await store.create(seedTransfer({ ...STUCK_AGE, expiresAt: Date.now() - 1_000 }))

      await service.runStuckSweepOnce()

      expect((await store.get('sweep-1'))?.phase).toBe('recoverable')
      expect(counters.stuckDetected).not.toHaveBeenCalled()
    })

    it('non-terminal 전진(PAID 관측)도 계수한다 — 수신 push 미스의 유일한 관측형 (재검증 MAJOR)', async () => {
      // checkPayment는 finalize 이전 관측치 PAID를 반환하므로, 수신 watcher가
      // 죽은 기기의 push 미스는 submitted→awaiting(비터미널)으로만 나타난다 —
      // 터미널만 계수하면 게이트가 거짓 통과한다.
      const operator = makeMockOperator({
        pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
        confirmStuck: vi.fn().mockResolvedValue('awaiting_confirmation' as TransferPhase),
      })
      createSweepService(new Map([['mock', operator]]))
      await store.create(seedTransfer(STUCK_AGE))

      await service.runStuckSweepOnce()

      expect((await store.get('sweep-1'))?.phase).toBe('awaiting_confirmation')
      expect(counters.stuckDetected).toHaveBeenCalledTimes(1)
      expect(counters.stuckConfirmedSettled).not.toHaveBeenCalled()
    })

    it('만료 임박(스큐 여유 30s 내) 터미널 전이는 수명 이벤트로 취급 — 미계수', async () => {
      const operator = makeMockOperator({
        pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
        confirmStuck: vi.fn().mockResolvedValue('failed' as TransferPhase),
      })
      createSweepService(new Map([['mock', operator]]))
      // 민트가 로컬 만료보다 수 초 먼저 EXPIRED를 반환하는 창
      await store.create(seedTransfer({ ...STUCK_AGE, expiresAt: Date.now() + 10_000 }))

      await service.runStuckSweepOnce()

      expect((await store.get('sweep-1'))?.phase).toBe('failed')
      expect(counters.stuckDetected).not.toHaveBeenCalled()
    })

    it('null confirm (원격 확인 개념 없음) is not counted as stuck — §12 게이트 오염 방지', async () => {
      const operator = makeMockOperator({
        pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
        confirmStuck: vi.fn().mockResolvedValue(null),
      })
      createSweepService(new Map([['mock', operator]]))
      await store.create(seedTransfer(STUCK_AGE))

      await service.runStuckSweepOnce()

      expect(counters.stuckDetected).not.toHaveBeenCalled()
      expect((await store.get('sweep-1'))?.phase).toBe('in_transit')
    })

    it('a throwing confirm is not counted, leaves the transfer untouched, and continues the sweep', async () => {
      const operator = makeMockOperator({
        pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
        confirmStuck: vi
          .fn()
          .mockRejectedValueOnce(new Error('mint down'))
          .mockResolvedValueOnce('settled' as TransferPhase),
      })
      createSweepService(new Map([['mock', operator]]))
      await store.create(seedTransfer({ ...STUCK_AGE, id: 'boom' }))
      await store.create(seedTransfer({ ...STUCK_AGE, id: 'ok', txId: 'tx-ok' }))

      await service.runStuckSweepOnce()

      // 확인 실패는 push 미스의 증거가 아니다 — 계수 없음·무전이, 나머지 계속
      expect(counters.stuckDetected).toHaveBeenCalledTimes(1) // 'ok'의 터미널 전이만
      expect((await store.get('boom'))?.phase).toBe('in_transit')
      expect((await store.get('ok'))?.phase).toBe('settled')
    })

    it('freeze 복귀 catch-up tick(갭 > 2×주기)은 구제 전용(무계수)', async () => {
      vi.useFakeTimers()
      try {
        const operator = makeMockOperator({
          pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
          confirmStuck: vi.fn().mockResolvedValue('settled' as TransferPhase),
        })
        createSweepService(new Map([['mock', operator]]))
        // 초기 즉시 1회 시점에는 young — 구제 대상 아님
        await store.create(seedTransfer({ updatedAt: Date.now() - 1_000 }))

        service.startStuckSweep(120_000)
        await vi.advanceTimersByTimeAsync(0)

        // freeze 시뮬레이션: 타이머는 멈춘 채 시계만 10분 점프 → 다음 tick이 catch-up
        vi.setSystemTime(Date.now() + 600_000)
        await vi.advanceTimersByTimeAsync(120_000)

        // 구제(정산 회수)는 수행하되 계수는 없다
        expect((await store.get('sweep-1'))?.phase).toBe('settled')
        expect(counters.stuckDetected).not.toHaveBeenCalled()
        service.stopStuckSweep()
      } finally {
        vi.useRealTimers()
      }
    })

    it('startStuckSweep의 즉시 1회는 구제 전용(무계수) — resume 레이스 오염 방지', async () => {
      vi.useFakeTimers()
      try {
        const operator = makeMockOperator({
          pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
          confirmStuck: vi.fn().mockResolvedValue('settled' as TransferPhase),
        })
        createSweepService(new Map([['mock', operator]]))
        await store.create(seedTransfer({ updatedAt: Date.now() - 121_000 }))

        service.startStuckSweep(120_000)
        await vi.advanceTimersByTimeAsync(0)

        // 구제(전이)는 수행하되 카운터는 건드리지 않는다
        expect((await store.get('sweep-1'))?.phase).toBe('settled')
        expect(counters.stuckDetected).not.toHaveBeenCalled()
        expect(counters.stuckConfirmedSettled).not.toHaveBeenCalled()
        service.stopStuckSweep()
      } finally {
        vi.useRealTimers()
      }
    })

    it('stops its own timer at pending-0 and resumes via ensureSweepScheduled', async () => {
      vi.useFakeTimers()
      try {
        const operator = makeMockOperator({
          pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
          confirmStuck: vi.fn().mockResolvedValue(null),
        })
        createSweepService(new Map([['mock', operator]]))
        const listSpy = vi.spyOn(store, 'listActive')

        service.startStuckSweep(120_000)
        await vi.advanceTimersByTimeAsync(0)
        expect(listSpy).toHaveBeenCalledTimes(1) // 즉시 1회 — 비었으므로 타이머 자기 정지

        await vi.advanceTimersByTimeAsync(360_000)
        expect(listSpy).toHaveBeenCalledTimes(1) // 정지 확인 — 주기 발화 없음

        await store.create(seedTransfer(FRESH_AGE))
        service.ensureSweepScheduled() // transfer 생성 신호 (§7.2)
        await vi.advanceTimersByTimeAsync(120_000)
        expect(listSpy).toHaveBeenCalledTimes(2) // 재개됨

        service.stopStuckSweep()
        await vi.advanceTimersByTimeAsync(360_000)
        expect(listSpy).toHaveBeenCalledTimes(2) // 정지 후 발화 없음

        service.ensureSweepScheduled()
        await vi.advanceTimersByTimeAsync(360_000)
        expect(listSpy).toHaveBeenCalledTimes(2) // sweep 모드 꺼짐(ks 구경로) — ensure는 no-op
      } finally {
        vi.useRealTimers()
      }
    })

    it('initiateTransfer restarts a self-stopped sweep (생성 경로 ensure)', async () => {
      vi.useFakeTimers()
      try {
        const operator = makeMockOperator({
          pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
        })
        createSweepService(new Map([['mock', operator]]))
        const listSpy = vi.spyOn(store, 'listActive')

        service.startStuckSweep(120_000)
        await vi.advanceTimersByTimeAsync(0) // 비었으므로 정지

        const intent: TransferIntent = {
          txId: 'tx-new',
          accountId: 'https://mint',
          amount: amount(100, 'sat'),
        }
        await service.initiateTransfer(intent, 'mock')
        await vi.advanceTimersByTimeAsync(120_000)

        expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
