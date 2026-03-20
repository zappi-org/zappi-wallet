import { useState, useEffect, useCallback } from 'react'
import { getDatabase } from '@/data/database/schema'

export interface PendingItem {
  id: string
  type: 'unclaimed-token' | 'lightning-request' | 'ecash-request'
  amount: number
  mintUrl: string
  memo?: string
  createdAt: number
  expiresAt?: number
}

function normalizeUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

export function usePendingItems(mintUrl: string) {
  const [items, setItems] = useState<PendingItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const normalized = normalizeUrl(mintUrl)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const db = getDatabase()

      const { getPendingMintQuotes } = await import('@/coco/manager')

      const [receivedTokens, cocoQuotes, sendTokens] = await Promise.all([
        db.pendingReceivedTokens.where('mintUrl').anyOf([normalized, normalized + '/']).toArray(),
        getPendingMintQuotes(),
        db.pendingSendTokens.where('mintUrl').anyOf([normalized, normalized + '/']).toArray(),
      ])

      // Filter Coco quotes by mintUrl (matching the normalized URL pattern)
      const matchingQuotes = cocoQuotes.filter((q) => {
        const qNorm = normalizeUrl(q.mintUrl)
        return qNorm === normalized
      })

      const merged: PendingItem[] = [
        ...receivedTokens.map((t) => ({
          id: t.id,
          type: 'unclaimed-token' as const,
          amount: t.amount,
          mintUrl: t.mintUrl,
          createdAt: t.createdAt,
        })),
        ...matchingQuotes.map((q) => ({
          id: q.quote,
          type: 'lightning-request' as const,
          amount: q.amount,
          mintUrl: q.mintUrl,
          createdAt: q.expiry ? (q.expiry - 600) * 1000 : Date.now(), // estimate: expiry minus typical 10min window
          expiresAt: q.expiry ? q.expiry * 1000 : undefined,
        })),
        ...sendTokens.map((s) => ({
          id: s.id,
          type: 'ecash-request' as const,
          amount: s.amount,
          mintUrl: s.mintUrl,
          createdAt: s.createdAt,
        })),
      ]

      // Filter out expired lightning requests
      const now = Date.now()
      const valid = merged.filter((item) => {
        if (item.expiresAt && item.expiresAt < now) return false
        return true
      })

      valid.sort((a, b) => b.createdAt - a.createdAt)
      setItems(valid)
    } catch (e) {
      console.error('[usePendingItems] Failed to load:', e)
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [normalized])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { items, isLoading, refresh }
}
