import { amount as amt, sat, toNumber } from '@/core/domain/amount'
import type { Transaction, TransactionIntent, TransactionOutcome, TransactionStatus } from '@/core/domain/transaction'
import type {
  TransactionFilter,
  TransactionRepository,
} from '@/core/ports/driven/transaction.repository.port'
import type { Transaction as LegacyTransaction } from '@/core/types'
import { getDatabase } from './schema'

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
  const metaFee = legacy.metadata?.fee as number | undefined
  const amountDomain = sat(legacy.amount)
  
  return {
    id: legacy.id,
    direction: legacy.direction,
    method: TYPE_TO_METHOD[legacy.type] ?? 'cashu:lightning',
    protocol: TYPE_TO_PROTOCOL[legacy.type] ?? 'bolt11',
    amount: amountDomain,
    accountId: legacy.mintUrl,
    status,
    outcome,
    createdAt: legacy.createdAt,
    completedAt: legacy.completedAt,
    expiresAt: legacy.expiresAt,
    memo: legacy.memo,
    intent: TYPE_TO_INTENT[legacy.type],
    linkedTxId: legacy.metadata?.linkedTxId as string | undefined,
    displaySnapshot: legacy.fiatAmount != null ? {
      amount: legacy.fiatAmount,
      currency: legacy.fiatCurrency ?? 'USD',
      rate: legacy.exchangeRate ?? 0,
    } : undefined,
    fee: metaFee != null ? { quoted: amt(metaFee, amountDomain.unit) } : undefined,
    metadata: {
      ...(legacy.metadata ?? {}),
      // legacy 고유 필드를 metadata에 보존
      ...(legacy.token != null && { token: legacy.token }),
      ...(legacy.tokenState != null && { tokenState: legacy.tokenState }),
      ...(legacy.operationId != null && { operationId: legacy.operationId }),
      ...(legacy.bolt11 != null && { bolt11: legacy.bolt11 }),
      ...(legacy.preimage != null && { preimage: legacy.preimage }),
      ...(legacy.source != null && { source: legacy.source }),
    },
  }
}

function toLegacy(domain: Transaction): LegacyTransaction {
  const meta = domain.metadata ?? {}
  const { status, failureReason } = domainStatusToLegacy(domain.status, domain.outcome)
  const feeNumber = domain.fee
    ? toNumber(domain.fee.effective ?? domain.fee.quoted)
    : undefined
  
  return {
    id: domain.id,
    direction: domain.direction,
    type: methodToLegacyType(domain.method, domain.protocol, domain.intent) as LegacyTransaction['type'],
    amount: toNumber(domain.amount),
    mintUrl: domain.accountId,
    status,
    createdAt: domain.createdAt,
    completedAt: domain.completedAt,
    expiresAt: domain.expiresAt,
    memo: domain.memo,
    failureReason,
    metadata: {
      ...meta,
      ...(domain.linkedTxId != null && { linkedTxId: domain.linkedTxId }),
      ...(domain.intent != null && { intent: domain.intent }),
      ...(feeNumber != null && { fee: feeNumber }),
    },
    // legacy flat 필드 복원
    token: meta.token as string | undefined,
    tokenState: meta.tokenState as LegacyTransaction['tokenState'],
    operationId: meta.operationId as string | undefined,
    bolt11: meta.bolt11 as string | undefined,
    preimage: meta.preimage as string | undefined,
    source: meta.source as LegacyTransaction['source'],
    fiatAmount: domain.displaySnapshot?.amount,
    fiatCurrency: domain.displaySnapshot?.currency,
    exchangeRate: domain.displaySnapshot?.rate,
  }
}

export class DexieTransactionRepository implements TransactionRepository {
  private get table() {
    return getDatabase().transactions
  }

  async save(tx: Transaction): Promise<void> {
    await this.table.put(toLegacy(tx))
  }

  async getById(id: string): Promise<Transaction | null> {
    const legacy = await this.table.get(id)
    return legacy ? toDomain(legacy) : null
  }

