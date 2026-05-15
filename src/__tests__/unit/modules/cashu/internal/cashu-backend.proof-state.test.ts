import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkProofStates } from '@/modules/cashu/internal/cashu-backend'

const { proofStatesMock } = vi.hoisted(() => ({
  proofStatesMock: vi.fn(),
}))

vi.mock('@cashu/cashu-ts', () => ({
  getDecodedToken: () => ({
    mint: 'https://mint.test',
    proofs: [{ secret: 's1' }, { secret: 's2' }],
  }),
  CashuMint: class MockCashuMint {
    constructor(readonly url: string) {}
  },
  CashuWallet: class MockCashuWallet {
    constructor(readonly mint: unknown) {}
    checkProofsStates = proofStatesMock
  },
}))

describe('cashu backend proof state checks', () => {
  beforeEach(() => {
    proofStatesMock.mockReset()
  })

  it('normalizes cashu-ts uppercase proof states before returning them to adapters', async () => {
    proofStatesMock.mockResolvedValue([
      { secret: 's1', state: 'UNSPENT' },
      { secret: 's2', state: 'UNSPENT' },
    ])

    await expect(checkProofStates('cashuAtoken')).resolves.toEqual({
      allSpent: false,
      allPending: false,
      states: [
        { secret: 's1', state: 'unspent' },
        { secret: 's2', state: 'unspent' },
      ],
    })
  })

  it('normalizes spent and pending enum states for aggregate checks', async () => {
    proofStatesMock.mockResolvedValue([
      { secret: 's1', state: 'SPENT' },
      { secret: 's2', state: 'SPENT' },
    ])

    await expect(checkProofStates('cashuAtoken')).resolves.toEqual({
      allSpent: true,
      allPending: false,
      states: [
        { secret: 's1', state: 'spent' },
        { secret: 's2', state: 'spent' },
      ],
    })

    proofStatesMock.mockResolvedValue([
      { secret: 's1', state: 'PENDING' },
      { secret: 's2', state: 'PENDING' },
    ])

    await expect(checkProofStates('cashuAtoken')).resolves.toEqual({
      allSpent: false,
      allPending: true,
      states: [
        { secret: 's1', state: 'pending' },
        { secret: 's2', state: 'pending' },
      ],
    })
  })
})
