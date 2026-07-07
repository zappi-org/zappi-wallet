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

// Pin the mint we failed over to as session-preferred, so the next ensureOnlineMint
// doesn't probe the dead mint first. Not render state, so a module variable rather
// than the store.
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

    // No metadata chain call: the health probe back-injects successful responses into
    // metadata (MintInfoService.ingest), so a separate refreshIfMissing would be a
    // double hit on the same endpoint.
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

  // No reconnect refresh effect: it duplicated a listener per hook instance (mounted
  // in 3 places); bootstrap activate's single 'online' listener replaced it.

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
