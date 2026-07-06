/**
 * TransferLifecycleService — 프로토콜 중립적인 전송 상태 관리 서비스
 *
 * 보내기/받기, Bolt11/Ecash/미래 프로토콜 모두 동일한 상태 머신으로 추적.
 * Adapter에게 실행을 위임하고, 상태만 관리한다.
 */

import type { PendingTransfer, TransferPhase } from '@/core/domain/pending-transfer'
import { isTerminal, isExpired, canReclaim, canComplete, transitionPhase } from '@/core/domain/pending-transfer'
import { AdapterNotFoundError } from '@/core/errors/payment.errors'
import { TransferStateError } from '@/core/errors/transfer'
import type { EventBus } from '@/core/events/event-bus'
import type { PendingTransferStore } from '@/core/ports/driven/pending-transfer-store.port'
import type { TransferIntent, TransferOperator } from '@/core/ports/driven/transfer-operator.port'
import type { OperationMap } from '@/core/ports/driven/operation-map.port'

/** stuck 판정 기준 — 마지막 전이로부터 이 시간이 지나면 원격 확인 1회 (설계 §7.2) */
const STUCK_THRESHOLD_MS = 120_000

/**
 * 만료 임박 여유 — 민트가 로컬 expiresAt보다 수 초 먼저 EXPIRED를 반환하는
 * 클럭 스큐 창에서, 만료 기인 터미널 전이가 push 미스로 오계수되는 것을 방지
 * (5단계 재검증 잔여 #2).
 */
const EXPIRY_SKEW_MARGIN_MS = 30_000

export class TransferLifecycleService {
  private pollTimer: ReturnType<typeof setInterval> | null = null

  // ─── stuck-sweep 상태 (설계 §7.2 — ks.tls-sweep OFF 신경로) ───
  private sweepTimer: ReturnType<typeof setInterval> | null = null
  private sweepIntervalMs = 120_000
  /** startStuckSweep 이후 true — pause/dispose의 stopStuckSweep이 끈다 */
  private sweepActive = false
  /** 재진입 가드 — 느린 sweep 중 타이머 재발화 무시 */
  private sweepRunning = false
  /** 마지막 sweep 시각 — freeze 복귀 catch-up tick 판별용 (재검증 잔여 #1) */
  private lastSweepAt = 0

  constructor(
    private readonly transferStore: PendingTransferStore,
    private readonly operators: Map<string, TransferOperator>,
    private readonly eventBus: EventBus,
    private readonly operationMap?: OperationMap,
    /**
     * §12 카운터 주입 — core가 telemetry 어댑터를 직접 import하지 않기 위한
     * 경계 (giftwrap 카운터를 gateway 경계에서 계수하는 것과 같은 이유).
     */
    private readonly counters?: {
      stuckDetected(): void
      stuckConfirmedSettled(): void
    },
  ) { }

  /** Transfer 조회 */
  async getTransfer(id: string): Promise<PendingTransfer | null> {
    return this.transferStore.get(id)
  }

