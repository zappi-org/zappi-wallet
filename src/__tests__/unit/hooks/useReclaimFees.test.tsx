/**
 * useReclaimFees — per-txId module cache
 *
 * Key invariants:
 * - Cache hits apply instantly with no network; only unquoted ids call quoteReclaim
 * - Only successes are cached (failures retry on next mount)
 * - TTL-expired entries are re-quoted
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useReclaimFees, clearReclaimFeeCache } from '@/ui/hooks/useReclaimFees'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { sat } from '@/core/domain/amount'

const quoteReclaim = vi.fn()
const registry = {
  payment: { quoteReclaim },
} as unknown as ServiceRegistry

function wrapper({ children }: { children: ReactNode }) {
  return <ServiceContext.Provider value={registry}>{children}</ServiceContext.Provider>
}

describe('useReclaimFees', () => {
  beforeEach(() => {
    clearReclaimFeeCache()
    quoteReclaim.mockReset()
    quoteReclaim.mockImplementation(async ({ transactionId }: { transactionId: string }) => ({
      ok: true,
      value: { fee: sat(transactionId === 'tx-a' ? 2 : 5) },
    }))
  })

  it('quotes uncached ids and records fees', async () => {
    const { result } = renderHook(() => useReclaimFees(['tx-a', 'tx-b']), { wrapper })

    await waitFor(() => expect(result.current.fees.size).toBe(2))
    expect(result.current.fees.get('tx-a')).toBe(2)
    expect(result.current.fees.get('tx-b')).toBe(5)
    expect(quoteReclaim).toHaveBeenCalledTimes(2)
  })

  it('cache hit skips the network on remount — eliminates N×(prepare+cancel) on tab revisit', async () => {
    const first = renderHook(() => useReclaimFees(['tx-a']), { wrapper })
    await waitFor(() => expect(first.result.current.fees.size).toBe(1))
    first.unmount()
    quoteReclaim.mockClear()

    const second = renderHook(() => useReclaimFees(['tx-a']), { wrapper })
    await waitFor(() => expect(second.result.current.fees.get('tx-a')).toBe(2))
    expect(quoteReclaim).not.toHaveBeenCalled()
  })

  it('quotes only the uncached subset and merges with cached fees', async () => {
    const first = renderHook(() => useReclaimFees(['tx-a']), { wrapper })
    await waitFor(() => expect(first.result.current.fees.size).toBe(1))
    first.unmount()
    quoteReclaim.mockClear()

    const second = renderHook(() => useReclaimFees(['tx-a', 'tx-b']), { wrapper })
    await waitFor(() => expect(second.result.current.fees.size).toBe(2))
    expect(quoteReclaim).toHaveBeenCalledTimes(1)
    expect(quoteReclaim).toHaveBeenCalledWith({ transactionId: 'tx-b' })
  })

  it('failures are not cached — retries on next mount', async () => {
    quoteReclaim.mockResolvedValueOnce({ ok: false, error: { message: 'quote failed' } })
    const first = renderHook(() => useReclaimFees(['tx-a']), { wrapper })
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))
    expect(first.result.current.fees.size).toBe(0)
    first.unmount()

    const second = renderHook(() => useReclaimFees(['tx-a']), { wrapper })
    await waitFor(() => expect(second.result.current.fees.get('tx-a')).toBe(2))
    expect(quoteReclaim).toHaveBeenCalledTimes(2)
  })

  it('empty id list yields an empty map without quoting', async () => {
    const { result } = renderHook(() => useReclaimFees([]), { wrapper })
    await waitFor(() => expect(result.current.fees.size).toBe(0))
    expect(quoteReclaim).not.toHaveBeenCalled()
  })
})
