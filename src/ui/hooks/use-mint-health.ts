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

/**
 * Hook for mint health checking and fallback logic
 */
export function useMintHealth() {
  const { mintHealth } = useServiceRegistry()
  const { t } = useTranslation()
  const settingsMints = useAppStore((state) => state.settings.mints)
  const activeMintUrl = useAppStore((state) => state.activeMintUrl)
  const setActiveMint = useAppStore((state) => state.setActiveMint)
  const updateMintStatus = useAppStore((state) => state.updateMintStatus)
  const addToast = useAppStore((state) => state.addToast)

  const mintUrls = settingsMints

  const checkMint = useCallback(
    async (mintUrl: string): Promise<MintHealthStatus> => {
      const status = await mintHealth.checkMint(mintUrl)
      updateMintStatus(mintUrl, status.isOnline)
      return status
    },
    [mintHealth, updateMintStatus]
  )

  const checkAllMints = useCallback(async (): Promise<MintHealthStatus[]> => {
    if (mintUrls.length === 0) return []

    // metadata 체인 호출 제거 (설계 §5): health probe가 성공 응답을 metadata에
    // 역주입하므로(MintInfoService.ingest) 별도 refreshIfMissing은 같은 endpoint의
    // 이중 타격이었다.
    const statuses = await mintHealth.checkAllMints(mintUrls)
    statuses.forEach((s) => {
      updateMintStatus(s.url, s.isOnline)
    })
    return statuses
  }, [mintUrls, mintHealth, updateMintStatus])

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

      const preferredMint = options?.preferredMintUrl || activeMintUrl || mintUrls[0]
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

      updateMintStatus(result.mintUrl, true)

      if (!result.wasPreferred) {
        setActiveMint(result.mintUrl)
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
    [activeMintUrl, mintUrls, setActiveMint, updateMintStatus, addToast, t, mintHealth]
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
