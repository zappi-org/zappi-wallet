import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useServiceRegistry } from './use-service-registry'
import { useNetwork } from './use-network'
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
  const { mintHealth, mintMetadata } = useServiceRegistry()
  const { t } = useTranslation()
  const settingsMints = useAppStore((state) => state.settings.mints)
  const activeMintUrl = useAppStore((state) => state.activeMintUrl)
  const setActiveMint = useAppStore((state) => state.setActiveMint)
  const updateMintStatus = useAppStore((state) => state.updateMintStatus)
  const addToast = useAppStore((state) => state.addToast)
  const { networkState, wasOffline, clearWasOffline } = useNetwork()

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

    const statuses = await mintHealth.checkAllMints(mintUrls)
    statuses.forEach((s) => {
      updateMintStatus(s.url, s.isOnline)
      if (s.isOnline) {
        mintMetadata.refreshIfMissing(s.url).catch(() => {})
      }
    })
    return statuses
  }, [mintUrls, mintHealth, mintMetadata, updateMintStatus])

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

  useEffect(() => {
    if (networkState === 'ONLINE' && wasOffline) {
      checkAllMints().then(() => {
        clearWasOffline()
      })
    }
  }, [networkState, wasOffline, checkAllMints, clearWasOffline])

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
