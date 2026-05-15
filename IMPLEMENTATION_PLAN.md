# 전송계층 추상화 구현 계획

## 배경

현재 (`f61dd8af660f63ca3807051d4cd9169c32b669de`) 프로젝트는 프로토콜별로 분리된 전송 상태 추적 도메인이 존재합니다:

- `Bolt11` → `pendingMelts` (Dexie 스키마)
- `Ecash 발신` → `OutgoingEcashOperation` (신규 도메인)
- `GiftWrap 수신` → `GiftWrapInbox` (신규 도메인/스토어)

이는 Hexagonal Architecture의 **Port Neutrality(R3)**를 위반하며, 새로운 프로토콜 추가 시 도메인 레이어까지 변경해야 하는 문제를 야기합니다.

## 목표

프로토콜 중립적인 `PendingTransfer` 도메인으로 통일하여:

1. **도메인 레이어 불변**: 새로운 전송 프로토콜(Nostr, HTTP, QR, Bolt12 등) 추가 시 도메인 수정 없이 Adapter만 추가
2. **상태 머신 통일**: 보내기/받기, Bolt11/Ecash/미래 프로토콜 모두 동일한 `TransferPhase` 상태 머신 사용
3. **저장소 통합**: `pendingMelts`, `outgoingEcashOperations`, `giftWrapInbox` 등 분리된 스토어를 하나의 `pendingTransfers` 테이블로 통합

---

## 1. Domain Layer 변경

### 1-1. 새 파일: `core/domain/pending-transfer.ts`

**작업**: 생성

```typescript
/**
 * 전송 추적 도메인 — 프로토콜 중립적인 비동기 전송 상태 머신.
 *
 * 보내기(Bolt11 melt, Ecash token)와 받기(GiftWrap, 인보이스 대기)를
 * 동일한 타입으로 표현한다.
 *
 * R3: Port Neutrality — 프로토콜명(ecash, nostr 등)은 절대 들어가지 않는다.
 */

export type TransferDirection = 'outgoing' | 'incoming'

export type TransferPhase =
  | 'preparing'              // 실행 준비 중 (quote 생성 등)
  | 'submitted'              // 실행 시작 (melt 요청 / 토큰 게시 / 이벤트 수신)
  | 'in_transit'             // 네트워크 처리 중
  | 'awaiting_confirmation'  // 최종 확인 대기 (preimage / claim / 수락)
  | 'settled'                // 완료
  | 'failed'                 // 실패 (복구 불가)
  | 'recoverable'            // 실패했지만 회수/재시도 가능

export type FinalityModel =
  | 'immediate'   // preimage 즉시 확인 → 최종 (Bolt11)
  | 'deferred'    // 수취인 행동까지 불확실 (Ecash)
  | 'revocable'   // 만료 전까지 발신자가 취소 가능 (Ecash)

export type ExpiryAction = 'fail' | 'reclaim' | 'expire'

export interface PendingTransfer {
  readonly id: string
  readonly txId: string
  readonly direction: TransferDirection

  readonly phase: TransferPhase
  readonly finality: FinalityModel

  readonly expiresAt?: number
  readonly onExpiry: ExpiryAction

  /** Adapter가 해석하는 프로토콜별 데이터 (domain은 opaque) */
  readonly transportRef: unknown

  readonly createdAt: number
  readonly updatedAt: number
}

// ─── Pure Functions ───

export function createPendingTransfer(params: {
  id: string
  txId: string
  direction: TransferDirection
  finality: FinalityModel
  onExpiry: ExpiryAction
  expiresAt?: number
  transportRef: unknown
  now: number
}): PendingTransfer {
  return {
    ...params,
    phase: 'preparing',
    createdAt: params.now,
    updatedAt: params.now,
  }
}

export function transitionPhase(
  transfer: PendingTransfer,
  newPhase: TransferPhase,
  now: number,
): PendingTransfer {
  return { ...transfer, phase: newPhase, updatedAt: now }
}

export function isTerminal(phase: TransferPhase): boolean {
  return phase === 'settled' || phase === 'failed'
}

export function canReclaim(
  transfer: Pick<PendingTransfer, 'phase' | 'onExpiry'>,
): boolean {
  return transfer.phase === 'recoverable' && transfer.onExpiry === 'reclaim'
}

export function isExpired(transfer: PendingTransfer, now: number = Date.now()): boolean {
  return transfer.expiresAt != null && transfer.expiresAt <= now
}
```

### 1-2. 수정: `core/domain/transaction.ts`

**작업**: `metadata`에 `transferId` 링크 추가 (선택적)

