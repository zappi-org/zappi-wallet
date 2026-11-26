import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getProofsByOperationId: vi.fn(),
  getCocoManager: vi.fn(),
}))

vi.mock('./coco-sdk', () => ({
  getCocoManager: mocks.getCocoManager,
  getPendingMintQuotes: vi.fn(),
  getProofsByOperationId: mocks.getProofsByOperationId,
}))

import { heldAmounts } from './cashu-backend'

const MINT = 'https://mint.example.com'

function proof(patch: {
  amount: number
  secret?: string
  state?: string
  usedByOperationId?: string
  createdByOperationId?: string
  mintUrl?: string
}) {
  return {
    amount: patch.amount,
    secret: patch.secret ?? `secret-${patch.amount}`,
    state: patch.state ?? 'ready',
    mintUrl: patch.mintUrl ?? MINT,
    ...(patch.usedByOperationId ? { usedByOperationId: patch.usedByOperationId } : {}),
    ...(patch.createdByOperationId ? { createdByOperationId: patch.createdByOperationId } : {}),
  }
}

describe('heldAmounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCocoManager.mockResolvedValue({})
  })

  it('counts ready and inflight proofs used by the operation', async () => {
    mocks.getProofsByOperationId.mockImplementation(
      async (_mintUrl: string, operationId: string) =>
        operationId === 'op-1'
          ? [
              proof({ amount: 100, usedByOperationId: 'op-1', state: 'ready' }),
              proof({ amount: 200, usedByOperationId: 'op-1', state: 'inflight' }),
            ]
          : [proof({ amount: 300, usedByOperationId: 'op-2', state: 'inflight' })],
    )

    await expect(heldAmounts(MINT, ['op-1', 'op-2'])).resolves.toEqual({
      'op-1': 300,
      'op-2': 300,
    })
  })

  it('counts the inflight proofs a swap-then-melt created for the operation', async () => {
    mocks.getProofsByOperationId.mockResolvedValue([
      proof({ amount: 65536, usedByOperationId: 'op-1', state: 'spent' }),
      proof({ amount: 50500, secret: 'sent', createdByOperationId: 'op-1', state: 'inflight' }),
      proof({ amount: 15036, secret: 'change', createdByOperationId: 'op-1', state: 'ready' }),
    ])

    await expect(heldAmounts(MINT, ['op-1'])).resolves.toEqual({ 'op-1': 50500 })
  })

  it('stops counting the send proofs once they are restored to ready after a request loss', async () => {
    mocks.getProofsByOperationId.mockResolvedValue([
      proof({ amount: 50500, secret: 'sent', createdByOperationId: 'op-1', state: 'ready' }),
      proof({ amount: 15036, secret: 'change', createdByOperationId: 'op-1', state: 'ready' }),
    ])

    await expect(heldAmounts(MINT, ['op-1'])).resolves.toEqual({ 'op-1': 0 })
  })

  it('ignores spent proofs', async () => {
    mocks.getProofsByOperationId.mockResolvedValue([
      proof({ amount: 100, usedByOperationId: 'op-1', state: 'spent' }),
      proof({ amount: 200, secret: 'sent', createdByOperationId: 'op-1', state: 'spent' }),
    ])

    await expect(heldAmounts(MINT, ['op-1'])).resolves.toEqual({ 'op-1': 0 })
  })

  it('counts a proof once when two operations report it', async () => {
    mocks.getProofsByOperationId.mockResolvedValue([
      proof({ amount: 400, secret: 'shared', usedByOperationId: 'op-1' }),
      proof({ amount: 400, secret: 'shared', createdByOperationId: 'op-2', state: 'inflight' }),
    ])

    await expect(heldAmounts(MINT, ['op-1', 'op-2'])).resolves.toEqual({
      'op-1': 400,
      'op-2': 0,
    })
  })

  it('does not count a proof another operation reserved', async () => {
    mocks.getProofsByOperationId.mockResolvedValue([
      proof({
        amount: 15036,
        usedByOperationId: 'other',
        createdByOperationId: 'op-1',
        state: 'inflight',
      }),
    ])

    await expect(heldAmounts(MINT, ['op-1'])).resolves.toEqual({ 'op-1': 0 })
  })

  it('gives a payment its inputs even when another payment created them', async () => {
    const shared = proof({
      amount: 20000,
      secret: 'b-input',
      usedByOperationId: 'op-b',
      createdByOperationId: 'op-a',
      state: 'inflight',
    })
    mocks.getProofsByOperationId.mockResolvedValue([shared])

    await expect(heldAmounts(MINT, ['op-a', 'op-b'])).resolves.toEqual({
      'op-a': 0,
      'op-b': 20000,
    })
    await expect(heldAmounts(MINT, ['op-b', 'op-a'])).resolves.toEqual({
      'op-b': 20000,
      'op-a': 0,
    })
  })

  it('ignores proofs of another mint', async () => {
    mocks.getProofsByOperationId.mockResolvedValue([
      proof({ amount: 100, usedByOperationId: 'op-1' }),
      proof({ amount: 400, usedByOperationId: 'op-1', mintUrl: 'https://other.example.com' }),
    ])

    await expect(heldAmounts(MINT, ['op-1'])).resolves.toEqual({ 'op-1': 100 })
  })

  it('returns no amounts without operations', async () => {
    await expect(heldAmounts(MINT, [])).resolves.toEqual({})
    expect(mocks.getProofsByOperationId).not.toHaveBeenCalled()
  })
})
