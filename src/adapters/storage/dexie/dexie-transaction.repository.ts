import type {
  TransactionRepository,
  TransactionFilter,
} from '@/core/ports/driven/transaction.repository.port'
import type { Transaction, TransactionStatus, TransactionOutcome } from '@/core/domain/transaction'
import type { TransactionIntent } from '@/core/domain/transaction'
import type { Transaction as LegacyTransaction } from '@/core/types'
import { sat, toNumber } from '@/core/domain/amount'
import { getTransactionRepo } from '@/data/repositories/transaction.repository'

// legacy type → domain method 매핑
const TYPE_TO_METHOD: Record<string, string> = {
  lightning: 'cashu:lightning',
  ecash: 'cashu:ecash',
  'ecash-token': 'cashu:ecash',
  nutzap: 'cashu:ecash',
  swap: 'cashu:lightning',
}

const TYPE_TO_PROTOCOL: Record<string, string> = {
  lightning: 'bolt11',
  ecash: 'nut18',
  'ecash-token': 'cashu-token',
  nutzap: 'cashu-token',
  swap: 'bolt11',
}

// intent가 있는 type들
const TYPE_TO_INTENT: Record<string, TransactionIntent | undefined> = {
  swap: 'swap',
  nutzap: 'nutzap',
}

// domain method+protocol → legacy type 역매핑
function methodToLegacyType(method: string, protocol?: string, intent?: TransactionIntent): string {
  if (intent === 'swap') return 'swap'
  if (intent === 'nutzap') return 'nutzap'
  if (method === 'cashu:ecash' && protocol === 'cashu-token') return 'ecash-token'
  if (method === 'cashu:lightning') return 'lightning'
  if (method === 'cashu:ecash') return 'ecash'
  return 'lightning'
}

// ─── Legacy ↔ Domain status 변환 ───

function legacyStatusToDomain(legacy: LegacyTransaction): { status: TransactionStatus; outcome?: TransactionOutcome } {
  if (legacy.status === 'completed') {
    if (legacy.failureReason === 'reclaimed') {
      return { status: 'settled', outcome: 'reclaimed' }
    }
    return { status: 'settled', outcome: 'claimed' }
  }
  if (legacy.status === 'pending' && legacy.tokenState === 'unspent') {
    return { status: 'pending', outcome: 'unclaimed' }
  }
  // 'pending' | 'failed' 는 그대로
  return { status: legacy.status as TransactionStatus }
}

function domainStatusToLegacy(status: TransactionStatus, outcome?: TransactionOutcome): {
  status: LegacyTransaction['status']
  failureReason?: string
  tokenState?: string
} {
  if (status === 'settled') {
    if (outcome === 'reclaimed') {
      return { status: 'completed', failureReason: 'reclaimed', tokenState: 'spent' }
    }
    return { status: 'completed', tokenState: 'spent' }
  }
  if (status === 'pending' && outcome === 'unclaimed') {
    return { status: 'pending', tokenState: 'unspent' }
  }
  return { status }
}

function toDomain(legacy: LegacyTransaction): Transaction {
  const { status, outcome } = legacyStatusToDomain(legacy)
  return {
    id: legacy.id,
    direction: legacy.direction,
    method: TYPE_TO_METHOD[legacy.type] ?? 'cashu:lightning',
    protocol: TYPE_TO_PROTOCOL[legacy.type] ?? 'bolt11',
    amount: sat(legacy.amount),
    accountId: legacy.mintUrl,
    status,
    outcome,
    createdAt: legacy.createdAt,
    completedAt: legacy.completedAt,
    memo: legacy.memo,
    intent: TYPE_TO_INTENT[legacy.type],
    linkedTxId: legacy.metadata?.linkedTxId as string | undefined,
    metadata: {
      ...(legacy.metadata ?? {}),
      // legacy 고유 필드를 metadata에 보존
      ...(legacy.token != null && { token: legacy.token }),
      ...(legacy.tokenState != null && { tokenState: legacy.tokenState }),
      ...(legacy.operationId != null && { operationId: legacy.operationId }),
      ...(legacy.bolt11 != null && { bolt11: legacy.bolt11 }),
      ...(legacy.preimage != null && { preimage: legacy.preimage }),
      ...(legacy.source != null && { source: legacy.source }),
      ...(legacy.fiatAmount != null && { fiatAmount: legacy.fiatAmount }),
      ...(legacy.fiatCurrency != null && { fiatCurrency: legacy.fiatCurrency }),
      ...(legacy.exchangeRate != null && { exchangeRate: legacy.exchangeRate }),
    },
  }
}