```typescript
export interface Transaction {
  // ... 기존 필드 그대로
  readonly metadata?: Record<string, unknown>
}

// getTxMeta() 함수에 추가
export function getTxMeta(tx: Transaction) {
  const m = tx.metadata ?? {}
  return {
    // ... 기존 필드
    transferId: m.transferId as string | undefined,  // ← 추가
  }
}
```

### 1-3. 삭제: `core/domain/outgoing-ecash-lifecycle.ts`

**작업**: 파일 제거

이유: Ecash-specific 상태(`OutgoingDeliveryState`, `OutgoingClaimState` 등)는 Adapter 내부로 이동. Domain은 `TransferPhase`만 알면 됨.

### 1-4. 삭제 또는 통합: `core/domain/pending-operation.ts`

**작업**: `pending-transfer.ts`로 통합 후 제거

기존 `PendingOperation`은 제네릭했지만 프로토콜명(`kind: 'melt' | 'send-token'`)이 포함되어 있었음. 새 `PendingTransfer`가 이를 대체.

---

## 2. Port Layer 변경

### 2-1. 새 파일: `core/ports/driven/pending-transfer-store.port.ts`

**작업**: 생성

```typescript
import type { PendingTransfer, TransferPhase } from '@core/domain/pending-transfer'

export interface PendingTransferStore {
  create(transfer: PendingTransfer): Promise<void>
  get(id: string): Promise<PendingTransfer | null>
  update(id: string, changes: Partial<PendingTransfer>): Promise<void>
  delete(id: string): Promise<void>

  listByPhase(phases: TransferPhase[]): Promise<PendingTransfer[]>
  listByTxId(txId: string): Promise<PendingTransfer[]>
  listExpired(before: number): Promise<PendingTransfer[]>
  listActive(): Promise<PendingTransfer[]> // phases: submitted, in_transit, awaiting_confirmation
}
```

### 2-2. 새 파일: `core/ports/driven/transfer-operator.port.ts`

**작업**: 생성

```typescript
import type { PendingTransfer, TransferPhase } from '@core/domain/pending-transfer'
import type { Amount } from '@core/domain/amount'

export interface TransferIntent {
  txId: string
  accountId: string
  amount: Amount
  recipient?: string  // npub, URL, offer 등 — adapter가 해석
  memo?: string
}

/** 메시지 전송 계층 인터페이스 — Nostr/HTTP/QR 등 어떤 구현이든 가능 */
export interface MessageTransport {
  publish(params: {
    recipient: string
    content: string
    memo?: string
  }): Promise<{ deliveryId: string }>

  /** 수신 구독 (Incoming Watcher가 사용) */
  subscribe?(handler: (event: unknown) => Promise<void>): () => void
}

export interface TransferOperator {
  /** 프로토콜 식별자 (예: 'bolt11', 'ecash', 'bolt12') */
  readonly protocol: string

  prepare(intent: TransferIntent): Promise<PendingTransfer>
  execute(transfer: PendingTransfer): Promise<PendingTransfer>
  poll(transfer: PendingTransfer): Promise<TransferPhase>

  /** reclaim 가능한 경우에만 구현 */
  reclaim?(transfer: PendingTransfer): Promise<void>

  /** incoming transfer 처리 (토큰 복호화/검증 후 상태 업데이트) */
  processIncoming?(transfer: PendingTransfer): Promise<PendingTransfer>
}
```

### 2-3. 삭제: `core/ports/driven/gift-wrap-inbox-store.port.ts`

**작업**: 제거 → `PendingTransferStore`로 통합

`GiftWrapInboxStore`는 `PendingTransferStore.listByPhase(['submitted'])` + `direction: 'incoming'`로 대체.

### 2-4. 삭제: `core/ports/driven/outgoing-ecash-operation-store.port.ts`

**작업**: 제거 → `PendingTransferStore`로 통합

### 2-5. 삭제: `core/ports/driven/outgoing-claim-state-probe.port.ts`

**작업**: 제거 → `TransferOperator.poll()`로 통합

---

## 3. Adapter Layer 변경

### 3-1. 수정: `modules/cashu/adapters/cashu-bolt11.adapter.ts`

**작업**: `TransferOperator` 구현

