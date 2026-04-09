import { useState, useEffect, useCallback, useContext } from 'react'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import type { PendingItem } from '@/core/ports/driving/pending-items.usecase'

export type { PendingItem }

// ─── Hooks ───

export function usePendingItems(mintUrl: string) {
  const registry = useContext(ServiceContext)
  const [items, setItems] = useState<PendingItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!registry?.pendingItems) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      const result = await registry.pendingItems.getByMint(mintUrl)
      setItems(result)
    } catch (e) {
      console.error('[usePendingItems] Failed to load:', e)
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [mintUrl, registry])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { items, isLoading, refresh }
}

/**
 * Hook to load pending items for ALL mints.
 */
export function useAllPendingItems(mintUrls: string[]) {
  const registry = useContext(ServiceContext)
  const [items, setItems] = useState<PendingItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const mintUrlsKey = mintUrls.join(',')

  const refresh = useCallback(async () => {
    if (!registry?.pendingItems) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      const result = await registry.pendingItems.getAll()
      setItems(result)
    } catch (e) {
      console.error('[useAllPendingItems] Failed to load:', e)
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [mintUrlsKey, registry]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refresh()
  }, [refresh])

  return { items, isLoading, refresh }
}
