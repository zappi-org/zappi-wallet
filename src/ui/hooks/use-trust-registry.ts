/**
 * useTrustRegistry — TrustRegistry 포트 reactive wrapper
 *
 * Reads: Zustand `settings.mints` — 로컬 캐시로부터 동기 반응형 읽기
 * Writes: `TrustRegistry` 서비스 경유 후 Zustand 동기화
 *
 * 주의: 현재 저장소 스키마가 `settings.mints[]` 라서 cashu mint 용도에 한정.
 * 멀티 프로토콜 확장 시 Zustand 스키마 개편 필요.
 */

import { useCallback } from 'react'
import { useAppStore } from '@/store'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'

export function useTrustRegistry() {
  const registry = useServiceRegistry()
  const trustedAccounts = useAppStore((s) => s.settings.mints)
  const setSettings = useAppStore((s) => s.setSettings)

  const isTrusted = useCallback(
    (accountId: string) => trustedAccounts.includes(accountId),
    [trustedAccounts],
  )

  const addTrust = useCallback(
    async (accountId: string) => {
      await registry.trustRegistry.addTrust(accountId)
      const state = useAppStore.getState()
      if (!state.settings.mints.includes(accountId)) {
        setSettings({ ...state.settings, mints: [...state.settings.mints, accountId] })
      }
    },
    [registry, setSettings],
  )

  const revokeTrust = useCallback(
    async (accountId: string) => {
      await registry.trustRegistry.revokeTrust(accountId)
      const state = useAppStore.getState()
      setSettings({
        ...state.settings,
        mints: state.settings.mints.filter((m) => m !== accountId),
      })
    },
    [registry, setSettings],
  )

  return {
    trustedAccounts,
    isTrusted,
    addTrust,
    revokeTrust,
  }
}
