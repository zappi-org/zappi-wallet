import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { mintHealthService, type MintHealthStatus } from '@/ui/services/mint-health'
import { mintMetadataService } from '@/modules/cashu/metadata'
import { useNetwork } from './use-network'

interface EnsureOnlineMintOptions {
  showToast?: boolean
  preferredMintUrl?: string  // Override default preferred mint
}

interface EnsureOnlineMintResult {
  mintUrl: string
  wasPreferred: boolean
}

/**
 * Hook for mint health checking and fallback logic
 */
export function useMintHealth() {
  const { t } = useTranslation()
  // Use settings.mints (string[]) as the source of truth for mint URLs
  const settingsMints = useAppStore((state) => state.settings.mints)
  const activeMintUrl = useAppStore((state) => state.activeMintUrl)
  const setActiveMint = useAppStore((state) => state.setActiveMint)
  const updateMintStatus = useAppStore((state) => state.updateMintStatus)
  const addToast = useAppStore((state) => state.addToast)
  const { networkState, wasOffline, clearWasOffline } = useNetwork()

  const mintUrls = settingsMints

  /**
   * Check single mint status
   */
  const checkMint = useCallback(
    async (mintUrl: string): Promise<MintHealthStatus> => {
      const status = await mintHealthService.checkMint(mintUrl)
      updateMintStatus(mintUrl, status.isOnline)
      return status
    },
    [updateMintStatus]
  )

  /**
   * Check all mints in parallel
   */
  const checkAllMints = useCallback(async (): Promise<MintHealthStatus[]> => {
    if (mintUrls.length === 0) return []

    const statuses = await mintHealthService.checkAllMints(mintUrls)
    statuses.forEach((s) => {
      updateMintStatus(s.url, s.isOnline)
      if (s.isOnline) {
        // Fetch metadata for mints that were offline during initial load
        mintMetadataService.refreshIfMissing(s.url).catch(() => {})
      }
    })
    return statuses
  }, [mintUrls, updateMintStatus])

  /**
   * Ensure an online mint is available, with fallback to other mints
   * Returns the mint URL to use, or null if all mints are offline
   */
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
      const result = await mintHealthService.selectMintWithFallback(
        preferredMint,
        mintUrls
      )

      if (!result) {
        if (options?.showToast) {
          addToast({ type: 'error', message: t('toast.noReachableMints') })
        }
        return null
      }

      // Update status in store
      updateMintStatus(result.mintUrl, true)

      // If fallback occurred, notify user and update active mint
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
    [activeMintUrl, mintUrls, setActiveMint, updateMintStatus, addToast, t]
  )

  /**
   * Auto-check mints when device comes back online
   */
  useEffect(() => {
    if (networkState === 'ONLINE' && wasOffline) {
      checkAllMints().then(() => {
        clearWasOffline()
      })
    }
  }, [networkState, wasOffline, checkAllMints, clearWasOffline])

  /**
   * Get cached status (stable reference - doesn't cause re-renders)
   */
  const getCachedStatus = useCallback(
    (mintUrl: string) => mintHealthService.getCached(mintUrl),
    []
  )

  return {
    checkMint,
    checkAllMints,
    ensureOnlineMint,
    getCachedStatus,
  }
}

/**
 * Get short name from mint URL
 */
function getMintShortName(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.replace(/^mint\./, '').split('.')[0]
  } catch {
    return url
  }
}
