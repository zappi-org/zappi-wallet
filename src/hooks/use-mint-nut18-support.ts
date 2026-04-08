import { useSyncExternalStore, useCallback, useRef } from 'react'
import { useServiceRegistry } from './use-service-registry'

/**
 * Hook to check if a mint supports NUT-18 HTTP POST transport.
 * Uses useSyncExternalStore to avoid set-state-in-effect lint issues.
 */
export function useMintNut18Support(mintUrl: string | null) {
  const { mintMetadata } = useServiceRegistry()
  const cacheRef = useRef<{ url: string | null; value: boolean }>({ url: null, value: false })
  const listenersRef = useRef<Set<() => void>>(new Set())

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener)
    return () => { listenersRef.current.delete(listener) }
  }, [])

  const getSnapshot = useCallback(() => {
    if (mintUrl !== cacheRef.current.url) {
      cacheRef.current = { url: mintUrl, value: false }

      if (mintUrl) {
        mintMetadata.supports(mintUrl, 18).then((supported) => {
          if (cacheRef.current.url === mintUrl && cacheRef.current.value !== supported) {
            cacheRef.current = { url: mintUrl, value: supported }
            for (const listener of listenersRef.current) listener()
          }
        }).catch(() => {
          // Keep false
        })
      }
    }
    return cacheRef.current.value
  }, [mintUrl, mintMetadata])

  const supportsHttp = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return { supportsHttp }
}