  async list(filter?: TransactionFilter): Promise<Transaction[]> {
    let results: LegacyTransaction[]

    if (filter?.direction) {
      results = (await this.table.where('direction').equals(filter.direction).sortBy('createdAt')).reverse()
    } else if (filter?.status) {
      const legacyStatus = filter.status === 'settled' ? 'completed' : filter.status
      results = (await this.table.where('status').equals(legacyStatus).sortBy('createdAt')).reverse()
    } else if (filter?.accountId) {
      results = (await this.table.where('mintUrl').equals(filter.accountId).sortBy('createdAt')).reverse()
    } else {
      let query = this.table.orderBy('createdAt').reverse()
      if (filter?.offset) query = query.offset(filter.offset)
      if (filter?.limit) query = query.limit(filter.limit)
      results = await query.toArray()
    }

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
    let query = this.table.orderBy('createdAt').reverse()
    if (filter?.limit) query = query.limit(filter.limit)
    const results = await query.toArray()
    return results.map(toDomain)
  }

  async deleteAll(): Promise<void> {
    await this.table.clear()
  }

  async deleteOlderThan(days: number): Promise<void> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    await this.table.where('createdAt').below(cutoff).delete()
  }


  async delete(id: string): Promise<void> {
    await this.table.delete(id)
  }
  async update(id: string, patch: Partial<Transaction>): Promise<void> {
    const legacyPatch: Partial<LegacyTransaction> = {}
    let existing: LegacyTransaction | undefined

    const getExisting = async () => {
      existing ??= await this.table.get(id)
      return existing
    }

    if (patch.status !== undefined || patch.outcome !== undefined) {
      const mapped = domainStatusToLegacy(patch.status ?? 'pending', patch.outcome)
      if (patch.status !== undefined) legacyPatch.status = mapped.status
      if (mapped.failureReason !== undefined) legacyPatch.failureReason = mapped.failureReason
      if (mapped.tokenState !== undefined) (legacyPatch as Record<string, unknown>).tokenState = mapped.tokenState
    }
    if (patch.method !== undefined || patch.protocol !== undefined) {
      const existingTx = await getExisting()
      if (existingTx) {
        const method = patch.method ?? TYPE_TO_METHOD[existingTx.type] ?? 'cashu:lightning'
        const protocol = patch.protocol ?? TYPE_TO_PROTOCOL[existingTx.type] ?? 'bolt11'
        legacyPatch.type = methodToLegacyType(method, protocol, patch.intent) as LegacyTransaction['type']
      }
    }
    if (patch.completedAt !== undefined) legacyPatch.completedAt = patch.completedAt
    if (patch.memo !== undefined) legacyPatch.memo = patch.memo
    if (patch.fee !== undefined) {
      const feeNumber = patch.fee
        ? toNumber(patch.fee.effective ?? patch.fee.quoted)
        : undefined
      const existingTx = await getExisting()
      if (!legacyPatch.metadata) legacyPatch.metadata = { ...(existingTx?.metadata ?? {}) }
      if (feeNumber != null) {
        (legacyPatch.metadata as Record<string, unknown>).fee = feeNumber
      }
    }
    if (patch.metadata !== undefined) {
      const existingTx = await getExisting()
      legacyPatch.metadata = { ...(existingTx?.metadata ?? {}), ...patch.metadata }
      // metadata → flat 필드 동기화 (toLegacy와 동일한 매핑)
      const meta = legacyPatch.metadata as Record<string, unknown>
      if (meta.token !== undefined) legacyPatch.token = meta.token as string | undefined
      if (meta.operationId !== undefined) legacyPatch.operationId = meta.operationId as string | undefined
      if (meta.bolt11 !== undefined) legacyPatch.bolt11 = meta.bolt11 as string | undefined
      if (meta.preimage !== undefined) legacyPatch.preimage = meta.preimage as string | undefined
      if (meta.tokenState !== undefined) (legacyPatch as Record<string, unknown>).tokenState = meta.tokenState
    }

    await this.table.update(id, legacyPatch)
  }
}