```typescript
import type { TransferOperator, TransferIntent } from '@core/ports/driven/transfer-operator.port'
import type { PendingTransfer, TransferPhase } from '@core/domain/pending-transfer'
import { createPendingTransfer, transitionPhase } from '@core/domain/pending-transfer'

export class CashuBolt11Adapter implements TransferOperator {
  readonly protocol = 'bolt11'

  constructor(private backend: CashuBackend) {}

  async prepare(intent: TransferIntent): Promise<PendingTransfer> {
    const op = await this.backend.prepareMelt({
      mintUrl: intent.accountId, // 또는 설정에서
      invoice: intent.recipient!,
    })

    return createPendingTransfer({
      id: generateUUID(),
      txId: intent.txId,
      direction: 'outgoing',
      finality: 'immediate',
      onExpiry: 'fail',
      expiresAt: op.expiry,
      transportRef: {
        type: 'bolt11-melt',
        quoteId: op.quoteId,
        operationId: op.operationId,
      },
      now: Date.now(),
    })
  }

  async execute(transfer: PendingTransfer): Promise<PendingTransfer> {
    const ref = transfer.transportRef as { operationId: string }
    const result = await this.backend.executeMelt(ref.operationId)

    if (result.preimage) {
      return transitionPhase(transfer, 'settled', Date.now())
    }

    return transitionPhase(transfer, 'in_transit', Date.now())
  }

  async poll(transfer: PendingTransfer): Promise<TransferPhase> {
    const ref = transfer.transportRef as { operationId: string }
    const status = await this.backend.checkMelt(ref.operationId)

    if (status.preimage) return 'settled'
    if (status.error) return 'failed'
    if (isExpired(transfer)) return 'failed'
    return 'in_transit'
  }
}
```

### 3-2. 수정: `modules/cashu/adapters/cashu-ecash.adapter.ts`

**작업**: 기존 `SendTokenOperator` → `TransferOperator`로 변경

```typescript
export class CashuEcashAdapter implements TransferOperator {
  readonly protocol = 'ecash'

  constructor(
    private backend: CashuBackend,
    private transport: MessageTransport, // Nostr/HTTP/QR — 인터페이스로 주입
  ) {}

  async prepare(intent: TransferIntent): Promise<PendingTransfer> {
    return createPendingTransfer({
      id: generateUUID(),
      txId: intent.txId,
      direction: 'outgoing',
      finality: 'deferred',
      onExpiry: 'reclaim',
      expiresAt: Date.now() + TOKEN_TTL,
      transportRef: {
        type: 'ecash-token',
        recipient: intent.recipient,
      },
      now: Date.now(),
    })
  }

  async execute(transfer: PendingTransfer): Promise<PendingTransfer> {
    // 1. 토큰 생성
    const token = await this.backend.createToken(transfer.amount)

    // 2. 전송 (Nostr/HTTP/QR 등 — transport 인터페이스로 추상화)
    const result = await this.transport.publish({
      recipient: transfer.transportRef.recipient,
      content: token,
    })

    return {
      ...transitionPhase(transfer, 'submitted', Date.now()),
      transportRef: {
        ...transfer.transportRef,
        token,
        deliveryId: result.deliveryId,
      },
    }
  }

  async poll(transfer: PendingTransfer): Promise<TransferPhase> {
    const { token } = transfer.transportRef as { token: string }
    const state = await this.backend.checkTokenState(token)

    if (state.spent) return 'settled'
    if (isExpired(transfer)) return 'recoverable'
    return 'awaiting_confirmation'
  }

  async reclaim(transfer: PendingTransfer): Promise<void> {
    const { token } = transfer.transportRef as { token: string }
    await this.backend.reclaim(token)
  }
}
```

### 3-3. 새 파일: `adapters/nostr/nostr-incoming-watcher.ts` (GiftWrap 수신)

**작업**: Nostr 구독(Subscription)으로 Incoming Transfer 발견 — **Adapter 레이어**

⚠️ **중요**: 이 Watcher는 TransferLifecycleService와 별개입니다. "발견"만 담당하고, 생성된 PendingTransfer는 TransferLifecycleService가 "관리"합니다.

```typescript
/**
 * Nostr Incoming Watcher — Adapter Layer
 *
 * 1. Nostr GiftWrap 구독 (실시간)
 * 2. 복호화
 * 3. PendingTransfer 생성 (direction='incoming')
 * 4. TransferLifecycleService에 인계
 */
export class NostrIncomingWatcher {
  constructor(
    private nostr: NostrGateway,
    private transferStore: PendingTransferStore,
    private eventBus: EventBus,
    private keyManager: KeyManager,
  ) {}

  start() {
    // Nostr 구독 — 항상 실행 중 (앱 시작 시)
    this.nostr.subscribeGiftWrap(async (encryptedEvent) => {
      try {
        // 1. 내 키로 복호화 시도
        const payload = await this.decrypt(encryptedEvent)

        if (!this.isValidPayload(payload)) {
          return // 내가 아님 또는 유효하지 않음
        }

        // 2. PendingTransfer 생성 (phase: 'submitted')
        const transfer = createPendingTransfer({
          id: generateUUID(),
          txId: 'pending', // 아직 Transaction과 연결 안 됨 (사용자 수락 후 연결)
          direction: 'incoming',
          phase: 'submitted',
          finality: 'deferred',
          onExpiry: 'expire',
          expiresAt: payload.expiry,
          transportRef: {
            type: 'nostr-giftwrap',
            eventId: encryptedEvent.id,
            sender: payload.sender,
            encryptedContent: encryptedEvent.content,
          },
          now: Date.now(),
        })

        // 3. 저장
        await this.transferStore.create(transfer)

        // 4. UI 알림
        this.eventBus.emit({ type: 'IncomingTransferReceived', transfer })

      } catch (e) {
        // 복호화 실패 = 내가 아님
        console.log('Not my giftwrap, ignoring')
      }
    })
  }

  private async decrypt(event: NostrEvent): Promise<unknown> {
    return nip44.decrypt(this.keyManager.getPrivateKey(), event.content)
  }

  private isValidPayload(payload: unknown): boolean {
    // nut-18 payload 검증
    return payload && typeof payload === 'object' && 'token' in payload
  }
}
```

