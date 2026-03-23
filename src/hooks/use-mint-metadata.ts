import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { mintMetadataService, metadataEvents } from '@/services/mint-metadata'
import { useAppStore } from '@/store'
import type { MintMetadata } from '@/core/types'

/**
 * Hook for accessing mint metadata (name, icon, etc.)
 * Uses cached data for offline support with reactive background refresh.
 *
 * - On mount / URL list change: loads from IndexedDB cache (+ fetches missing)
 * - Subscribes to metadata events: when service refreshes stale or
 *   newly-fetched metadata, React state updates automatically
 */
export function useMintMetadata(mintUrls: string[]) {
  const [metadataMap, setMetadataMap] = useState<Map<string, MintMetadata>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const mintUrlsKey = useMemo(() => mintUrls.join(','), [mintUrls])

  // Ref for latest mintUrls — avoids unnecessary re-runs from array reference changes
  const mintUrlsRef = useRef(mintUrls)
  useEffect(() => {
    mintUrlsRef.current = mintUrls
  })

  // Load metadata when URL list content changes
  useEffect(() => {
    const urls = mintUrlsRef.current
    if (urls.length === 0) return

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true)

    mintMetadataService
      .getMetadataForMints(urls)
      .then((result) => {
        setMetadataMap(result)
      })
      .catch((error) => {
        console.warn('[useMintMetadata] Failed to load metadata:', error)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [mintUrlsKey])

  // Subscribe to metadata update events (background refresh, health-triggered fetch, etc.)
  useEffect(() => {
    const unsubscribe = metadataEvents.subscribe((mintUrl, metadata) => {
      if (!mintUrlsRef.current.includes(mintUrl)) return
      setMetadataMap((prev) => {
        const next = new Map(prev)
        next.set(mintUrl, metadata)
        return next
      })
    })
    return unsubscribe
  }, [])

  const mintAliases = useAppStore((s) => s.settings.mintAliases)

  /**
   * Get display name for a mint (alias > metadata > hostname)
   * Deps include metadataMap & mintAliases — callback reference changes when data changes,
   * which signals downstream useMemo/useCallback consumers to recalculate.
   */
  const getDisplayName = useCallback(
    (mintUrl: string): string => {
      const alias = mintAliases?.[mintUrl]
      if (alias) return alias
      const metadata = metadataMap.get(mintUrl)
      if (metadata?.name) return metadata.name
      return mintMetadataService.extractHostname(mintUrl)
    },
    [metadataMap, mintAliases]
  )

  /**
   * Get original mint name from metadata (ignoring alias)
   */
  const getOriginalName = useCallback(
    (mintUrl: string): string => {
      const metadata = metadataMap.get(mintUrl)
      if (metadata?.name) return metadata.name
      return mintMetadataService.extractHostname(mintUrl)
    },
    [metadataMap]
  )

  /**
   * Get icon URL for a mint (from metadata)
   */
  const getIconUrl = useCallback(
    (mintUrl: string): string | undefined => {
      return metadataMap.get(mintUrl)?.iconUrl
    },
    [metadataMap]
  )

  /**
   * Get full metadata for a mint
   */
  const getMetadata = useCallback(
    (mintUrl: string): MintMetadata | undefined => {
      return metadataMap.get(mintUrl)
    },
    [metadataMap]
  )

  /**
   * Force refresh metadata for a mint
   * State update is handled by the event subscription automatically.
   */
  const refreshMetadata = useCallback(async (mintUrl: string) => {
    return mintMetadataService.refresh(mintUrl)
  }, [])

  return {
    metadataMap,
    isLoading,
    getDisplayName,
    getOriginalName,
    getIconUrl,
    getMetadata,
    refreshMetadata,
  }
}
