/**
 * Cold-start balance cache backed by localStorage.
 *
 * Reads once during bootstrap so the UI can display the last known balance
 * before the wallet module refreshes from IndexedDB. Writes happen after
 * successful balance refreshes.
 */

import type { BalanceCache } from '@/core/ports/driven/balance-cache.port'
import type { ModuleBalance } from '@/core/ports/driven/wallet-module.port'
import type { Amount, Unit } from '@/core/domain/amount'

const CACHE_KEY = 'zappi-balance-cache'

interface SerializedAmount {
  value: string
  unit: Unit
}

interface SerializedAccount {
  id: string
  label: string
  amount: SerializedAmount
}

interface SerializedModuleBalance {
  moduleId: string
  accounts: SerializedAccount[]
  total: SerializedAmount
}

function serializeAmount(amount: Amount): SerializedAmount {
  return { value: String(amount.value), unit: amount.unit }
}

function deserializeAmount(raw: SerializedAmount): Amount {
  return { value: BigInt(raw.value), unit: raw.unit }
}

function serialize(balances: ModuleBalance[]): string {
  const data: SerializedModuleBalance[] = balances.map((mb) => ({
    moduleId: mb.moduleId,
    accounts: mb.accounts.map((a) => ({
      id: a.id,
      label: a.label,
      amount: serializeAmount(a.amount),
    })),
    total: serializeAmount(mb.total),
  }))
  return JSON.stringify(data)
}

function deserialize(json: string): ModuleBalance[] | null {
  try {
    const data = JSON.parse(json) as SerializedModuleBalance[]
    return data.map((mb) => ({
      moduleId: mb.moduleId,
      accounts: mb.accounts.map((a) => ({
        id: a.id,
        label: a.label,
        amount: deserializeAmount(a.amount),
      })),
      total: deserializeAmount(mb.total),
    }))
  } catch {
    return null
  }
}

export class LocalStorageBalanceCache implements BalanceCache {
  save(balances: ModuleBalance[]): void {
    try {
      localStorage.setItem(CACHE_KEY, serialize(balances))
    } catch {
      // Cache writes are an optimization; storage quota/private mode must not block wallet operation.
    }
  }

  load(): ModuleBalance[] | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (!raw) return null
      return deserialize(raw)
    } catch {
      return null
    }
  }

  clear(): void {
    localStorage.removeItem(CACHE_KEY)
  }
}
