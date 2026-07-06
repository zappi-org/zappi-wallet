import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_RELAYS } from '@/core/constants'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import type { WalletSettings } from '@/core/types'
import { useAppStore } from '@/store'
import { broadcastSync } from '@/utils/cross-tab-sync'
import { generateMintAliases } from '@/utils/mint-name'
import { normalizeMintUrl, isSameMintUrl } from '@/utils/url'

/**
 * 민트 훅이 쓰는 레지스트리 표면 — 포트(ServiceRegistry) + BootstrapResult 확장분
 * trustMint만 구조적으로 요구 (composition 타입 비의존).
 */
export type MintHandlersRegistry = ServiceRegistry & {
  trustMint(mintUrl: string): Promise<void>
}

export interface UseMintHandlersDeps {
  serviceRegistry: MintHandlersRegistry | null
  /** preUnlock.settingsRepo — 설정 영속 저장소 (unlock 전에도 존재) */
  settingsRepo: { saveSettings(settings: WalletSettings): Promise<void> }
}

export interface MintHandlers {
  handleSaveSettings: (newSettings: Record<string, unknown>) => Promise<void>
  handleAddTrustedMint: (mintUrl: string) => Promise<boolean>
}

/**
 * 민트/설정 핸들러 묶음 (MainApp Phase 4b 순수 이동): 설정 저장(+프로필 재발행,
 * relay 재연결), 신뢰 민트 추가(+시드 복원). republishProfile은 이 두 핸들러만
 * 사용하므로 훅 내부에 캡슐화.
 */
export function useMintHandlers(deps: UseMintHandlersDeps): MintHandlers {
  const { serviceRegistry, settingsRepo } = deps
  const { t } = useTranslation()

  const settings = useAppStore((state) => state.settings)
  const setSettings = useAppStore((state) => state.setSettings)
  const nostrPubkey = useAppStore((state) => state.nostrPubkey)
  const p2pkPubkey = useAppStore((state) => state.p2pkPubkey)

  /** Profile republish — bootstrap의 profileService 경유 */
  const republishProfile = useCallback(async (mints: string[], relays: string[]) => {
    if (!serviceRegistry || !nostrPubkey || !p2pkPubkey) return
    try {
      await serviceRegistry.profile.publishAll(nostrPubkey, mints, relays, p2pkPubkey)
      console.log('[Profile] Republished successfully')
    } catch (e) {
      console.warn('[Profile] Failed to republish:', e)
    }
  }, [serviceRegistry, nostrPubkey, p2pkPubkey])

  const handleSaveSettings = useCallback(async (newSettings: Record<string, unknown>): Promise<void> => {
    const mergedSettings = { ...settings, ...newSettings }
    setSettings(mergedSettings)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await settingsRepo.saveSettings(mergedSettings as any)

    const newMints = newSettings.mints as string[] | undefined
    const newRelays = newSettings.relays as string[] | undefined
    // 집합 동등성 비교 (설계 §10 B6): 순서만 바뀐 relay 드래그 커밋마다 프로필
    // 3건(nutzap-info/relay-list/DM-relay-list)이 재발행되던 것을 생략한다 —
    // relay 이벤트는 집합 의미라 순서 변경은 재발행 사유가 아니다.
    // mints는 **순서 비교 유지** (6단계 리뷰 #2): 10019의 mint 목록 순서가
    // 수신 선호를 나타낼 수 있어 재정렬도 재발행 사유다.
    const sameSet = (a: string[], b: string[]) => {
      const sa = new Set(a)
      const sb = new Set(b)
      return sa.size === sb.size && [...sa].every((x) => sb.has(x))
    }
    const mintsChanged = newMints && JSON.stringify(newMints) !== JSON.stringify(settings.mints)
    const relaysChanged = newRelays && !sameSet(newRelays, settings.relays)

    if ((mintsChanged || relaysChanged) && p2pkPubkey) {
      republishProfile(newMints || settings.mints, newRelays || settings.relays)
    }
    // persistent 집합 재확립 (설계 §10 B3 — 6단계 리뷰 #1): relay 설정 변경은
    // 게이트웨이의 연결 대상도 갱신해야 한다. 레거시 경로는 다음 fetch의 암묵
    // connect가 처리했지만 컨트롤러 경로는 명시 호출이 유일한 확립 지점이다.
    if (relaysChanged && serviceRegistry) {
      const nextRelays = newRelays || settings.relays
      serviceRegistry.nostrGateway
        .connect([...new Set([...DEFAULT_RELAYS, ...nextRelays])])
        .catch((e) => console.warn('[App] relay reconnect failed:', e))
    }
    broadcastSync('settings_changed')
  }, [settingsRepo, settings, setSettings, p2pkPubkey, republishProfile, serviceRegistry])

  // Handle adding a trusted mint (from receive screen)
  const handleAddTrustedMint = useCallback(async (mintUrl: string): Promise<boolean> => {
    try {
      if (!serviceRegistry) {
        console.warn('[App] ServiceRegistry not ready — cannot add trusted mint')
        return false
      }

      const url = normalizeMintUrl(mintUrl)

      if (settings.mints.some((mint) => isSameMintUrl(mint, url))) {
        await serviceRegistry.trustMint(url)
        return true
      }

      // 직접 fetch → facade probe (설계 §5): 신뢰 추가는 "지금 유효한가" 검증이라
      // fresh probe — 응답은 metadata 캐시에 역주입되어 이후 화면들이 재사용한다
      const info = await serviceRegistry.mintInfo.getInfo(url, { fresh: true })
      if (!info || (!info.name && !info.pubkey)) {
        console.error('[App] Invalid or unreachable mint info')
        return false
      }

      const newMints = [...settings.mints, url]
      const newAliases = generateMintAliases(
        newMints,
        settings.mintAliases,
        (number) => t('mintDetail.defaultName', { number }),
      )
      const nextSettings = { ...settings, mints: newMints, mintAliases: newAliases }

      await settingsRepo.saveSettings(nextSettings)
      setSettings(nextSettings)

      try {
        await serviceRegistry.trustMint(url)
      } catch (trustError) {
        await settingsRepo.saveSettings(settings).catch((rollbackError) => {
          console.error('[App] Failed to rollback settings after mint trust failure:', rollbackError)
        })
        setSettings(settings)
        throw trustError
      }

      if (p2pkPubkey) {
        republishProfile(nextSettings.mints, nextSettings.relays)
      }

      // 시드 기반 잔액 복원 — 소유자 결정(설계 §6.3 편차): 재설치·재추가 사용자는
      // 이 민트에 잔액이 있었는지 알 수 없어 유실로 오인한다. 이 경로는 수신
      // 모달 도중이라 fire-and-forget — 완료 시 balance:changed가 화면을 갱신.
      serviceRegistry.payment
        .recoverAccounts({ accountIds: [url] })
        .catch((e) => console.warn('[App] Seed restore after trust failed:', e))

      console.log('[App] Added trusted mint:', url)
      broadcastSync('settings_changed')
      return true
    } catch (error) {
      console.error('[App] Failed to add trusted mint:', error)
      return false
    }
  }, [settings, settingsRepo, setSettings, p2pkPubkey, republishProfile, t, serviceRegistry])

  return { handleSaveSettings, handleAddTrustedMint }
}