### 3-4. 새 파일 (예시): `adapters/http/http-transfer.adapter.ts`

**작업**: 미래 HTTP 전송 지원 시 추가

```typescript
export class HttpTransferAdapter implements TransferOperator {
  readonly protocol = 'ecash-http'
  // ... TransferOperator 구현
}
```

---

## 4. Storage Layer 변경

### 4-1. 수정: `adapters/storage/dexie/schema.ts`

**작업**: 기존 테이블 제거 → `pendingTransfers` 통합 테이블 추가

```typescript
// 기존 제거
// pendingMelts: 'meltQuoteId, mintUrl, createdAt'
// outgoingEcashOperations: '...'
// giftWrapInbox: '...'

// 신규
export interface DexiePendingTransfer {
  id: string
  txId: string
  direction: 'outgoing' | 'incoming'
  phase: string
  finality: string
  expiresAt?: number
  onExpiry: string
  transportRef: string       // JSON 직렬화
  createdAt: number
  updatedAt: number
}

// 스키마 정의
pendingTransfers: 'id, txId, direction, phase, expiresAt, createdAt'
```

### 4-2. 새 파일: `adapters/storage/dexie/dexie-pending-transfer.store.ts`

**작업**: 생성

```typescript
import type { PendingTransferStore } from '@core/ports/driven/pending-transfer-store.port'

export class DexiePendingTransferStore implements PendingTransferStore {
  constructor(private db: DexieDB) {}

  async create(transfer: PendingTransfer): Promise<void> {
    await this.db.pendingTransfers.add(this.toRecord(transfer))
  }

  async get(id: string): Promise<PendingTransfer | null> {
    const record = await this.db.pendingTransfers.get(id)
    return record ? this.fromRecord(record) : null
  }

  // ... 나머지 구현

  private toRecord(t: PendingTransfer): DexiePendingTransfer {
    return {
      ...t,
      transportRef: JSON.stringify(t.transportRef),
    }
  }

  private fromRecord(r: DexiePendingTransfer): PendingTransfer {
    return {
      ...r,
      transportRef: JSON.parse(r.transportRef),
    } as PendingTransfer
  }
}
```

### 4-3. 삭제: `adapters/storage/dexie/dexie-gift-wrap-inbox.store.ts`

**작업**: 제거

### 4-4. 삭제: `adapters/storage/dexie/dexie-outgoing-ecash-operation.store.ts`

**작업**: 제거

---

## 5. Service Layer 변경

### 5-1. 새 파일: `core/services/transfer-lifecycle.service.ts`

**작업**: 생성

