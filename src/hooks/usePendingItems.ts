import { useState, useEffect, useCallback } from 'react'
import { getDatabase } from '@/data/database/schema'
import { stripTrailingSlash } from '@/utils/url'
import { getPendingReceiveRequests } from '@/services/receive-request'

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
  // ReceiveRequest data (for receive-request type)
  quoteId?: string
  invoice?: string
  ecashRequest?: string
  ecashRequestId?: string
  bip321Uri?: string
  httpEndpoint?: string
}

// ─── Shared transform: raw DB records → PendingItem[] ───

interface RawSources {
  receivedTokens: Array<{ id: string; amount: number; mintUrl: string; createdAt: number; token: string }>
  receiveRequests: Array<{
    id: string; amount: number; mintUrl: string; createdAt: number; expiresAt: number
    quoteId: string; invoice: string
    ecashRequest?: string; ecashRequestId?: string; httpEndpoint?: string; bip321Uri?: string
  }>
  sendTokens: Array<{ id: string; amount: number; mintUrl: string; createdAt: number; token?: string; operationId?: string }>
  memoMap?: Map<string, string>
}

function mergePendingItems({ receivedTokens, receiveRequests, sendTokens, memoMap }: RawSources): PendingItem[] {
  const merged: PendingItem[] = [
    ...receivedTokens.map((t) => ({
      id: t.id,
      type: 'unclaimed-token' as const,
      amount: t.amount,
      mintUrl: t.mintUrl,
      createdAt: t.createdAt,
      token: t.token,
    })),
    ...receiveRequests.map((r) => ({
      id: r.id,
      type: 'receive-request' as const,
      amount: r.amount,
      mintUrl: r.mintUrl,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      quoteId: r.quoteId,
      invoice: r.invoice,
      ecashRequest: r.ecashRequest,
      ecashRequestId: r.ecashRequestId,
      bip321Uri: r.bip321Uri,
      httpEndpoint: r.httpEndpoint,
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
      const variants = [normalized, normalized + '/']

      const [receivedTokens, receiveRequests, sendTokens] = await Promise.all([
        db.pendingReceivedTokens.where('mintUrl').anyOf(variants).toArray(),
        getPendingReceiveRequests(variants),
        db.pendingSendTokens.where('mintUrl').anyOf(variants).toArray(),
      ])

      const memoMap = new Map<string, string>()
      if (sendTokens.length > 0) {
        const txs = await db.transactions.bulkGet(sendTokens.map((s) => s.id))
        txs.forEach((tx) => { if (tx?.memo) memoMap.set(tx.id, tx.memo) })
      }

      setItems(mergePendingItems({ receivedTokens, receiveRequests, sendTokens, memoMap }))
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

      const [receivedTokens, receiveRequests, sendTokens] = await Promise.all([
        db.pendingReceivedTokens.toArray(),
        getPendingReceiveRequests(),
        db.pendingSendTokens.toArray(),
      ])

      const memoMap = new Map<string, string>()
      if (sendTokens.length > 0) {
        const txs = await db.transactions.bulkGet(sendTokens.map((s) => s.id))
        txs.forEach((tx) => { if (tx?.memo) memoMap.set(tx.id, tx.memo) })
      }

      setItems(mergePendingItems({ receivedTokens, receiveRequests, sendTokens, memoMap }))
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
