import Dexie, { type Table } from 'dexie'
import { isPayoutStageTerminal } from '@/core/domain/swap-out'
import type {
  SwapOutPayment,
  SwapOutRecord,
  SwapOutStore,
  SwapOutUpdate,
} from '@/core/ports/driven/swap-out-store.port'
import {
  decryptAtRest,
  encryptAtRest,
  type EncryptedAtRest,
} from '../storage-key'

const DATABASE_NAME = 'zappi-swap-out'
const TABLE_NAME = 'payouts'

interface SwapOutRow extends SwapOutRecord {
  secretsEnc: EncryptedAtRest
}

interface SwapOutDatabase extends Dexie {
  payouts: Table<SwapOutRow, string>
}

function openDatabase(): SwapOutDatabase {
  const db = new Dexie(DATABASE_NAME, {
    chromeTransactionDurability: 'strict',
  }) as SwapOutDatabase
  db.version(1).stores({ [TABLE_NAME]: 'id, stage, createdAt' })
  return db
}

function toRecord(row: SwapOutRow): SwapOutRecord {
  const { secretsEnc: _secretsEnc, ...record } = row
  return record
}

function isActive(record: SwapOutRecord): boolean {
  if (!isPayoutStageTerminal(record.stage)) return true
  return record.payments.some(
    (payment) => payment.status === 'prepared' || payment.status === 'dispatched',
  )
}

export async function countActiveSwapOuts(): Promise<number> {
  if (!(await Dexie.exists(DATABASE_NAME))) return 0
  const db = openDatabase()
  try {
    const rows = await db.payouts.toArray()
    return rows.filter(isActive).length
  } finally {
    db.close()
  }
}

export async function clearSwapOuts(): Promise<void> {
  if (!(await Dexie.exists(DATABASE_NAME))) return
  const db = openDatabase()
  try {
    await db.payouts.clear()
  } finally {
    db.close()
  }
}

export async function deleteSwapOutDatabase(): Promise<void> {
  await Dexie.delete(DATABASE_NAME)
}

export class DexieSwapOutStore implements SwapOutStore {
  private readonly db = openDatabase()

  async create(record: SwapOutRecord, secrets: string): Promise<void> {
    const secretsEnc = await encryptAtRest(secrets)
    await this.db.transaction('rw', this.db.payouts, async () => {
      await this.db.payouts.put({ ...record, secretsEnc })
    })
  }

  async get(id: string): Promise<SwapOutRecord | null> {
    const row = await this.db.payouts.get(id)
    return row ? toRecord(row) : null
  }

  async update(
    id: string,
    expectedVersion: number,
    changes: SwapOutUpdate,
  ): Promise<boolean> {
    const { secrets, ...rest } = changes
    const secretsEnc = secrets === undefined ? undefined : await encryptAtRest(secrets)
    return this.db.transaction('rw', this.db.payouts, async () => {
      const row = await this.db.payouts.get(id)
      if (!row || row.version !== expectedVersion) return false
      const { secretsEnc: _previousSecrets, ...current } = row
      const merged: SwapOutRow = {
        ...current,
        ...rest,
        version: row.version + 1,
        secretsEnc: secretsEnc ?? row.secretsEnc,
      }
      await this.db.payouts.put(merged)
      return true
    })
  }

  async readSecrets(id: string): Promise<string | null> {
    const row = await this.db.payouts.get(id)
    if (!row) return null
    return decryptAtRest(row.secretsEnc)
  }

  async listActive(): Promise<SwapOutRecord[]> {
    const rows = await this.db.payouts.toArray()
    return rows.filter(isActive).map(toRecord)
  }

  async list(): Promise<SwapOutRecord[]> {
    const rows = await this.db.payouts.toArray()
    return rows
      .map(toRecord)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  async wipe(): Promise<void> {
    await this.db.payouts.clear()
  }
}

export type { SwapOutPayment }