  /** 주기적 폴링 시작 */
  startPolling(intervalMs = 5000): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      this.pollPendingTransfers().catch((e) => {
        console.error('[TransferLifecycleService] poll error:', e)
      })
    }, intervalMs)
  }

  /** 주기적 폴링 중지 */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  // ─── 120s stuck-sweep (설계 §7.2 — 30s 일괄 폴링의 대체) ───

  /**
   * sweep 시작: 즉시 1회 실행 후 주기 타이머. 30s 일괄 폴링과의 차이 —
   * 판정은 로컬 우선이고, 원격 확인은 stuck(마지막 전이 > 120s)에 한해
   * §7.3 매트릭스로 1회만 나간다. pending 0건이면 타이머가 스스로 정지하고
   * transfer 생성/수신(ensureSweepScheduled)이 재개한다.
   */
  startStuckSweep(intervalMs = 120_000): void {
    this.sweepIntervalMs = intervalMs
    this.sweepActive = true
    // 시작/재개 직후의 즉시 1회는 **구제 전용(무계수)** — unlock/resume 직후는
    // watcher 재기동·Coco 복구와 레이스라, push가 몇 초 뒤 배달했을 정산을
    // sweep이 먼저 잡아 게이트 카운터를 오염시킨다 (5단계 리뷰 blocker ②).
    // 정상 계측은 push가 배달할 시간(≥1주기)을 가진 주기 sweep부터.
    void this.runStuckSweepOnce({ countStuck: false })
    this.scheduleSweepTimer()
  }

  stopStuckSweep(): void {
    this.sweepActive = false
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }

  /**
   * pending-0 자기 정지 상태에서의 재개 신호 — transfer 생성 경로(로컬)와
   * 크로스탭 'transfer_created' 알림(bootstrap 배선)이 호출한다 [F20-잔여].
   * sweep 모드가 아닐 때(ks.tls-sweep ON 구경로)는 no-op.
   */
  ensureSweepScheduled(): void {
    if (!this.sweepActive) return
    this.scheduleSweepTimer()
  }

  private scheduleSweepTimer(): void {
    if (this.sweepTimer) return
    this.sweepTimer = setInterval(() => {
      // visibilitychange 없이 얼었다 깨어난 경우(onPause 미발화 — 모바일 freeze)
      // 해동 직후의 catch-up tick은 watcher 재기동과 레이스다 — resume 규칙과
      // 동일하게 구제 전용(무계수)으로 처리 (재검증 잔여 #1).
      const gap = Date.now() - this.lastSweepAt
      const isCatchUpAfterFreeze = this.lastSweepAt > 0 && gap > this.sweepIntervalMs * 2
      void this.runStuckSweepOnce({ countStuck: !isCatchUpAfterFreeze })
    }, this.sweepIntervalMs)
  }

  /** resume/onWake 즉시 1회 sweep용으로도 공개 (§7.2) */
  async runStuckSweepOnce(opts?: { countStuck?: boolean }): Promise<void> {
    if (this.sweepRunning) return
    this.sweepRunning = true
    this.lastSweepAt = Date.now()
    const countStuck = opts?.countStuck ?? true
    try {
      const active = await this.transferStore.listActive()
      if (active.length === 0) {
        // pending 0 → 타이머 정지 (§7.2). ensureSweepScheduled가 재개한다.
        // lastSweepAt 리셋: 유휴 후 재개의 첫 tick은 freeze catch-up이 아니다
        // (갭=유휴시간이 2×주기를 넘어 무계수로 오분류되는 것 방지 — 재검증 NIT)
        this.lastSweepAt = 0
        if (this.sweepTimer) {
          clearInterval(this.sweepTimer)
          this.sweepTimer = null
        }
        return
      }

      const now = Date.now()
      for (const transfer of active) {
        try {
          await this.sweepOne(transfer, now, countStuck)
        } catch (e) {
          // 원격 확인 실패(민트 다운 등) — 전이 없이 다음 주기에 재시도.
          // 오류를 phase로 매핑하면 진행 중 결제를 failed로 확정하는 자금 버그다.
          // 계수도 하지 않는다 — 확인 실패는 push 미스의 증거가 아니다.
          console.error('[TLS] sweep error:', transfer.id, e)
        }
      }
    } finally {
      this.sweepRunning = false
    }
  }

  private async sweepOne(
    transfer: PendingTransfer,
    now: number,
    countStuck: boolean,
  ): Promise<void> {
    const operator = this.findOperator(transfer)
    if (!operator) return

    // 1차: 로컬 판정 (네트워크 0) — push를 놓친 로컬 잔상은 여기서 즉시 회수.
    // 로컬로 보이는 전이는 계수하지 않는다(원격 확인이 필요 없었으므로).
    if (operator.pollLocal) {
      const localPhase = await operator.pollLocal(transfer)
      if (localPhase !== transfer.phase) {
        await this.applyPhaseTransition(transfer, localPhase)
        return
      }
    }

    // 2차: stuck 후보 — 마지막 전이로부터 THRESHOLD 초과분만 원격 확인
    if (now - transfer.updatedAt <= STUCK_THRESHOLD_MS) return
    if (!operator.confirmStuck) return

    // null = 이 전송타입에는 원격 확인 개념이 없음(수동 수령 대기 ecash 등).
    // 어댑터의 null 분기는 await 이전에 동기 반환하므로 네트워크 0.
    const confirmed = await operator.confirmStuck(transfer)
    if (confirmed === null || confirmed === transfer.phase) return

    // §12 게이트 계수 기준 (5단계 리뷰 blocker + 재검증 MAJOR): "원격이
    // 로컬보다 앞서 있던, 만료 기인이 아닌 전이" = 진짜 push 미스.
    // - phase 무변화(UNPAID 인보이스 대기·미상환 send 토큰)는 위에서 반환 —
    //   사용자 대기를 계수하면 게이트(=0)가 정상 사용만으로 항상 실패한다.
    // - 만료(±스큐 여유) 기인 전이는 로컬 시계 수명 이벤트 — 미계수.
    // - **터미널 제한은 두지 않는다**: bolt11 수신의 push 미스는 checkPayment가
    //   finalize 이전 관측치 PAID를 반환해 submitted→awaiting(비터미널)으로만
    //   나타난다 — 터미널만 계수하면 수신 watcher가 죽은 기기가 게이트를
    //   거짓 통과한다(재검증 MAJOR). 이 규칙에서 비터미널 계수는 정확히
    //   그 경우(PAID 관측)뿐이다.
    const remoteMiss = !isExpired(transfer, now + EXPIRY_SKEW_MARGIN_MS)
    if (countStuck && remoteMiss) {
      this.counters?.stuckDetected()
      if (confirmed === 'settled') {
        this.counters?.stuckConfirmedSettled()
      }
    }
    await this.applyPhaseTransition(transfer, confirmed)
  }

  // ─── 보내기 (Outgoing) ───

  async initiateTransfer(
    intent: TransferIntent,
    protocol: string,
  ): Promise<PendingTransfer> {
    const operator = this.operators.get(protocol)
    if (!operator) throw new AdapterNotFoundError(`Unknown protocol: ${protocol}`)

    // 1. 준비
    let transfer = await operator.prepare(intent)
    await this.transferStore.create(transfer)

    // 2. 실행 (실패해도 store에는 남김)
    try {
      transfer = await operator.execute(transfer)
      await this.transferStore.update(transfer.id, transfer)
    } catch (error) {
      const failed = transitionPhase(
        transfer,
        'failed',
        Date.now(),
      )
      await this.transferStore.update(failed.id, failed)
      this.eventBus.emit({
        type: 'transfer:failed',
        payload: { transfer: failed, reason: String(error) },
      })
      return failed
    }

    // 3. 이벤트 발행
    this.eventBus.emit({
      type: 'transfer:submitted',
      payload: { transfer },
    })

    // pending-0으로 정지한 sweep 재개 (§7.2)
    this.ensureSweepScheduled()

    return transfer
  }

  // ─── 받기 (Incoming) 처리 ───

  async initiateIncomingTransfer(
    intent: TransferIntent,
    protocol: string,
  ): Promise<PendingTransfer> {
    const operator = this.operators.get(protocol)
    if (!operator) throw new AdapterNotFoundError(`Unknown protocol: ${protocol}`)
    if (!operator.prepareReceive) {
      throw new AdapterNotFoundError(`Protocol ${protocol} does not support incoming transfers`)
    }

    const prepared = await operator.prepareReceive(intent)

    // OperationMap에 quoteId → txId 등록 (mint-quote-observer가 동일 TX를 settle하도록)
    const quoteId = (prepared.transportRef as { quoteId?: string })?.quoteId
    if (quoteId && this.operationMap) {
      this.operationMap.register(quoteId, intent.txId)
    }

    // Incoming: quote/invoice 생성이 곧 제출(submission)이다
    const transfer = transitionPhase(prepared, 'submitted', Date.now())
    await this.transferStore.create(transfer)

    this.eventBus.emit({
      type: 'transfer:submitted',
      payload: { transfer },
    })

    this.ensureSweepScheduled()

    return transfer
  }

  async processIncomingTransfer(transferId: string): Promise<void> {
    console.log('[TLS] processIncomingTransfer called:', transferId)
    const transfer = await this.transferStore.get(transferId)
    console.log('[TLS] Got transfer:', transfer?.id, 'direction:', transfer?.direction)
    if (!transfer || transfer.direction !== 'incoming') {
      console.log('[TLS] Early return: no transfer or wrong direction')
      return
    }
    // 중복 incoming:received 가 정산 완료 transfer 를 재-redeem 시도(→TOKEN_SPENT
    // →catch 가 failed 강등)하던 경로 차단 (전이 가드 리뷰 이월 ②)
    if (isTerminal(transfer.phase)) {
      console.log('[TLS] Early return: transfer already terminal:', transfer.phase)
      return
    }

    const operator = this.findOperator(transfer)
    console.log('[TLS] Found operator:', operator?.protocol)
    if (!operator?.processIncoming) {
      console.log('[TLS] Early return: no operator or processIncoming')
      return
    }

    try {
      console.log('[TLS] Calling operator.processIncoming...')
      const processed = await operator.processIncoming(transfer)
      console.log('[TLS] processIncoming result phase:', processed.phase)
      await this.transferStore.update(processed.id, processed)

      this.eventBus.emit({
        type: 'incoming:processed',
        payload: { transfer: processed },
      })

      if (isTerminal(processed.phase)) {
        await this.finalizeTransfer(processed)
      }
    } catch (error) {
      console.error('[TLS] processIncomingTransfer error:', error)
      // 에러 발생 시 failed 상태로 전환
      const failed = transitionPhase(transfer, 'failed', Date.now())
      await this.transferStore.update(failed.id, failed)

      this.eventBus.emit({
        type: 'transfer:failed',
        payload: { transfer: failed, reason: String(error) },
      })

      throw error // 호출자에게 에러 전파
    }
  }

  /** 외부에서 생성한 PendingTransfer를 store에 등록 */
  async registerTransfer(transfer: PendingTransfer): Promise<void> {
    await this.transferStore.create(transfer)
    this.ensureSweepScheduled()
  }

  /** 사용자가 "받기" 클릭 */
  async claimIncomingTransfer(transferId: string): Promise<void> {
    const transfer = await this.transferStore.get(transferId)
    if (!transfer || transfer.direction !== 'incoming') {
      throw new TransferStateError('Not an incoming transfer')
    }
    if (!canComplete(transfer)) {
      throw new TransferStateError('Transfer is not ready to be completed')
    }

    const operator = this.findOperator(transfer)
    if (!operator?.claimReceive) {
      throw new AdapterNotFoundError('Cannot claim this transfer')
    }

    const settled = await operator.claimReceive(transfer)
    await this.transferStore.update(settled.id, settled)

    this.eventBus.emit({
      type: 'transfer:settled',
      payload: { transfer: settled },
    })
  }

  /** SDK 이벤트로 transfer를 완료 상태로 전환 (settled/failed) */
  async resolveTransfer(
    transferId: string,
    phase: 'settled' | 'failed',
  ): Promise<boolean> {
    const transfer = await this.transferStore.get(transferId)
    if (!transfer || isTerminal(transfer.phase)) return false

    const previousPhase = transfer.phase
    const updated = transitionPhase(transfer, phase, Date.now())
    await this.transferStore.update(updated.id, updated)

    this.eventBus.emit({
      type: 'transfer:phase-changed',
      payload: { transfer: updated, previousPhase },
    })

    await this.finalizeTransfer(updated)
    return true
  }

  /** operationRef(quoteId/operationId)로 active transfer 찾아서 resolve */
  async resolveByOperationRef(
    operationRef: string,
    phase: 'settled' | 'failed',
  ): Promise<boolean> {
    const active = await this.transferStore.listActive()
    const transfer = active.find((t) => {
      const ref = t.transportRef as Record<string, unknown>
      return ref?.quoteId === operationRef || ref?.operationId === operationRef
    })
    if (!transfer) return false
    return this.resolveTransfer(transfer.id, phase)
  }

  // ─── 폴링 (주기적 실행) ───

  async pollPendingTransfers(): Promise<void> {
    const pending = await this.transferStore.listActive()

    for (const transfer of pending) {
      const operator = this.findOperator(transfer)
      if (!operator) continue

      const newPhase = await operator.poll(transfer)

      if (newPhase !== transfer.phase) {
        await this.applyPhaseTransition(transfer, newPhase)
      }
    }
  }

  /** 폴링/sweep 공용 — 전이 저장 + phase-changed 발행 + 종단 정리 */
  private async applyPhaseTransition(
    transfer: PendingTransfer,
    newPhase: TransferPhase,
  ): Promise<void> {
    // TOCTOU 봉인 (전이 가드 리뷰 이월 ①): poll/confirm 의 네트워크 await 동안
    // SDK push 가 store 를 이미 settle 했을 수 있다 — stale 객체로 전이하면
    // 정산 기록을 덮어쓴다. fresh 재조회로 도메인 가드가 실전 레이스를 본다.
    const fresh = await this.transferStore.get(transfer.id)
    if (!fresh) return // remove-mint 경합 등으로 삭제됨 — 없는 row 에 update 를 때리지 않는다
    if (fresh.phase === newPhase) return // 경합 상대가 이미 같은 전이를 완료
    if (fresh.phase === 'settled' && newPhase !== 'settled') {
      // push 가 먼저 정산 — 우리의 poll 결과는 늦은 소식일 뿐, 버그가 아니다
      console.warn(`[TLS] Skipping stale transition settled → ${newPhase} (${fresh.id})`)
      return
    }
    const previousPhase = fresh.phase
    const updated = transitionPhase(fresh, newPhase, Date.now())
    await this.transferStore.update(updated.id, updated)

    this.eventBus.emit({
      type: 'transfer:phase-changed',
      payload: { transfer: updated, previousPhase },
    })

    if (isTerminal(newPhase)) {
      await this.finalizeTransfer(updated)
    }
  }

  // ─── 회수 ───

  async reclaimTransfer(transferId: string): Promise<void> {
    const transfer = await this.transferStore.get(transferId)
    if (!transfer || !canReclaim(transfer)) {
      throw new TransferStateError('Cannot reclaim this transfer')
    }

    const operator = this.findOperator(transfer)
    if (!operator?.reclaim) {
      throw new AdapterNotFoundError('Reclaim not supported for this protocol')
    }

    await operator.reclaim(transfer)

    const updated = transitionPhase(transfer, 'settled', Date.now())
    await this.transferStore.update(updated.id, updated)

    this.eventBus.emit({
      type: 'transfer:reclaimed',
      payload: { transfer: updated },
    })
  }

  // ─── 복구 (앱 재시작 시) ───

  async recoverTransfers(): Promise<void> {
    // 1. 'preparing'에 갇힌 transfer 정리 (앱 crash 시)
    const stuckPreparing = await this.transferStore.listByPhase(['preparing'])
    for (const transfer of stuckPreparing) {
      if (transfer.direction === 'incoming') {
        // incoming은 quote가 이미 mint에 존재 → submitted로 전이
        const updated = transitionPhase(transfer, 'submitted', Date.now())
        await this.transferStore.update(updated.id, updated)
        this.eventBus.emit({
          type: 'transfer:phase-changed',
          payload: { transfer: updated, previousPhase: 'preparing' },
        })
      } else {
        // outgoing: execute 중 crash → 실행 여부를 알 수 없으므로 failed
        const failed = transitionPhase(transfer, 'failed', Date.now())
        await this.transferStore.update(failed.id, failed)
        this.eventBus.emit({
          type: 'transfer:failed',
          payload: { transfer: failed, reason: 'app-crashed-during-execution' },
        })
      }
    }

    // 2. active transfer들은 needs-polling 이벤트 발행
    const active = await this.transferStore.listActive()
    for (const transfer of active) {
      this.eventBus.emit({
        type: 'transfer:needs-polling',
        payload: { transfer },
      })
    }
  }

  // ─── Private helpers ───

  private findOperator(transfer: PendingTransfer): TransferOperator | undefined {
    const ref = transfer.transportRef as { type?: string; protocol?: string }
    const key = ref.protocol || ref.type?.split('-')[0]
    //console.log('[TLS] findOperator: type=', ref.type, 'protocol=', ref.protocol, 'key=', key)
    //console.log('[TLS] Available operators:', Array.from(this.operators.keys()))
    return key ? this.operators.get(key) : undefined
  }

  private async finalizeTransfer(transfer: PendingTransfer): Promise<void> {
    if (transfer.phase === 'settled') {
      this.eventBus.emit({
        type: 'transfer:settled',
        payload: { transfer },
      })
    } else if (transfer.phase === 'failed') {
      this.eventBus.emit({
        type: 'transfer:failed',
        payload: { transfer, reason: 'terminal-failure' },
      })
    }
  }
}