```typescript
import type { PendingTransferStore } from '@core/ports/driven/pending-transfer-store.port'
import type { TransferOperator, TransferIntent } from '@core/ports/driven/transfer-operator.port'
import type { EventBus } from '@core/events/event-bus'
import { createPendingTransfer, transitionPhase, isTerminal, canReclaim } from '@core/domain/pending-transfer'

export class TransferLifecycleService {
  constructor(
    private transferStore: PendingTransferStore,
    private operators: Map<string, TransferOperator>,
    private eventBus: EventBus,
  ) {}

  /** 보내기 (Outgoing) 시작 */
  async initiateTransfer(intent: TransferIntent, protocol: string): Promise<PendingTransfer> {
    const operator = this.operators.get(protocol)
    if (!operator) throw new Error(`Unknown protocol: ${protocol}`)

    // 1. 준비
    let transfer = await operator.prepare(intent)
    await this.transferStore.create(transfer)

    // 2. 실행
    transfer = await operator.execute(transfer)
    await this.transferStore.update(transfer.id, transfer)

    // 3. 이벤트 발행
    this.eventBus.emit({ type: 'TransferSubmitted', transfer })

    return transfer
  }

  /** 받기 (Incoming) 처리 — NostrIncomingWatcher가 생성한 transfer를 인계받음 */
  async processIncomingTransfer(transferId: string): Promise<void> {
    const transfer = await this.transferStore.get(transferId)
    if (!transfer || transfer.direction !== 'incoming') return

    const operator = this.findOperator(transfer)
    if (!operator?.processIncoming) return

    // 토큰 복호화/검증 등 adapter가 처리
    const processed = await operator.processIncoming(transfer)
    await this.transferStore.update(processed.id, processed)

    this.eventBus.emit({ type: 'IncomingTransferProcessed', transfer: processed })
  }

  /** 사용자가 "받기" 클릭 */
  async claimIncomingTransfer(transferId: string): Promise<void> {
    const transfer = await this.transferStore.get(transferId)
    if (!transfer || transfer.direction !== 'incoming') {
      throw new Error('Not an incoming transfer')
    }

    const operator = this.findOperator(transfer)
    if (!operator?.execute) {
      throw new Error('Cannot claim this transfer')
    }

    // execute = redeem (mint에서 proofs 교환)
    const settled = await operator.execute(transfer)
    await this.transferStore.update(settled.id, settled)

    // Transaction 생성 (회계 기록)
    await this.createReceiveTransaction(settled)

    this.eventBus.emit({ type: 'TransferSettled', transfer: settled })
  }

  /** 폴링 (주기적 실행) */
  async pollPendingTransfers(): Promise<void> {
    const pending = await this.transferStore.listActive()

    for (const transfer of pending) {
      const operator = this.findOperator(transfer)
      if (!operator) continue

      const newPhase = await operator.poll(transfer)

      if (newPhase !== transfer.phase) {
        const updated = transitionPhase(transfer, newPhase, Date.now())
        await this.transferStore.update(updated.id, updated)

        this.eventBus.emit({ type: 'TransferPhaseChanged', transfer: updated })

        // 최종 상태면 정리
        if (isTerminal(newPhase)) {
          await this.finalizeTransfer(updated)
        }
      }
    }
  }

  /** 회수 */
  async reclaimTransfer(transferId: string): Promise<void> {
    const transfer = await this.transferStore.get(transferId)
    if (!transfer || !canReclaim(transfer)) {
      throw new Error('Cannot reclaim this transfer')
    }

    const operator = this.findOperator(transfer)
    if (!operator?.reclaim) {
      throw new Error('Reclaim not supported for this protocol')
    }

    await operator.reclaim(transfer)

    const updated = transitionPhase(transfer, 'settled', Date.now())
    await this.transferStore.update(updated.id, {
      ...updated,
      // reclaim 성공 시 outcome 처리는 adapter가 알아서
    })

    this.eventBus.emit({ type: 'TransferReclaimed', transfer: updated })
  }

  /** 복구 (앱 재시작 시) */
  async recoverTransfers(): Promise<void> {
    const active = await this.transferStore.listActive()
    for (const transfer of active) {
      this.eventBus.emit({ type: 'TransferNeedsPolling', transfer })
    }
  }

  private findOperator(transfer: PendingTransfer): TransferOperator | undefined {
    // transportRef.type 또는 protocol 필드에서 operator 찾기
    const ref = transfer.transportRef as { type?: string; protocol?: string }
    const key = ref.protocol || ref.type?.split('-')[0]
    return key ? this.operators.get(key) : undefined
  }

  private async finalizeTransfer(transfer: PendingTransfer): Promise<void> {
    // Transaction 상태 업데이트
    this.eventBus.emit({
      type: 'TransferSettled',
      txId: transfer.txId,
      outcome: transfer.phase === 'settled' ? 'claimed' : 'failed',
    })

    // 필요시 삭제 (또는 보관용으로 유지)
    // await this.transferStore.delete(transfer.id)
  }
}
```

### 5-2. 수정: `core/services/payment.service.ts`

**작업**: `TransferLifecycleService` 위임

