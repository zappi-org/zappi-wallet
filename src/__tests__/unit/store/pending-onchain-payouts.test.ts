import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { selectOnchainPayoutById, selectPendingOnchainPayouts } from '@/store/selectors'
import type { OnchainPayoutView } from '@/core/ports/driving/onchain-payout.usecase'

function view(patch: Partial<OnchainPayoutView>): OnchainPayoutView {
  return {
    id: 'payout',
    mintUrl: 'https://mint.example.com',
    offerId: 'fake:offer-1',
    identifier: 'npub1fake',
    destination: 'bcrt1qdestination',
    sendAmount: 100000,
    receiveAmount: 99000,
    stage: 'paying',
    phase: 'submitted',
    payoutTxId: null,
    failureReason: null,
    hasOpenPayments: false,
    deadline: { blockHeight: 209, estimatedAt: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

describe('selectPendingOnchainPayouts', () => {
  beforeEach(() => {
    useAppStore.getState().resetOnchainPayouts()
  })

  it('keeps unfinished payouts and finished ones whose payments are still open', () => {
    useAppStore.getState().setOnchainPayouts([
      view({ id: 'paying', stage: 'paying', createdAt: 1 }),
      view({ id: 'completed', stage: 'completed' }),
      view({ id: 'refunded', stage: 'refunded' }),
      view({ id: 'aborted', stage: 'aborted' }),
      view({ id: 'aborted-open', stage: 'aborted', hasOpenPayments: true, createdAt: 3 }),
      view({ id: 'sweeping', stage: 'sweeping', createdAt: 2 }),
    ])
    const pending = selectPendingOnchainPayouts(useAppStore.getState())
    expect(pending.map((payout) => payout.id)).toEqual(['aborted-open', 'sweeping', 'paying'])
  })

  it('drops a payout from the pending list once an update marks it finished', () => {
    useAppStore.getState().setOnchainPayouts([view({ id: 'payout-1', stage: 'sweeping' })])
    expect(selectPendingOnchainPayouts(useAppStore.getState())).toHaveLength(1)
    useAppStore.getState().upsertOnchainPayout(view({ id: 'payout-1', stage: 'completed' }))
    expect(selectPendingOnchainPayouts(useAppStore.getState())).toEqual([])
  })

  it('returns the same array while the source list is unchanged', () => {
    useAppStore.getState().setOnchainPayouts([view({ id: 'payout-1' })])
    const first = selectPendingOnchainPayouts(useAppStore.getState())
    const second = selectPendingOnchainPayouts(useAppStore.getState())
    expect(second).toBe(first)
  })

  it('looks up any stored payout by id, including finished ones', () => {
    useAppStore.getState().setOnchainPayouts([view({ id: 'payout-1', stage: 'completed' })])
    expect(selectOnchainPayoutById('payout-1')(useAppStore.getState())?.stage).toBe('completed')
    expect(selectOnchainPayoutById(null)(useAppStore.getState())).toBeNull()
    expect(selectOnchainPayoutById('missing')(useAppStore.getState())).toBeNull()
  })
})
