/**
 * Balance Cache — localStorage를 이용한 cold start 잔액 캐시
 *
 * 앱 시작 시 SDK IndexedDB 조회 전에 이전 잔액을 즉시 표시하기 위한 캐시.
 * 읽기는 cold start 1회뿐, 이후에는 쓰기만 수행.
 *
 * 저장 대상: ModuleBalance[] (Amount의 bigint는 string으로 직렬화)
 */

import type { ModuleBalance } from '@/core/ports/driven/wallet-module.port'
import type { Amount, Unit } from '@/core/domain/amount'

const CACHE_KEY = 'zappi-balance-cache'

// ─── Serialization ───

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

// ─── Public API ───

export function saveBalanceCache(balances: ModuleBalance[]): void {
  try {
    localStorage.setItem(CACHE_KEY, serialize(balances))
  } catch {
    // localStorage full 등 — 무시
  }
}

export function loadBalanceCache(): ModuleBalance[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return deserialize(raw)
  } catch {
    return null
  }
}

export function clearBalanceCache(): void {
  localStorage.removeItem(CACHE_KEY)
}