```typescript
export class PaymentService {
  constructor(
    private transferLifecycle: TransferLifecycleService,
    // ... 기존 의존성
  ) {}

  async send(params: SendParams): Promise<Transaction> {
    // 1. Transaction 생성만 하고 즉시 반환 (기록)
    const tx = createTransaction({ ... })
    await this.txRepo.save(tx)

    // 2. TransferLifecycle에 위임 (비동기, 기다리지 않음!)
    // 🔥 중요: await 하지 않음 — 즉시 반환 (fire-and-forget)
    const protocol = this.resolveProtocol(params.destination)
    this.transferLifecycle.initiateTransfer(
      {
        txId: tx.id,
        accountId: params.accountId,
        amount: params.amount,
        recipient: params.destination,
        memo: params.memo,
      },
      protocol,
    ).catch((err) => {
      console.error('Transfer initiation failed:', err)
      // 실패 시 Transaction 상태 업데이트
      this.txRepo.update(tx.id, {
        status: 'failed',
        metadata: { ...tx.metadata, error: err.message },
      })
    })

    // 3. 즉시 반환 (status: 'pending')
    // 사용자는 "보내는 중..."을 보게 됨
    // 완료되면 EventBus로 화면 자동 업데이트
    return tx
  }
}
```

### 5-3. 수정: `core/services/gift-wrap-inbox.service.ts`

**작업**: `PendingTransfer` 기반으로 변경

```typescript
export class GiftWrapInboxService {
  constructor(
    private transferStore: PendingTransferStore,
    private eventBus: EventBus,
  ) {}

  async processIncomingTransfer(transferId: string): Promise<void> {
    const transfer = await this.transferStore.get(transferId)
    if (!transfer || transfer.direction !== 'incoming') return

    // 토큰 복호화/검증
    // ... adapter 로직

    // 상태 업데이트
    const updated = transitionPhase(transfer, 'awaiting_confirmation', Date.now())
    await this.transferStore.update(updated.id, updated)
  }

  async claimTransfer(transferId: string): Promise<void> {
    // 사용자가 "받기" 클릭
    // ... redeem 로직

    const updated = transitionPhase(transfer, 'settled', Date.now())
    await this.transferStore.update(updated.id, updated)
  }
}
```

### 5-4. 삭제: `core/services/outgoing-ecash-lifecycle.service.ts`

**작업**: `TransferLifecycleService`로 통합 후 제거

---

## 6. Composition Layer 변경

### 6-1. 수정: `composition/bootstrap.ts`

**작업**: `TransferLifecycleService` 등록, 기존 서비스 제거

```typescript
import { TransferLifecycleService } from '@core/services/transfer-lifecycle.service'
import { CashuBolt11Adapter } from '@modules/cashu/adapters/cashu-bolt11.adapter'
import { CashuEcashAdapter } from '@modules/cashu/adapters/cashu-ecash.adapter'

export function bootstrap() {
  // ... 기존 초기화

  // 1. 통합 Store
  const pendingTransferStore = new DexiePendingTransferStore(db)

  // 2. Message Transport (Nostr — outgoing 전송용)
  const nostrTransport = new NostrTransportAdapter(nostrGateway)

  // 3. Transfer Operators
  const operators = new Map<string, TransferOperator>([
    ['bolt11', new CashuBolt11Adapter(cashuBackend)],
    ['ecash', new CashuEcashAdapter(cashuBackend, nostrTransport)],
    // 미래: ['bolt12', new Bolt12Adapter(...)],
    // 미래: ['ecash-http', new HttpTransferAdapter(...)],
  ])

  // 4. 통합 Service
  const transferLifecycle = new TransferLifecycleService(
    pendingTransferStore,
    operators,
    eventBus,
  )

  // 5. Incoming Watcher (Adapter Layer) — TransferLifecycle과 별개!
  // 이것은 Nostr 구독(Subscription) — 항상 실행 중
  const incomingWatcher = new NostrIncomingWatcher(
    nostrGateway,
    pendingTransferStore,
    eventBus,
    keyManager,
  )

  // 6. 기존 서비스 대체
  const paymentService = new PaymentService(
    transferLifecycle,
    // ... 기존 의존성
  )

  // 7. 기존 Ecash Lifecycle Service 제거
  // const outgoingEcashLifecycle = ... (삭제)

  // 8. 앱 시작 시 실행
  // 8a. 항상 구독 (Incoming 수신)
  incomingWatcher.start()

  // 8b. 앱 시작 시 복구 (재시작 시 남아있는 transfer)
  transferLifecycle.recoverTransfers().catch(console.error)

  // 8c. 주기적 폴링 (Outgoing 상태 추적)
  // 🔥 구독과 폴링은 공존합니다:
  // - 구독: Incoming 수신 (Nostr 이벤트)
  // - 폴링: Outgoing 상태 확인 (Mint API)
  setInterval(() => {
    transferLifecycle.pollPendingTransfers().catch(console.error)
  }, POLL_INTERVAL)

  return {
    // ... 기존 registry
    transferLifecycle,
    incomingWatcher, // 필요시 외부에서 정리
  }
}
```

### 6-2. 삭제: `composition/gift-wrap.watcher.ts` → `adapters/nostr/nostr-incoming-watcher.ts`로 대체

