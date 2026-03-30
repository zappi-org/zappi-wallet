import type {
  TransactionRepository,
  TransactionFilter,
} from '@/core/ports/driven/transaction.repository.port'
import type { Transaction } from '@/core/domain/transaction'
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

// domain method → legacy type 역매핑
function methodToLegacyType(method: string, intent?: TransactionIntent): string {
  if (intent === 'swap') return 'swap'
  if (intent === 'nutzap') return 'nutzap'
  if (method === 'cashu:lightning') return 'lightning'
  if (method === 'cashu:ecash') return 'ecash'
  return 'lightning'
}

function toDomain(legacy: LegacyTransaction): Transaction {
  return {
    id: legacy.id,
    direction: legacy.direction,
    method: TYPE_TO_METHOD[legacy.type] ?? 'cashu:lightning',
    protocol: TYPE_TO_PROTOCOL[legacy.type] ?? 'bolt11',
    amount: sat(legacy.amount),
    accountId: legacy.mintUrl,
    status: legacy.status,
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
  return {
    id: domain.id,
    direction: domain.direction,
    type: methodToLegacyType(domain.method, domain.intent) as LegacyTransaction['type'],
    amount: toNumber(domain.amount),
    mintUrl: domain.accountId,
    status: domain.status,
    createdAt: domain.createdAt,
    completedAt: domain.completedAt,
    memo: domain.memo,
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
      results = await this.repo.findByStatus(filter.status)
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
      results = results.filter((tx) => tx.status === filter.status)
    }

    if (filter?.limit && results.length > filter.limit) {
      results = results.slice(0, filter.limit)
    }

    return results.map(toDomain)
  }

  async update(id: string, patch: Partial<Transaction>): Promise<void> {
    const legacyPatch: Partial<LegacyTransaction> = {}

    if (patch.status !== undefined) legacyPatch.status = patch.status
    if (patch.completedAt !== undefined) legacyPatch.completedAt = patch.completedAt
    if (patch.memo !== undefined) legacyPatch.memo = patch.memo
    if (patch.metadata !== undefined) legacyPatch.metadata = patch.metadata

    await this.repo.update(id, legacyPatch)
  }
}
