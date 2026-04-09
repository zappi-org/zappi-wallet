# 헥사고널 코드 예시

`hexagonal-refactoring-guide-v2.md`의 각 레이어에 대한 구체적 코드.

## 목차

| 섹션 | 내용 |
|------|------|
| [**1. Domain**](#1-domain) | Amount, Transaction |
| [**2. Driven Ports**](#2-driven-ports) | WalletModule, PaymentMethodAdapter, TransactionRepository |
| [**3. Driving Ports**](#3-driving-ports) | PaymentUseCase, BalanceUseCase |
| [**4. Services**](#4-services) | PaymentService, BalanceAggregator |
| [**5. Driven Adapters**](#5-driven-adapters) | CashuModule, CashuLightningAdapter, DexieTransactionRepository |
| [**6. Driving Adapters**](#6-driving-adapters) | hooks, watchers |
| [**7. Error 경계**](#7-error-경계) | Domain Error, Result, 변환 흐름 |
| [**8. EventBus → Store**](#8-eventbus--store) | 이벤트 정의, 연결, Zustand |
| [**9. Bootstrap**](#9-bootstrap) | 전체 조립 |
| [**10. 흐름 추적**](#10-흐름-추적) | "mint.coinos.io에서 ecash로 1000 sat + memo 보내기" 전체 경로 |

---

## 1. Domain

`core/domain/` — 순수 코드. 외부 import 없음.

### Amount

```typescript
// core/domain/amount.ts

export type Unit = 'sat' | 'msat' | 'usd' | 'eur'

export interface Amount {
  readonly value: bigint
  readonly unit: Unit
}

export function sat(value: number | bigint): Amount {
  return { value: BigInt(value), unit: 'sat' }
}

export function add(a: Amount, b: Amount): Amount {
  if (a.unit !== b.unit) throw new Error(`Unit mismatch: ${a.unit} + ${b.unit}`)
  return { value: a.value + b.value, unit: a.unit }
}

export function subtract(a: Amount, b: Amount): Amount {
  if (a.unit !== b.unit) throw new Error(`Unit mismatch: ${a.unit} - ${b.unit}`)
  return { value: a.value - b.value, unit: a.unit }
}

export function toNumber(a: Amount): number {
  return Number(a.value)
}
```

### Transaction

```typescript
// core/domain/transaction.ts

import type { Amount } from './amount'

export interface Transaction {
  readonly id: string
  readonly direction: 'send' | 'receive'
  readonly method: string       // adapter.id: 'cashu:lightning', 'fedi:ecash'
  readonly protocol: string     // 'bolt11', 'bolt12', 'nut18', 'cashu-token'
  readonly amount: Amount
  readonly accountId: string    // mint URL, federation ID 등
  readonly status: 'pending' | 'completed' | 'failed'
  readonly createdAt: number
  readonly completedAt?: number
  readonly memo?: string
  readonly metadata?: Record<string, unknown>
}

export function createTransaction(params: Omit<Transaction, 'status' | 'createdAt'>): Transaction {
  return { ...params, status: 'pending', createdAt: Date.now() }
}

export function completeTransaction(tx: Transaction): Transaction {
  return { ...tx, status: 'completed', completedAt: Date.now() }
}

export function failTransaction(tx: Transaction, error?: string): Transaction {
  return { ...tx, status: 'failed', completedAt: Date.now(), metadata: { ...tx.metadata, error } }
}
```

---

## 2. Driven Ports

`core/ports/driven/` — 앱이 외부에 요청하는 인터페이스. 구현체를 모름.

### WalletModule

```typescript
// core/ports/driven/wallet-module.port.ts

import type { Amount } from '@/core/domain/amount'

export interface WalletModule {
  readonly id: string
  readonly displayName: string

  initialize(seed: Uint8Array, derivationPath: string): Promise<void>
  dispose(): Promise<void>
  isEnabled(): boolean

  getPaymentAdapters(): PaymentMethodAdapter[]
  getCapabilities(): ModuleCapability[]
  getBalance(): Promise<ModuleBalance>

  on(event: string, handler: (...args: any[]) => void): () => void
}

export interface ModuleBalance {
  moduleId: string
  accounts: { id: string; label: string; amount: Amount }[]
  total: Amount
}

export interface ModuleCapability {
  id: string
  operations: string[]
}
```

### PaymentMethodAdapter

```typescript
// core/ports/driven/payment-method.port.ts

import type { Amount } from '@/core/domain/amount'

export interface PaymentMethodAdapter {
  readonly id: string            // 'cashu:lightning'
  readonly moduleId: string      // 'cashu'
  readonly supportedUnits: string[]
  readonly capabilities: { canSend: boolean; canReceive: boolean; canEstimateFee: boolean }

  parseInput(input: string): ParsedInput | null
  createReceiveRequest(params: ReceiveParams): Promise<ReceiveRequest>
  estimateFee(params: SendParams): Promise<FeeEstimate>
  prepareSend(params: SendParams): Promise<PreparedPayment>
  executeSend(preparedId: string): Promise<ExecutingPayment>
  cancelPrepared(preparedId: string): Promise<void>
  reclaimFailed(operationId: string): Promise<void>
  recoverPending(): Promise<RecoveryReport>
}

export interface SendParams {
  destination: string
  amount: Amount
  mintUrl: string
  memo?: string
}

export interface PreparedPayment {
  id: string
  method: string
  protocol: string
  amount: Amount
  fee: Amount
  memo?: string
}

export interface ReceiveParams {
  amount: Amount
  mintUrl: string
  description?: string
}

export interface ReceiveRequest {
  id: string
  method: string
  protocol: string
  encoded: string    // QR에 표시할 문자열
  amount: Amount
  expiresAt?: number
}

export interface FeeEstimate {
  fee: Amount
  method: string
  protocol: string
}

export interface ExecutingPayment {
  id: string
  state: string
}

export interface ParsedInput {
  method: string
  protocol: string
  destination: string
  amount?: Amount
}

export interface RecoveryReport {
  recovered: number
  failed: number
}
```

### TransactionRepository

```typescript
// core/ports/driven/transaction.repository.port.ts

import type { Transaction } from '@/core/domain/transaction'

export interface TransactionRepository {
  save(tx: Transaction): Promise<void>
  getById(id: string): Promise<Transaction | null>
  list(filter?: TransactionFilter): Promise<Transaction[]>
  update(id: string, patch: Partial<Transaction>): Promise<void>
}

export interface TransactionFilter {
  direction?: 'send' | 'receive'
  status?: 'pending' | 'completed' | 'failed'
  accountId?: string
  limit?: number
  offset?: number
}
```

---

## 3. Driving Ports

`core/ports/driving/` — UI/Watcher가 앱을 호출하는 인터페이스.

### PaymentUseCase

```typescript
// core/ports/driving/payment.usecase.ts

import type { Amount } from '@/core/domain/amount'
import type { ModuleBalance } from '@/core/ports/driven/wallet-module.port'
import type { PaymentMethodAdapter, FeeEstimate, ParsedInput, ReceiveRequest } from '@/core/ports/driven/payment-method.port'
import type { Result } from '@/core/domain/result'
import type { PaymentError } from '@/core/errors/payment.errors'

export interface PaymentUseCase {
  getAccounts(): Promise<ModuleBalance[]>
  getMethodsForAccount(accountId: string): PaymentMethodAdapter[]

  send(params: {
    accountId: string
    adapterId: string
    destination: string
    amount: Amount
    memo?: string
  }): Promise<Result<SendResult, PaymentError>>

  receive(params: {
    accountId: string
    adapterId: string
    amount: Amount
    description?: string
  }): Promise<Result<ReceiveRequest, PaymentError>>

  estimateFee(params: {
    accountId: string
    adapterId: string
    destination: string
    amount: Amount
  }): Promise<Result<FeeEstimate, PaymentError>>

  parseInput(input: string): ParsedInput | null
  recoverAll(): Promise<RecoveryReport[]>
}

export interface SendResult {
  transactionId: string
  state: string
}

export interface RecoveryReport {
  moduleId: string
  recovered: number
  failed: number
}
```

### BalanceUseCase

```typescript
// core/ports/driving/balance.usecase.ts

import type { Amount } from '@/core/domain/amount'
import type { ModuleBalance } from '@/core/ports/driven/wallet-module.port'

export interface BalanceUseCase {
  getTotal(): Promise<Amount>
  getByModule(): Promise<ModuleBalance[]>
}
```

### Result 타입

```typescript
// core/domain/result.ts

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function Err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}
```

---

## 4. Services

`services/` — UseCase Port 구현. Driven Port를 통해 외부 접근.

### PaymentService

```typescript
// services/payment/payment.service.ts

import type { PaymentUseCase, SendResult, RecoveryReport } from '@/core/ports/driving/payment.usecase'
import type { WalletModule, ModuleBalance } from '@/core/ports/driven/wallet-module.port'
import type { PaymentMethodAdapter, FeeEstimate, ParsedInput, ReceiveRequest } from '@/core/ports/driven/payment-method.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { EventBus } from '@/core/events/event-bus'
import type { Amount } from '@/core/domain/amount'
import type { Result } from '@/core/domain/result'
import type { PaymentError } from '@/core/errors/payment.errors'
import { Ok, Err } from '@/core/domain/result'
import { createTransaction, completeTransaction, failTransaction } from '@/core/domain/transaction'

export class PaymentService implements PaymentUseCase {
  constructor(
    private modules: WalletModule[],
    private txRepo: TransactionRepository,
    private events: EventBus,
  ) {}

  async getAccounts(): Promise<ModuleBalance[]> {
    return Promise.all(this.modules.map(m => m.getBalance()))
  }

  getMethodsForAccount(accountId: string): PaymentMethodAdapter[] {
    const module = this.findModuleForAccount(accountId)
    return module?.getPaymentAdapters() ?? []
  }

  async send(params: {
    accountId: string
    adapterId: string
    destination: string
    amount: Amount
    memo?: string
  }): Promise<Result<SendResult, PaymentError>> {
    const module = this.findModuleForAccount(params.accountId)
    if (!module) return Err({ code: 'MODULE_NOT_FOUND', message: `No module for ${params.accountId}` })

    const adapter = module.getPaymentAdapters().find(a => a.id === params.adapterId)
    if (!adapter) return Err({ code: 'ADAPTER_NOT_FOUND', message: `No adapter ${params.adapterId}` })

    // 거래 기록 생성 (pending)
    const tx = createTransaction({
      id: crypto.randomUUID(),
      direction: 'send',
      method: adapter.id,
      protocol: '',  // adapter가 채움
      amount: params.amount,
      accountId: params.accountId,
      memo: params.memo,
    })
    await this.txRepo.save(tx)

    try {
      // adapter에 위임
      const prepared = await adapter.prepareSend({
        destination: params.destination,
        amount: params.amount,
        mintUrl: params.accountId,
        memo: params.memo,
      })

      const result = await adapter.executeSend(prepared.id)

      // 거래 완료 기록
      await this.txRepo.update(tx.id, {
        status: 'completed',
        completedAt: Date.now(),
        protocol: prepared.protocol,
      })

      // 이벤트 발행
      this.events.emit({
        type: 'payment:completed',
        payload: { txId: tx.id, method: adapter.id, amount: params.amount },
      })

      return Ok({ transactionId: tx.id, state: result.state })
    } catch (err) {
      await this.txRepo.update(tx.id, {
        status: 'failed',
        completedAt: Date.now(),
        metadata: { error: err instanceof Error ? err.message : String(err) },
      })
      return Err(this.mapError(err))
    }
  }

  async receive(params) {
    const module = this.findModuleForAccount(params.accountId)
    if (!module) return Err({ code: 'MODULE_NOT_FOUND', message: '' })

    const adapter = module.getPaymentAdapters().find(a => a.id === params.adapterId)
    if (!adapter) return Err({ code: 'ADAPTER_NOT_FOUND', message: '' })

    try {
      const request = await adapter.createReceiveRequest({
        amount: params.amount,
        mintUrl: params.accountId,
        description: params.description,
      })
      return Ok(request)
    } catch (err) {
      return Err(this.mapError(err))
    }
  }

  async estimateFee(params) {
    const module = this.findModuleForAccount(params.accountId)
    if (!module) return Err({ code: 'MODULE_NOT_FOUND', message: '' })

    const adapter = module.getPaymentAdapters().find(a => a.id === params.adapterId)
    if (!adapter) return Err({ code: 'ADAPTER_NOT_FOUND', message: '' })

    try {
      const fee = await adapter.estimateFee({
        destination: params.destination,
        amount: params.amount,
        mintUrl: params.accountId,
      })
      return Ok(fee)
    } catch (err) {
      return Err(this.mapError(err))
    }
  }

  parseInput(input: string): ParsedInput | null {
    for (const module of this.modules) {
      for (const adapter of module.getPaymentAdapters()) {
        const parsed = adapter.parseInput(input)
        if (parsed) return parsed
      }
    }
    return null
  }

  async recoverAll(): Promise<RecoveryReport[]> {
    const reports: RecoveryReport[] = []
    for (const module of this.modules) {
      for (const adapter of module.getPaymentAdapters()) {
        const report = await adapter.recoverPending()
        reports.push({ moduleId: module.id, ...report })
      }
    }
    return reports
  }

  // ── private ──

  private findModuleForAccount(accountId: string): WalletModule | undefined {
    // accountId가 속한 module 찾기 (mint URL → cashu, federation ID → fedimint)
    return this.modules.find(m =>
      m.getBalance().then(b => b.accounts.some(a => a.id === accountId))
    ) // 실제 구현에서는 동기적 캐시 사용
  }

  private mapError(err: unknown): PaymentError {
    if (err instanceof Error) {
      if (err.message.includes('Insufficient')) return { code: 'INSUFFICIENT_BALANCE', message: err.message }
      if (err.message.includes('Unreachable')) return { code: 'MINT_UNREACHABLE', message: err.message }
    }
    return { code: 'UNKNOWN', message: String(err) }
  }
}
```

### BalanceAggregator

```typescript
// services/payment/balance-aggregator.ts

import type { BalanceUseCase } from '@/core/ports/driving/balance.usecase'
import type { WalletModule, ModuleBalance } from '@/core/ports/driven/wallet-module.port'
import type { Amount } from '@/core/domain/amount'
import { sat, add } from '@/core/domain/amount'

export class BalanceAggregator implements BalanceUseCase {
  constructor(private modules: WalletModule[]) {}

  async getTotal(): Promise<Amount> {
    const balances = await this.getByModule()
    return balances.reduce((sum, b) => add(sum, b.total), sat(0))
  }

  async getByModule(): Promise<ModuleBalance[]> {
    return Promise.all(this.modules.map(m => m.getBalance()))
  }
}
```

---

## 5. Driven Adapters

`modules/`, `adapters/storage/` — Port 구현. 외부 SDK/DB에 의존.

### CashuModule

```typescript
// modules/cashu/cashu.module.ts

import type { WalletModule, ModuleBalance, ModuleCapability } from '@/core/ports/driven/wallet-module.port'
import type { PaymentMethodAdapter } from '@/core/ports/driven/payment-method.port'
import { sat, add } from '@/core/domain/amount'
import { CashuBackend } from './internal/cashu-backend'
import { CashuLightningAdapter } from './adapters/cashu-lightning.adapter'
import { CashuEcashAdapter } from './adapters/cashu-ecash.adapter'

export class CashuModule implements WalletModule {
  readonly id = 'cashu'
  readonly displayName = 'Cashu'

  private backend!: CashuBackend
  private adapters: PaymentMethodAdapter[] = []

  async initialize(seed: Uint8Array, derivationPath: string): Promise<void> {
    this.backend = new CashuBackend(seed, derivationPath)
    await this.backend.init()

    this.adapters = [
      new CashuLightningAdapter(this.backend),
      new CashuEcashAdapter(this.backend),
    ]
  }

  isEnabled(): boolean { return !!this.backend }
  getPaymentAdapters(): PaymentMethodAdapter[] { return this.adapters }

  getCapabilities(): ModuleCapability[] {
    return [{ id: 'nfc-card', operations: ['write', 'read', 'backup', 'recover'] }]
  }

  async getBalance(): Promise<ModuleBalance> {
    const balances = await this.backend.getBalances()
    const accounts = Object.entries(balances).map(([mintUrl, sats]) => ({
      id: mintUrl,
      label: mintUrl,
      amount: sat(sats),
    }))
    return {
      moduleId: 'cashu',
      accounts,
      total: accounts.reduce((s, a) => add(s, a.amount), sat(0)),
    }
  }

  on(event: string, handler: (...args: any[]) => void) {
    return this.backend.on(event, handler)
  }

  async dispose(): Promise<void> {
    await this.backend.dispose()
  }
}
```

### CashuLightningAdapter (Module 내부 adapter)

```typescript
// modules/cashu/adapters/cashu-lightning.adapter.ts

import type {
  PaymentMethodAdapter, SendParams, PreparedPayment, ExecutingPayment,
  ReceiveParams, ReceiveRequest, FeeEstimate, ParsedInput, RecoveryReport,
} from '@/core/ports/driven/payment-method.port'
import { toNumber } from '@/core/domain/amount'
import type { CashuBackend } from '../internal/cashu-backend'

export class CashuLightningAdapter implements PaymentMethodAdapter {
  readonly id = 'cashu:lightning'
  readonly moduleId = 'cashu'
  readonly supportedUnits = ['sat']
  readonly capabilities = { canSend: true, canReceive: true, canEstimateFee: true }

  constructor(private backend: CashuBackend) {}

  parseInput(input: string): ParsedInput | null {
    if (/^ln(bc|tb)/i.test(input)) {
      return { method: 'lightning', protocol: 'bolt11', destination: input }
    }
    if (input.startsWith('lno1')) {
      return { method: 'lightning', protocol: 'bolt12-offer', destination: input }
    }
    return null
  }

  async createReceiveRequest(params: ReceiveParams): Promise<ReceiveRequest> {
    const op = await this.backend.mintQuote.prepare({
      mintUrl: params.mintUrl,
      amount: toNumber(params.amount),
      method: 'bolt11',
    })
    return {
      id: op.operationId,
      method: 'lightning',
      protocol: 'bolt11',
      encoded: op.request,
      amount: params.amount,
      expiresAt: op.expiry,
    }
  }

  async estimateFee(params: SendParams): Promise<FeeEstimate> {
    const op = await this.backend.meltQuote.prepare({
      mintUrl: params.mintUrl,
      method: 'bolt11',
      methodData: { invoice: params.destination },
    })
    const fee = { value: BigInt(op.feeReserve + op.swapFee), unit: params.amount.unit as any }
    await this.backend.meltQuote.cancel(op.operationId, 'fee_estimation')
    return { fee, method: 'lightning', protocol: 'bolt11' }
  }

  async prepareSend(params: SendParams): Promise<PreparedPayment> {
    const op = await this.backend.meltQuote.prepare({
      mintUrl: params.mintUrl,
      method: 'bolt11',
      methodData: { invoice: params.destination },
    })
    return {
      id: op.operationId,
      method: 'lightning',
      protocol: 'bolt11',
      amount: params.amount,
      fee: { value: BigInt(op.feeReserve + op.swapFee), unit: params.amount.unit as any },
      memo: params.memo,
    }
  }

  async executeSend(preparedId: string): Promise<ExecutingPayment> {
    const result = await this.backend.meltQuote.execute(preparedId)
    return { id: preparedId, state: result.state }
  }

  async cancelPrepared(id: string) { await this.backend.meltQuote.cancel(id, 'user_cancelled') }
  async reclaimFailed(id: string) { await this.backend.meltQuote.reclaim(id, 'reclaim') }

  async recoverPending(): Promise<RecoveryReport> {
    const ops = await this.backend.meltQuote.listInFlight()
    let recovered = 0, failed = 0
    for (const op of ops) {
      try {
        const refreshed = await this.backend.meltQuote.refresh(op.operationId)
        if (refreshed.state === 'finalized' || refreshed.state === 'rolled_back') recovered++
        else if (refreshed.state === 'failed') {
          await this.backend.meltQuote.reclaim(op.operationId, 'recovery')
          recovered++
        }
      } catch { failed++ }
    }
    return { recovered, failed }
  }
}
```

### DexieTransactionRepository (Storage adapter)

```typescript
// adapters/storage/dexie/dexie-transaction.repository.ts

import type { TransactionRepository, TransactionFilter } from '@/core/ports/driven/transaction.repository.port'
import type { Transaction } from '@/core/domain/transaction'
import type { DexieDatabase } from './schema'

export class DexieTransactionRepository implements TransactionRepository {
  constructor(private db: DexieDatabase) {}

  async save(tx: Transaction): Promise<void> {
    await this.db.transactions.put(tx)
  }

  async getById(id: string): Promise<Transaction | null> {
    return (await this.db.transactions.get(id)) ?? null
  }

  async list(filter?: TransactionFilter): Promise<Transaction[]> {
    let query = this.db.transactions.orderBy('createdAt').reverse()
    if (filter?.status) query = query.filter(tx => tx.status === filter.status)
    if (filter?.direction) query = query.filter(tx => tx.direction === filter.direction)
    if (filter?.accountId) query = query.filter(tx => tx.accountId === filter.accountId)
    if (filter?.offset) query = query.offset(filter.offset)
    if (filter?.limit) query = query.limit(filter.limit)
    return query.toArray()
  }

  async update(id: string, patch: Partial<Transaction>): Promise<void> {
    await this.db.transactions.update(id, patch)
  }
}
```

---

## 6. Driving Adapters

`hooks/`, `watchers/` — 바깥에서 안쪽을 호출.

### React Hook

```typescript
// hooks/use-payment.ts

import { useContext, useCallback } from 'react'
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'
import type { Amount } from '@/core/domain/amount'
import { PaymentContext } from '@/hooks/contexts'

export function usePayment() {
  const paymentUseCase = useContext(PaymentContext) as PaymentUseCase

  const send = useCallback(async (
    accountId: string,
    adapterId: string,
    destination: string,
    amount: Amount,
    memo?: string,
  ) => {
    const result = await paymentUseCase.send({ accountId, adapterId, destination, amount, memo })
    if (!result.ok) throw result.error  // hook에서 UI 에러 처리
    return result.value
  }, [paymentUseCase])

  const getAccounts = useCallback(() => paymentUseCase.getAccounts(), [paymentUseCase])
  const getMethodsForAccount = useCallback((id: string) => paymentUseCase.getMethodsForAccount(id), [paymentUseCase])

  return { send, getAccounts, getMethodsForAccount }
}
```

### Watcher (Background Driving)

```typescript
// watchers/app-lifecycle.watcher.ts

import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'

export class AppLifecycleWatcher {
  constructor(private payment: PaymentUseCase) {}

  start() {
    // 앱 포그라운드 복귀 시 recovery
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.payment.recoverAll()
      }
    })
  }
}
```

```typescript
// watchers/network-recovery.watcher.ts

import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'

export class NetworkRecoveryWatcher {
  constructor(private payment: PaymentUseCase) {}

  start() {
    window.addEventListener('online', () => {
      this.payment.recoverAll()
    })
  }
}
```

---

## 7. Error 경계

### Domain Error 정의

```typescript
// core/errors/payment.errors.ts

export interface PaymentError {
  code: PaymentErrorCode
  message: string
}

export type PaymentErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'MINT_UNREACHABLE'
  | 'FEE_EXCEEDS_AMOUNT'
  | 'MODULE_NOT_FOUND'
  | 'ADAPTER_NOT_FOUND'
  | 'OPERATION_EXPIRED'
  | 'UNKNOWN'
```

### 변환 흐름

```typescript
// 경계 1: modules/cashu/internal/ — SDK 에러 → Domain 에러
try {
  await manager.ops.melt.prepare(params)
} catch (err) {
  if (err.message.includes('Not enough funds'))
    throw new InsufficientBalanceError(amount, available)
  throw new WalletOperationError('melt_prepare_failed', err)
}

// 경계 2: services/ — try/catch → Result
async send(params): Promise<Result<SendResult, PaymentError>> {
  try {
    // ...adapter 호출
    return Ok({ transactionId, state })
  } catch (err) {
    return Err({ code: 'INSUFFICIENT_BALANCE', message: err.message })
  }
}

// 경계 3: hooks/ — Result → UI 표시
const result = await paymentUseCase.send(params)
if (!result.ok) {
  showToast(t(`error.${result.error.code}`))
  // → "잔액이 부족합니다"
}
```

---

## 8. EventBus → Store

### EventBus

```typescript
// core/events/event-bus.ts

import type { Amount } from '@/core/domain/amount'

export type DomainEvent =
  | { type: 'payment:completed'; payload: { txId: string; method: string; amount: Amount } }
  | { type: 'payment:failed'; payload: { txId: string; error: string } }
  | { type: 'balance:changed'; payload: { moduleId: string } }

type Handler<T> = (event: T) => void

export class EventBus {
  private handlers = new Map<string, Set<Handler<any>>>()

  on<T extends DomainEvent['type']>(
    type: T,
    handler: Handler<Extract<DomainEvent, { type: T }>>,
  ): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
    return () => { this.handlers.get(type)?.delete(handler) }
  }

  emit(event: DomainEvent): void {
    this.handlers.get(event.type)?.forEach(h => h(event))
  }
}
```

### Store (Zustand)

```typescript
// store/index.ts — 비즈니스 로직 없음. 순수 캐시.

import { create } from 'zustand'
import type { Amount } from '@/core/domain/amount'
import type { ModuleBalance } from '@/core/ports/driven/wallet-module.port'

interface AppState {
  balances: ModuleBalance[]
  totalBalance: Amount
  toasts: Toast[]

  setBalances: (balances: ModuleBalance[], total: Amount) => void
  addToast: (toast: Toast) => void
}

export const useAppStore = create<AppState>((set) => ({
  balances: [],
  totalBalance: { value: 0n, unit: 'sat' },
  toasts: [],

  setBalances: (balances, total) => set({ balances, totalBalance: total }),
  addToast: (toast) => set((s) => ({ toasts: [...s.toasts, toast] })),
}))
```

### Bootstrap에서 연결

```typescript
// EventBus 이벤트 → Store 갱신 (bootstrap.ts에서 설정)
eventBus.on('payment:completed', async () => {
  const balances = await balanceUseCase.getByModule()
  const total = await balanceUseCase.getTotal()
  useAppStore.getState().setBalances(balances, total)
})

eventBus.on('balance:changed', async () => {
  const balances = await balanceUseCase.getByModule()
  const total = await balanceUseCase.getTotal()
  useAppStore.getState().setBalances(balances, total)
})
```

---

## 9. Bootstrap

```typescript
// bootstrap.ts — 유일한 조립 지점. 모든 것을 알고 연결.

import { EventBus } from '@/core/events/event-bus'

// Driven Adapters
import { CashuModule } from '@/modules/cashu/cashu.module'
import { DexieDatabase } from '@/adapters/storage/dexie/schema'
import { DexieTransactionRepository } from '@/adapters/storage/dexie/dexie-transaction.repository'

// Services
import { PaymentService } from '@/services/payment/payment.service'
import { BalanceAggregator } from '@/services/payment/balance-aggregator'

// Driving Adapters
import { AppLifecycleWatcher } from '@/watchers/app-lifecycle.watcher'
import { NetworkRecoveryWatcher } from '@/watchers/network-recovery.watcher'

// Store
import { useAppStore } from '@/store'

export async function bootstrap(seed: Uint8Array) {
  // 1. 인프라
  const eventBus = new EventBus()
  const db = new DexieDatabase()

  // 2. Driven Adapters (Modules)
  const cashu = new CashuModule()
  await cashu.initialize(seed, "m/129372'/0'")

  const modules = [cashu]

  // 3. Driven Adapters (Storage)
  const txRepo = new DexieTransactionRepository(db)

  // 4. Services (UseCase 구현체)
  const paymentService = new PaymentService(modules, txRepo, eventBus)
  const balanceAggregator = new BalanceAggregator(modules)

  // 5. EventBus → Store 연결
  eventBus.on('payment:completed', async () => {
    const balances = await balanceAggregator.getByModule()
    const total = await balanceAggregator.getTotal()
    useAppStore.getState().setBalances(balances, total)
  })

  eventBus.on('balance:changed', async () => {
    const balances = await balanceAggregator.getByModule()
    const total = await balanceAggregator.getTotal()
    useAppStore.getState().setBalances(balances, total)
  })

  // 6. Coco SDK 이벤트 → EventBus 변환
  cashu.on('proofs:saved', () => eventBus.emit({ type: 'balance:changed', payload: { moduleId: 'cashu' } }))
  cashu.on('proofs:state-changed', () => eventBus.emit({ type: 'balance:changed', payload: { moduleId: 'cashu' } }))

  // 7. Driving Adapters (Watchers)
  new AppLifecycleWatcher(paymentService).start()
  new NetworkRecoveryWatcher(paymentService).start()

  // 8. UseCase를 React Context에 제공
  return { paymentService, balanceAggregator, eventBus }
}
```

---

## 10. 흐름 추적

**"mint.coinos.io에서 cashu:ecash로 1000 sat + memo '커피값' 보내기"**

```
[1. UI]
SendFlow.tsx
  → usePayment().send(
      'https://mint.coinos.io',   // accountId
      'cashu:ecash',               // adapterId
      'creqBech32...',             // destination (NUT-18)
      sat(1000),                   // amount
      '커피값',                     // memo
    )

[2. Hook → Driving Port]
hooks/use-payment.ts
  → paymentUseCase.send(params)       // PaymentUseCase Port 호출

[3. Service]
PaymentService.send()
  → findModuleForAccount('https://mint.coinos.io') → CashuModule
  → CashuModule.getPaymentAdapters().find('cashu:ecash') → CashuEcashAdapter
  → txRepo.save({ id, status: 'pending', memo: '커피값', ... })
  → adapter.prepareSend({ mintUrl, amount: sat(1000), memo: '커피값' })

[4. Adapter]
CashuEcashAdapter.prepareSend()
  → backend.tokenSend.prepare({ mintUrl, amount: 1000 })
  → { id: operationId, fee: 0, memo: '커피값' }

CashuEcashAdapter.executeSend(operationId)
  → backend.tokenSend.execute(operationId, { memo: '커피값' })

[5. Module Internal → Coco SDK]
CashuBackend.tokenSend.execute()
  → manager.ops.send.execute(operationId)
  → getEncodedToken({ ...token, memo: '커피값' })   // memo가 token에 인코딩
  → transport.deliver(token)                         // Nostr DM 전송
  → { state: 'completed' }

[6. 돌아오는 길]
CashuEcashAdapter → { id, state: 'completed' }
PaymentService → txRepo.update(id, { status: 'completed' })
PaymentService → eventBus.emit('payment:completed', { amount: sat(1000) })

[7. EventBus → Store → UI]
bootstrap의 핸들러
  → balanceAggregator.getByModule() → CashuModule.getBalance()
  → useAppStore.getState().setBalances(newBalances, newTotal)
  → React 리렌더 → 잔액 반영
```

### 각 레이어가 memo를 아는 방식

| 레이어 | memo 형태 | 역할 |
|--------|----------|------|
| `core/ports/` | `SendParams.memo?: string` | 도메인이 정의 |
| `services/` | params 통과 | 로직 없이 전달 |
| `adapter` | `PreparedPayment.memo` → execute 시 전달 | 보존 후 backend에 전달 |
| `internal/` | `getEncodedToken({ memo })` | 토큰에 인코딩 |

---

### "mint.coinos.io에서 cashu:lightning으로 1000 sat 수신 요청 생성 → 결제 감지 → 잔액 반영"

```
[1. UI — 사용자가 수신 요청]
ReceiveFlow.tsx
  → usePayment().receive(
      'https://mint.coinos.io',    // accountId (사용자가 선택한 mint)
      'cashu:lightning',            // adapterId (Lightning으로 받기)
      sat(1000),                    // amount
      'invoice for coffee',         // description
    )

[2. Hook → Driving Port]
hooks/use-payment.ts
  → paymentUseCase.receive(params)    // PaymentUseCase Port 호출

[3. Service — 수신 요청 생성]
PaymentService.receive()
  → findModuleForAccount('https://mint.coinos.io') → CashuModule
  → CashuModule.getPaymentAdapters().find('cashu:lightning') → CashuLightningAdapter
  → adapter.createReceiveRequest({ mintUrl, amount: sat(1000), description })

[4. Adapter — mint quote 생성]
CashuLightningAdapter.createReceiveRequest()
  → backend.mintQuote.prepare({
      mintUrl: 'https://mint.coinos.io',
      amount: 1000,
      method: 'bolt11',
    })
  → { operationId, quoteId, request: 'lnbc1000n1...', expiry }

  → return ReceiveRequest {
      id: operationId,
      method: 'lightning',
      protocol: 'bolt11',
      encoded: 'lnbc1000n1...',     // ← QR에 표시할 bolt11 invoice
      amount: sat(1000),
      expiresAt: 1711900000,
    }

[5. Module Internal → Coco SDK]
CashuBackend.mintQuote.prepare()
  → manager.ops.mint.prepare({ mintUrl, amount: 1000, method: 'bolt11', methodData: {} })
  → Coco SDK → Cashu Mint: POST /v1/mint/quote/bolt11
  → 응답: { quoteId: 'abc123', request: 'lnbc1000n1...', expiry: 1711900000 }

[6. 돌아오는 길 — UI에 invoice 표시]
CashuLightningAdapter → ReceiveRequest { encoded: 'lnbc1000n1...' }
PaymentService → Ok(receiveRequest)
hooks/use-payment.ts → receiveRequest 반환
ReceiveQRStep.tsx → QR 코드로 'lnbc1000n1...' 표시

  ════════════════════════════════════════════
  여기서 사용자 대기. 외부에서 누군가 invoice를 결제.
  ════════════════════════════════════════════

[7. Coco SDK 내부 — 결제 감지 (Background)]
MintOperationWatcher (Coco 내장)
  → mint 서버 polling: GET /v1/mint/quote/bolt11/abc123
  → 상태 변경: 'UNPAID' → 'PAID'
  → Coco 내부: ops.mint.execute() → proofs 발급 + 저장
  → Coco 이벤트: 'mint-op:finalized' 발행

[8. Module → EventBus]
bootstrap에서 설정한 핸들러:
  cashu.on('mint-op:finalized', (event) => {
    eventBus.emit({
      type: 'payment:completed',
      payload: { txId: event.quoteId, method: 'cashu:lightning', amount: sat(1000) }
    })
  })

[9. EventBus → Service → Store → UI]
eventBus.emit('payment:completed')
  → bootstrap 핸들러:
      balanceAggregator.getByModule() → CashuModule.getBalance()
        → backend.getBalances() → manager.wallet.getBalances()
        → { 'https://mint.coinos.io': 16000 }  // 기존 15000 + 1000
      useAppStore.getState().setBalances(newBalances, sat(16000))
  → React 리렌더 → 홈 화면 잔액 16,000 sat 표시

[10. 거래 기록]
bootstrap 핸들러 (또는 PaymentService 내부):
  → txRepo.save({
      id: 'abc123',
      direction: 'receive',
      method: 'cashu:lightning',
      protocol: 'bolt11',
      amount: sat(1000),
      accountId: 'https://mint.coinos.io',
      status: 'completed',
      createdAt: ...,
      completedAt: Date.now(),
    })
```

### 수신 흐름의 특징 (송금과 다른 점)

| | 송금 (send) | 수신 (receive) |
|---|---|---|
| **시작** | 사용자가 즉시 실행 | 사용자가 요청 생성 후 **대기** |
| **완료 주체** | adapter.executeSend() | **Coco Watcher** (백그라운드) |
| **완료 시점** | Service에서 직접 감지 | EventBus로 비동기 전달 |
| **거래 기록** | Service.send() 안에서 저장 | EventBus 핸들러에서 저장 |

수신은 **2단계 비동기** — 요청 생성(동기) + 결제 감지(비동기). Coco의 MintOperationWatcher가 백그라운드에서 폴링하고, 완료 시 이벤트를 발행하면 bootstrap이 EventBus → Store → UI로 전파한다.
