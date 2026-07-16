/**
 * TransferLifecycleService — unit tests
 *
 * Verifies the full state machine with a mock Store, mock Operator, and spy EventBus.
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

    // Intercept and record every emitted event
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
    it('runs prepare → store.create → execute → store.update in order', async () => {
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

      const submittedEvent = emittedEvents.find((e) => e.type === 'transfer:submitted')
      expect(submittedEvent).toBeDefined()
    })

    it('transitions to failed when execute fails', async () => {
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

    it('errors on an unknown protocol', async () => {
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
    it('updates store and emits event on phase change', async () => {
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

    it('calls finalizeTransfer on settled/failed (cleanup event)', async () => {
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

    it('skips when operator is not found', async () => {
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

      const unchanged = await store.get('t1')
      expect(unchanged?.phase).toBe('in_transit')
    })
  })

  // ─── reclaimTransfer ───

  describe('reclaimTransfer', () => {
    it('calls rollback for recoverable + onExpiry: reclaim', async () => {
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

    it('errors with Cannot reclaim when settled', async () => {
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

    it('errors when the operator has no reclaim', async () => {
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
    it('delegates an incoming transfer to operator.processIncoming', async () => {
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

    it('skips when direction is not incoming', async () => {
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

    it('errors on a protocol without prepareReceive support', async () => {
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

    it('errors when not awaiting_confirmation', async () => {
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

    it('errors when claimReceive is unsupported', async () => {
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
    it('emits a needs-polling event for each active transfer', async () => {
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

    it('preparing incoming transitions to submitted then needs-polling', async () => {
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

      // Now submitted, so needs-polling is also emitted
      const needsPolling = emittedEvents.filter((e) => e.type === 'transfer:needs-polling')
      expect(needsPolling).toHaveLength(1)
    })

    it('preparing outgoing transitions to failed', async () => {
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

      // preparing isn't active, so no needs-polling
      const needsPolling = emittedEvents.filter((e) => e.type === 'transfer:needs-polling')
      expect(needsPolling).toHaveLength(0)
    })
  })

  // ─── 120s stuck-sweep ───

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

    it('applies a local transition without any remote confirm (first-pass local decision)', async () => {
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

    it('confirms a stuck transfer once and settles it (matrix path + counter)', async () => {
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

    it('unchanged confirm (user waiting — UNPAID/unredeemed) is not counted (§12 gate)', async () => {
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

    it('expiry-driven transition (recoverable) transitions but is not counted — lifecycle event', async () => {
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

    it('non-terminal advance (PAID observation) is also counted — the only observable form of a receive push miss (re-verification MAJOR)', async () => {
      // checkPayment returns a pre-finalize PAID observation, so a push miss on a device
      // whose receive watcher died shows up only as submitted→awaiting (non-terminal) —
      // counting only terminal transitions would let the gate falsely pass.
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

    it('terminal transition near expiry (within 30s skew margin) is treated as a lifecycle event — not counted', async () => {
      const operator = makeMockOperator({
        pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
        confirmStuck: vi.fn().mockResolvedValue('failed' as TransferPhase),
      })
      createSweepService(new Map([['mock', operator]]))
      // Window where the mint returns EXPIRED a few seconds before local expiry
      await store.create(seedTransfer({ ...STUCK_AGE, expiresAt: Date.now() + 10_000 }))

      await service.runStuckSweepOnce()

      expect((await store.get('sweep-1'))?.phase).toBe('failed')
      expect(counters.stuckDetected).not.toHaveBeenCalled()
    })

    it('null confirm (no remote-confirm concept) is not counted as stuck — prevents §12 gate pollution', async () => {
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

      // A failed confirm isn't evidence of a push miss — no count, no transition, sweep continues
      expect(counters.stuckDetected).toHaveBeenCalledTimes(1) // only 'ok' had a terminal transition
      expect((await store.get('boom'))?.phase).toBe('in_transit')
      expect((await store.get('ok'))?.phase).toBe('settled')
    })

    it('freeze-recovery catch-up tick (gap > 2×period) is rescue-only (uncounted)', async () => {
      vi.useFakeTimers()
      try {
        const operator = makeMockOperator({
          pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
          confirmStuck: vi.fn().mockResolvedValue('settled' as TransferPhase),
        })
        createSweepService(new Map([['mock', operator]]))
        // young at the initial immediate tick — not a rescue target
        await store.create(seedTransfer({ updatedAt: Date.now() - 1_000 }))

        service.startStuckSweep(120_000)
        await vi.advanceTimersByTimeAsync(0)

        // Simulate freeze: timers paused while the clock jumps 10 min → next tick is catch-up
        vi.setSystemTime(Date.now() + 600_000)
        await vi.advanceTimersByTimeAsync(120_000)

        // Rescues (recovers the settlement) but does not count
        expect((await store.get('sweep-1'))?.phase).toBe('settled')
        expect(counters.stuckDetected).not.toHaveBeenCalled()
        service.stopStuckSweep()
      } finally {
        vi.useRealTimers()
      }
    })

    it('immediate first run of startStuckSweep is rescue-only (uncounted) — prevents resume-race pollution', async () => {
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

        // Rescues (transitions) but doesn't touch the counters
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
        expect(listSpy).toHaveBeenCalledTimes(1) // immediate tick — empty, so the timer stops itself

        await vi.advanceTimersByTimeAsync(360_000)
        expect(listSpy).toHaveBeenCalledTimes(1) // confirms stopped — no periodic firing

        await store.create(seedTransfer(FRESH_AGE))
        service.ensureSweepScheduled() // signals transfer creation
        await vi.advanceTimersByTimeAsync(120_000)
        expect(listSpy).toHaveBeenCalledTimes(2) // resumed

        service.stopStuckSweep()
        await vi.advanceTimersByTimeAsync(360_000)
        expect(listSpy).toHaveBeenCalledTimes(2) // no firing after stop

        service.ensureSweepScheduled()
        await vi.advanceTimersByTimeAsync(360_000)
        expect(listSpy).toHaveBeenCalledTimes(2) // sweep mode off (legacy ks path) — ensure is a no-op
      } finally {
        vi.useRealTimers()
      }
    })

    it('initiateTransfer restarts a self-stopped sweep (creation-path ensure)', async () => {
      vi.useFakeTimers()
      try {
        const operator = makeMockOperator({
          pollLocal: vi.fn().mockImplementation(async (t: PendingTransfer) => t.phase),
        })
        createSweepService(new Map([['mock', operator]]))
        const listSpy = vi.spyOn(store, 'listActive')

        service.startStuckSweep(120_000)
        await vi.advanceTimersByTimeAsync(0) // empty, so it stops

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
