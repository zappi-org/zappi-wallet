import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useServiceRegistry } from './use-service-registry'
import type { MintHealthStatus } from '@/core/ports/driving/mint-health.usecase'

interface EnsureOnlineMintOptions {
  showToast?: boolean
  preferredMintUrl?: string
}

interface EnsureOnlineMintResult {
  mintUrl: string
  wasPreferred: boolean
}

// 폴백으로 갈아탄 민트를 세션 내 선호로 고착 — 다음 ensureOnlineMint가 죽은 민트를
// 다시 먼저 두드리지 않게 한다. 렌더에 쓰이지 않는 상태라 스토어가 아닌 모듈 변수
// (구 store.activeMintUrl 유령 상태의 실기능만 승계 — 감사 Phase 3 유령 상태 제거).
let stickyFallbackMint: string | null = null

/**
 * Hook for mint health checking and fallback logic
 */
export function useMintHealth() {
  const { mintHealth } = useServiceRegistry()
  const { t } = useTranslation()
  const settingsMints = useAppStore((state) => state.settings.mints)
  const addToast = useAppStore((state) => state.addToast)

  const mintUrls = settingsMints

  const checkMint = useCallback(
    async (mintUrl: string): Promise<MintHealthStatus> => {
      return mintHealth.checkMint(mintUrl)
    },
    [mintHealth]
  )

  const checkAllMints = useCallback(async (): Promise<MintHealthStatus[]> => {
    if (mintUrls.length === 0) return []

    // metadata 체인 호출 제거 (설계 §5): health probe가 성공 응답을 metadata에
    // 역주입하므로(MintInfoService.ingest) 별도 refreshIfMissing은 같은 endpoint의
    // 이중 타격이었다.
    return mintHealth.checkAllMints(mintUrls)
  }, [mintUrls, mintHealth])

  const ensureOnlineMint = useCallback(
    async (
      options?: EnsureOnlineMintOptions
    ): Promise<EnsureOnlineMintResult | null> => {
      if (mintUrls.length === 0) {
        if (options?.showToast) {
          addToast({ type: 'error', message: t('toast.noMintsRegistered') })
        }
        return null
      }

      const preferredMint = options?.preferredMintUrl || stickyFallbackMint || mintUrls[0]
      const result = await mintHealth.selectMintWithFallback(
        preferredMint,
        mintUrls
      )

      if (!result) {
        if (options?.showToast) {
          addToast({ type: 'error', message: t('toast.noReachableMints') })
        }
        return null
      }

      if (!result.wasPreferred) {
        stickyFallbackMint = result.mintUrl
        if (options?.showToast) {
          const mintName = getMintShortName(result.mintUrl)
          addToast({
            type: 'info',
            message: t('toast.mintSwitched', { name: mintName }),
          })
        }
      }

      return result
    },
    [mintUrls, addToast, t, mintHealth]
  )

  // 재연결 refresh effect 제거 (설계 §5): 훅 인스턴스(3곳 마운트)마다 리스너가
  // 중복 등록되던 것을 bootstrap activate의 단일 'online' 리스너가 대체했다.

  const getCachedStatus = useCallback(
    (mintUrl: string) => mintHealth.getCached(mintUrl),
    [mintHealth]
  )

  return {
    checkMint,
    checkAllMints,
    ensureOnlineMint,
    getCachedStatus,
  }
}

function getMintShortName(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.replace(/^mint\./, '').split('.')[0]
  } catch {
    return url
  }
}
