import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAppStore } from '@/store'
import { useServiceRegistry } from './use-service-registry'
import type { MintMetadata } from '@/core/types'

/**
 * Hook for accessing mint metadata (name, icon, etc.)
 * Uses cached data for offline support with reactive background refresh.
 */
export function useMintMetadata(mintUrls: string[]) {
  const { mintMetadata } = useServiceRegistry()
  const [metadataMap, setMetadataMap] = useState<Map<string, MintMetadata>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const mintUrlsKey = useMemo(() => mintUrls.join(','), [mintUrls])

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

    mintMetadata
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
  }, [mintUrlsKey, mintMetadata])

  // Subscribe to metadata update events
  useEffect(() => {
    const unsubscribe = mintMetadata.subscribe((mintUrl, metadata) => {
      if (!mintUrlsRef.current.includes(mintUrl)) return
      setMetadataMap((prev) => {
        const next = new Map(prev)
        next.set(mintUrl, metadata)
        return next
      })
    })
    return unsubscribe
  }, [mintMetadata])

  const mintAliases = useAppStore((s) => s.settings.mintAliases)

  const getDisplayName = useCallback(
    (mintUrl: string): string => {
      const alias = mintAliases?.[mintUrl]
      if (alias) return alias
      const metadata = metadataMap.get(mintUrl)
      if (metadata?.name) return metadata.name
      return mintMetadata.extractHostname(mintUrl)
    },
    [metadataMap, mintAliases, mintMetadata]
  )

  const getOriginalName = useCallback(
    (mintUrl: string): string => {
      const metadata = metadataMap.get(mintUrl)
      if (metadata?.name) return metadata.name
      return mintMetadata.extractHostname(mintUrl)
    },
    [metadataMap, mintMetadata]
  )

  const getIconUrl = useCallback(
    (mintUrl: string): string | undefined => {
      return metadataMap.get(mintUrl)?.iconUrl
    },
    [metadataMap]
  )

  const getMetadata = useCallback(
    (mintUrl: string): MintMetadata | undefined => {
      return metadataMap.get(mintUrl)
    },
    [metadataMap]
  )

  const refreshMetadata = useCallback(
    async (mintUrl: string) => {
      return mintMetadata.refresh(mintUrl)
    },
    [mintMetadata]
  )

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
