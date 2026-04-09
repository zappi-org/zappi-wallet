import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useWallet, useMintMetadata } from '@/ui/hooks'
import { getMintBalance } from '@/utils/url'
import type { MintInfo } from '@/core/types'

/**
 * Build MintInfo[] from store settings + metadata + balance.
 * Shared by HistoryScreen and PendingItemsScreen for mint filter UI.
 */
export function useAvailableMints(extraUrls?: string[]) {
  const settings = useAppStore((state) => state.settings)

  const mintUrls = useMemo(() => {
    if (!extraUrls?.length) return [...settings.mints]
    const urls = new Set<string>(settings.mints)
    extraUrls.forEach((url) => urls.add(url))
    return Array.from(urls)
  }, [settings.mints, extraUrls])

  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)
  const { balance } = useWallet()

  const availableMints: MintInfo[] = useMemo(() => {
    return settings.mints.map((url) => ({
      url,
      name: getDisplayName(url),
      alias: settings.mintAliases?.[url],
      balance: getMintBalance(url, balance.byMint),
      iconUrl: getIconUrl(url),
      isOnline: true,
    }))
  }, [settings.mints, settings.mintAliases, balance.byMint, getDisplayName, getIconUrl])

  return { availableMints, getDisplayName, getIconUrl }
}

/**
 * Get display label for mint filter button.
 */
export function getMintFilterLabel(
  selectedUrls: Set<string>,
  getDisplayName: (url: string) => string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (selectedUrls.size === 0) return t('history.allMints')
  if (selectedUrls.size === 1) {
    const url = Array.from(selectedUrls)[0]
    return getDisplayName(url)
  }
  return t('history.mintCount', { count: selectedUrls.size })
}