**작업**: 기존 `gift-wrap.watcher.ts` 제거

이유: Incoming 수신은 더 이상 Composition Layer가 아닌 **Adapter Layer**에서 처리합니다. `NostrIncomingWatcher`가 `adapters/nostr/`에 위치합니다.

```typescript
// ❌ 삭제됨: composition/gift-wrap.watcher.ts
// ✅ 대체: adapters/nostr/nostr-incoming-watcher.ts
```

---

## 7. UI / Hooks 변경

### 7-1. 수정: `hooks/use-redeem-token.ts`

**작업**: Incoming Transfer "받기" — `TransferLifecycleService.claimIncomingTransfer`

```typescript
export function useRedeemToken() {
  const { transferLifecycle } = useServices()

  async function claim(transferId: string) {
    // 사용자가 "받기" 클릭 → TLS가 adapter에게 redeem 위임
    await transferLifecycle.claimIncomingTransfer(transferId)
  }

  // GiftWrap 도착 알림 (NostrIncomingWatcher가 이벤트 발행)
  const incomingTransfers = useStore((state) => 
    state.pendingTransfers.filter((t) => t.direction === 'incoming')
  )

  return { claim, incomingTransfers }
}
```

### 7-2. 수정: `hooks/use-reclaim.ts`

**작업**: `TransferLifecycleService.reclaimTransfer` 호출

```typescript
export function useReclaim() {
  const { transferLifecycle } = useServices()

  async function reclaim(transferId: string) {
    await transferLifecycle.reclaimTransfer(transferId)
  }

  return { reclaim }
}
```

### 7-3. 삭제: `hooks/use-outgoing-ecash-reconcile-poller.ts`

**작업**: `TransferLifecycleService.pollPendingTransfers`로 통합

---

## 8. Migration (Dexie 스키마 버전업)

### 8-1. `adapters/storage/dexie/migrations.ts`

```typescript
// 버전 N → N+1
export const migrations = {
  [N + 1]: (db: Dexie) => {
    // 1. 기존 테이블 데이터 마이그레이션
    db.table('pendingMelts').toArray().then((melts) => {
      const transfers = melts.map((m) => ({
        id: m.meltQuoteId,
        txId: m.txId || 'migrated',
        direction: 'outgoing',
        phase: m.state === 'settled' ? 'settled' : 'in_transit',
        finality: 'immediate',
        onExpiry: 'fail',
        transportRef: JSON.stringify({ type: 'bolt11-melt', ...m }),
        createdAt: m.createdAt,
        updatedAt: Date.now(),
      }))
      return db.table('pendingTransfers').bulkAdd(transfers)
    })

    // 2. 기존 테이블 삭제
    db.table('pendingMelts').clear()
    db.table('outgoingEcashOperations').clear()
    db.table('giftWrapInbox').clear()
  },
}
```

---

## 9. 작업 순서 (실행 계획)

### Phase 1: 도메인 및 포트 인터페이스 (2시간)
1. [ ] `core/domain/pending-transfer.ts` 생성
2. [ ] `core/ports/driven/pending-transfer-store.port.ts` 생성
3. [ ] `core/ports/driven/transfer-operator.port.ts` 생성
4. [ ] `core/domain/transaction.ts`에 `transferId` 메타 추가

### Phase 2: 스토어 구현 (2시간)
5. [ ] `adapters/storage/dexie/schema.ts`에 `pendingTransfers` 테이블 추가
6. [ ] `adapters/storage/dexie/dexie-pending-transfer.store.ts` 생성
7. [ ] Migration 스크립트 작성

### Phase 3: 서비스 레이어 (3시간)
8. [ ] `core/services/transfer-lifecycle.service.ts` 생성
9. [ ] `core/services/payment.service.ts` 수정 (위임)
10. [ ] `core/services/gift-wrap-inbox.service.ts` 수정

### Phase 4: 어댑터 구현 (4시간)
11. [ ] `modules/cashu/adapters/cashu-bolt11.adapter.ts` → `TransferOperator` 구현
12. [ ] `modules/cashu/adapters/cashu-ecash.adapter.ts` → `TransferOperator` 구현 (with `MessageTransport`)
13. [ ] `adapters/nostr/nostr-incoming-watcher.ts` 생성 (GiftWrap 수신 — Adapter Layer)
14. [ ] `adapters/message-transport.port.ts` 또는 인터페이스 정의

### Phase 5: Composition (2시간)
15. [ ] `composition/bootstrap.ts` 수정 (통합 서비스 등록, Watcher와 Lifecycle 분리)
16. [ ] `composition/gift-wrap.watcher.ts` 삭제 (nostr-incoming-watcher.ts로 대체)
17. [ ] 기존 서비스 제거 (outgoingEcashLifecycle, pendingMeltRecovery 등)

