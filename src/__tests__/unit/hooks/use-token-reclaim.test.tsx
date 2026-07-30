import { sat } from '@/core/domain/amount'
import { Ok, Err } from '@/core/domain/result'
import { UnknownError } from '@/core/errors/base'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { ServiceProvider } from '@/ui/hooks/service-context'
import { useTokenReclaim } from '@/ui/hooks/use-token-reclaim'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// One shared spy: useTokenReclaim and its inner useReclaim both read addToast
// from this store. If the inner hook stopped honoring { silent } it would toast
// too, and the exactly-once assertions below would fail — that is the regression
// guard for the double-toast bug.
const addToastMock = vi.fn()
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: { addToast: typeof addToastMock }) => unknown) =>
    selector({ addToast: addToastMock }),
}))
vi.mock('@/utils/cross-tab-sync', () => ({
  broadcastSync: vi.fn(),
}))

function makeRegistry(
  reclaim: ReturnType<typeof vi.fn>,
  getById: ReturnType<typeof vi.fn>,
): ServiceRegistry {
  return {
    reclaim: { reclaim },
    transactionMgmt: { getById },
  } as unknown as ServiceRegistry
}

function renderReclaimToken(registry: ServiceRegistry) {
  return renderHook(() => useTokenReclaim(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ServiceProvider registry={registry}>{children}</ServiceProvider>
    ),
  })
}

describe('useTokenReclaim', () => {
  beforeEach(() => {
    addToastMock.mockClear()
  })

  it('toasts exactly once (success) — inner useReclaim is silenced', async () => {
    const reclaim = vi.fn().mockResolvedValue(
      Ok({ amount: { value: 500, unit: 'sat' }, accountId: 'mint-1' }),
    )
    const getById = vi.fn().mockResolvedValue({
      id: 'tx-1',
      amount: sat(500),
      accountId: 'mint-1',
    })

    const { result } = renderReclaimToken(makeRegistry(reclaim, getById))
    const res = await act(() => result.current.reclaimToken('tx-1'))

    expect(res.success).toBe(true)
    expect(addToastMock).toHaveBeenCalledTimes(1)
    expect(addToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    )
  })

  it('toasts exactly once (error) — inner useReclaim is silenced', async () => {
    const reclaim = vi.fn().mockResolvedValue(Err(new UnknownError('Rollback failed')))
    const getById = vi.fn().mockResolvedValue({
      id: 'tx-1',
      amount: sat(1000),
      accountId: 'mint-1',
    })

    const { result } = renderReclaimToken(makeRegistry(reclaim, getById))
    const res = await act(() => result.current.reclaimToken('tx-1'))

    expect(res.success).toBe(false)
    expect(addToastMock).toHaveBeenCalledTimes(1)
    expect(addToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    )
  })
})
