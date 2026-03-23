import { useState, useEffect, useCallback } from 'react'
import { getDatabase } from '@/data/database/schema'
import { stripTrailingSlash } from '@/utils/url'

export interface PendingItem {
  id: string
  type: 'unclaimed-token' | 'receive-request' | 'sent-token'
  amount: number
  mintUrl: string
  memo?: string
  createdAt: number
  expiresAt?: number
  token?: string
  operationId?: string
}

// ─── Shared transform: raw DB records → PendingItem[] ───

interface RawSources {
  receivedTokens: Array<{ id: string; amount: number; mintUrl: string; createdAt: number; token: string }>
  cocoQuotes: Array<{ quote: string; amount: number; mintUrl: string; expiry?: number }>
  sendTokens: Array<{ id: string; amount: number; mintUrl: string; createdAt: number; token?: string; operationId?: string }>
  /** memo lookup from transactions table (sendToken.id → tx.memo) */
  memoMap?: Map<string, string>
}

function mergePendingItems({ receivedTokens, cocoQuotes, sendTokens, memoMap }: RawSources): PendingItem[] {
  const merged: PendingItem[] = [
    ...receivedTokens.map((t) => ({
      id: t.id,
      type: 'unclaimed-token' as const,
      amount: t.amount,
      mintUrl: t.mintUrl,
      createdAt: t.createdAt,
      token: t.token,
    })),
    ...cocoQuotes.map((q) => ({
      id: q.quote,
      type: 'receive-request' as const,
      amount: q.amount,
      mintUrl: q.mintUrl,
      createdAt: q.expiry ? (q.expiry - 600) * 1000 : Date.now(),
      expiresAt: q.expiry ? q.expiry * 1000 : undefined,
    })),
    ...sendTokens.map((s) => ({
      id: s.id,
      type: 'sent-token' as const,
      amount: s.amount,
      mintUrl: s.mintUrl,
      createdAt: s.createdAt,
      token: s.token,
      operationId: s.operationId,
      memo: memoMap?.get(s.id),
    })),
  ]

  // Filter out expired lightning requests
  const now = Date.now()
  const valid = merged.filter((item) => {
    if (item.expiresAt && item.expiresAt < now) return false
    return true
  })

  valid.sort((a, b) => b.createdAt - a.createdAt)
  return valid
}

// ─── Hooks ───

export function usePendingItems(mintUrl: string) {
  const [items, setItems] = useState<PendingItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const normalized = stripTrailingSlash(mintUrl)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const db = getDatabase()
      const { getPendingMintQuotes } = await import('@/coco/manager')
      const variants = [normalized, normalized + '/']

      const [receivedTokens, cocoQuotes, sendTokens] = await Promise.all([
        db.pendingReceivedTokens.where('mintUrl').anyOf(variants).toArray(),
        getPendingMintQuotes(),
        db.pendingSendTokens.where('mintUrl').anyOf(variants).toArray(),
      ])

      // Batch-fetch memos from transactions for send tokens
      const memoMap = new Map<string, string>()
      if (sendTokens.length > 0) {
        const txs = await db.transactions.bulkGet(sendTokens.map((s) => s.id))
        txs.forEach((tx) => { if (tx?.memo) memoMap.set(tx.id, tx.memo) })
      }

      // Filter Coco quotes by mintUrl
      const matchingQuotes = cocoQuotes.filter((q) =>
        stripTrailingSlash(q.mintUrl) === normalized
      )

      setItems(mergePendingItems({ receivedTokens, cocoQuotes: matchingQuotes, sendTokens, memoMap }))
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

/**
 * Hook to load pending items for ALL mints.
 * Used by PendingItemsScreen when accessed with mint filter support.
 */
export function useAllPendingItems(mintUrls: string[]) {
  const [items, setItems] = useState<PendingItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const mintUrlsKey = mintUrls.join(',')

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const db = getDatabase()
      const { getPendingMintQuotes } = await import('@/coco/manager')

      const [receivedTokens, cocoQuotes, sendTokens] = await Promise.all([
        db.pendingReceivedTokens.toArray(),
        getPendingMintQuotes(),
        db.pendingSendTokens.toArray(),
      ])

      // Batch-fetch memos from transactions for send tokens
      const memoMap = new Map<string, string>()
      if (sendTokens.length > 0) {
        const txs = await db.transactions.bulkGet(sendTokens.map((s) => s.id))
        txs.forEach((tx) => { if (tx?.memo) memoMap.set(tx.id, tx.memo) })
      }

      setItems(mergePendingItems({ receivedTokens, cocoQuotes, sendTokens, memoMap }))
    } catch (e) {
      console.error('[useAllPendingItems] Failed to load:', e)
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [mintUrlsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refresh()
  }, [refresh])

  return { items, isLoading, refresh }
}