function toLegacy(domain: Transaction): LegacyTransaction {
  const meta = domain.metadata ?? {}
  const { status, failureReason } = domainStatusToLegacy(domain.status, domain.outcome)
  return {
    id: domain.id,
    direction: domain.direction,
    type: methodToLegacyType(domain.method, domain.protocol, domain.intent) as LegacyTransaction['type'],
    amount: toNumber(domain.amount),
    mintUrl: domain.accountId,
    status,
    createdAt: domain.createdAt,
    completedAt: domain.completedAt,
    memo: domain.memo,
    failureReason,
    metadata: {
      ...meta,
      ...(domain.linkedTxId != null && { linkedTxId: domain.linkedTxId }),
      ...(domain.intent != null && { intent: domain.intent }),
    },
    // legacy flat 필드 복원
    token: meta.token as string | undefined,
    tokenState: meta.tokenState as LegacyTransaction['tokenState'],
    operationId: meta.operationId as string | undefined,
    bolt11: meta.bolt11 as string | undefined,
    preimage: meta.preimage as string | undefined,
    source: meta.source as LegacyTransaction['source'],
    fiatAmount: meta.fiatAmount as number | undefined,
    fiatCurrency: meta.fiatCurrency as string | undefined,
    exchangeRate: meta.exchangeRate as number | undefined,
  }
}

export class DexieTransactionRepository implements TransactionRepository {
  private get repo() {
    return getTransactionRepo()
  }

  async save(tx: Transaction): Promise<void> {
    await this.repo.save(toLegacy(tx))
  }

  async getById(id: string): Promise<Transaction | null> {
    const legacy = await this.repo.findById(id)
    return legacy ? toDomain(legacy) : null
  }

  async list(filter?: TransactionFilter): Promise<Transaction[]> {
    let results: LegacyTransaction[]

    if (filter?.direction) {
      results = await this.repo.findByDirection(filter.direction)
    } else if (filter?.status) {
      const legacyStatus = filter.status === 'settled' ? 'completed' : filter.status
      results = await this.repo.findByStatus(legacyStatus)
    } else if (filter?.accountId) {
      results = await this.repo.findByMint(filter.accountId)
    } else {
      results = await this.repo.findAll({
        limit: filter?.limit,
        offset: filter?.offset,
      })
    }

    // 추가 필터 적용 (기존 repo가 복합 필터를 지원 안 하므로)
    if (filter?.direction && filter?.status) {
      const legacyStatus = filter.status === 'settled' ? 'completed' : filter.status
      results = results.filter((tx) => tx.status === legacyStatus)
    }

    if (filter?.protocol) {
      const domainProtocol = filter.protocol
      results = results.filter((tx) => {
        const legacyProtocol = TYPE_TO_PROTOCOL[tx.type]
        return legacyProtocol === domainProtocol
      })
    }

    if (filter?.outcome) {
      results = results.filter((tx) => {
        if (filter.outcome === 'unclaimed') return tx.status === 'pending' && tx.tokenState === 'unspent'
        if (filter.outcome === 'claimed') return tx.status === 'completed' && tx.failureReason !== 'reclaimed'
        if (filter.outcome === 'reclaimed') return tx.status === 'completed' && tx.failureReason === 'reclaimed'
        return true
      })
    }

    if (filter?.limit && results.length > filter.limit) {
      results = results.slice(0, filter.limit)
    }

    return results.map(toDomain)
  }

  async findAll(filter?: { limit?: number }): Promise<Transaction[]> {
    const results = await this.repo.findAll({ limit: filter?.limit })
    return results.map(toDomain)
  }

  async deleteAll(): Promise<void> {
    await this.repo.deleteAll()
  }

  async deleteOlderThan(days: number): Promise<void> {
    await this.repo.deleteOlderThan(days)
  }

  async update(id: string, patch: Partial<Transaction>): Promise<void> {
    const legacyPatch: Partial<LegacyTransaction> = {}

    if (patch.status !== undefined || patch.outcome !== undefined) {
      const mapped = domainStatusToLegacy(patch.status ?? 'pending', patch.outcome)
      if (patch.status !== undefined) legacyPatch.status = mapped.status
      if (mapped.failureReason !== undefined) legacyPatch.failureReason = mapped.failureReason
      if (mapped.tokenState !== undefined) (legacyPatch as Record<string, unknown>).tokenState = mapped.tokenState
    }
    if (patch.protocol !== undefined) {
      // protocol 변경 시 기존 tx를 읽어서 method+protocol→type 역매핑
      const existing = await this.repo.findById(id)
      if (existing) {
        const method = patch.method ?? TYPE_TO_METHOD[existing.type] ?? 'cashu:lightning'
        legacyPatch.type = methodToLegacyType(method, patch.protocol, patch.intent) as LegacyTransaction['type']
      }
    }
    if (patch.completedAt !== undefined) legacyPatch.completedAt = patch.completedAt
    if (patch.memo !== undefined) legacyPatch.memo = patch.memo
    if (patch.metadata !== undefined) legacyPatch.metadata = patch.metadata

    await this.repo.update(id, legacyPatch)
  }
}