### Phase 6: UI 수정 (2시간)
18. [ ] `hooks/use-reclaim.ts` 수정
19. [ ] `hooks/use-redeem-token.ts` 수정 (claimIncomingTransfer 사용)
20. [ ] `screens/TransactionDetailScreen.tsx` 수정 (PendingTransfer 상태 표시)

### Phase 7: 정리 및 테스트 (3시간)
21. [ ] 기존 도메인 파일 제거 (`outgoing-ecash-lifecycle.ts`, `pending-operation.ts`)
22. [ ] 기존 포트 제거 (`gift-wrap-inbox-store.port.ts`, `outgoing-ecash-operation-store.port.ts`)
23. [ ] 기존 스토어 제거 (dexie-gift-wrap-inbox, dexie-outgoing-ecash-operation)
24. [ ] `composition/gift-wrap.watcher.ts` 삭제
25. [ ] 단위 테스트 작성 (TransferLifecycleService, 각 Adapter)
26. [ ] 통합 테스트 (end-to-end send/receive)

---

## 10. 체크리스트

### Architecture 규칙 확인
- [ ] Domain에 프로토콜명(`ecash`, `nostr`, `bolt11`)이 없는가?
- [ ] Domain은 `TransferPhase`, `FinalityModel`만 정의하는가?
- [ ] Adapter만 프로토콜별 구현을 갖는가?
- [ ] 새 프로토콜 추가 시 Adapter 1개만 추가되는가?
- [ ] `MessageTransport` 인터페이스로 전송 계층이 추상화되어 있는가?
- [ ] `NostrIncomingWatcher`가 Adapter Layer에 있는가?
- [ ] `PaymentService`가 Transfer 실행을 await하지 않고 즉시 반환하는가? (fire-and-forget)

### 기능 확인
- [ ] Bolt11 보내기: melt quote → execute → preimage → settled
- [ ] Bolt11 받기: mint quote → 인보이스 → 결제 대기 → settled
- [ ] Ecash 보내기: token 생성 → publish → claim 대기 → settled/recoverable
- [ ] Ecash 받기: GiftWrap 수신 → 복호화 → 사용자 수락 → settled
- [ ] 회수 (Reclaim): recoverable → reclaim → settled
- [ ] **구독 (Subscription)**: Nostr Incoming 실시간 수신
- [ ] **폴링 (Polling)**: Outgoing 주기적 상태 확인
- [ ] **구독 + 폴링 공존**: 둘 다 동시에 실행됨
- [ ] 복구: 앱 재시작 시 active transfer 복원

---

## 핵심 변경사항 요약

| 관점 | 기존 (f61dd8af) | 설계안 |
|---|---|---|
| **구독 vs 폴링** | 폴링만 있음 (OutgoingEcashReconcilePoller) | **구독 + 폴링 공존** (Incoming 구독, Outgoing 폴링) |
| **Incoming 수신** | `GiftWrapWatcher` (Composition Layer) | `NostrIncomingWatcher` (**Adapter Layer**) |
| **PaymentService** | 동기 실행 (adapter 직접 호출) | **즉시 반환** (fire-and-forget, TLS 위임) |
| **Ecash 전송** | `nostrTransport` 직접 참조 | `MessageTransport` **인터페이스**로 추상화 |
| **Watcher/Service 관계** | 경계 불분명 | **Watcher(발견) → Service(관리)** 명확한 분리 |

## 결론

이 구현을 통해:

1. **도메인 레이어는 프로토콜로부터 완전히 자유로워짐**
2. **새로운 전송 프로토콜(Nostr, HTTP, QR, Bolt12, Fedimint 등) 추가 시 Adapter만 구현**
3. **보내기/받기, Bolt11/Ecash/미래 프로토콜 모두 동일한 상태 머신으로 추적**
4. **저장소 단일화로 복잡도 감소**
5. **구독(실시간 수신)과 폴링(상태 확인)이 명확히 분리되어 공존**
6. **PaymentService는 기록만 생성하고 즉시 반환, 실행은 백그라운드에서 추적**

**핵심 원칙**: Domain은 "**무엇이**" 가능한가만 정의하고, Adapter가 "**어떻게**" 구현하는가를 결정한다.

**추가 원칙**:
- **Watcher는 Adapter에 있다**: Incoming 수신은 Adapter 레이어에서 담당
- **Service는 위임만 한다**: 실행을 Adapter에게 위임하고 상태만 관리
- **구독과 폴링은 공존한다**: 실시간 수신(구독)과 주기적 확인(폴링)을 동시에 사용
