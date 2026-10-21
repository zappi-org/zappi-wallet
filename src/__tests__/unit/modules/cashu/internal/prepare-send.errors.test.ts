import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProofValidationError } from '@cashu/coco-core'
import { InsufficientBalanceError } from '@/core/errors/payment.errors'
import { InvalidProofError } from '@/core/errors/cashu'

const MINT = 'https://mint.example'

const { prepareMock, balancesMock, manager } = vi.hoisted(() => {
  const prepare = vi.fn()
  const balances = vi.fn()
  return {
    prepareMock: prepare,
    balancesMock: balances,
    manager: {
      mint: { getAllMints: async () => [{ mintUrl: 'https://mint.example' }], trustMint: vi.fn() },
      wallet: { balances: { byMint: balances } },
      ops: { send: { prepare } },
    },
  }
})

vi.mock('@/modules/cashu/internal/coco-sdk', () => ({
  getCocoManager: async () => manager,
  getPendingMintQuotes: vi.fn(async () => []),
}))

const { prepareSend } = await import('@/modules/cashu/internal/cashu-backend')

/**
 * The username-change flow asks the payment mint for ecash and keys its funding
 * UI off InsufficientBalanceError. coco answers "Not enough proofs to send",
 * which must not surface as a raw SDK error or as InvalidProofError.
 */
describe('prepareSend — insufficient funds mapping', () => {
  beforeEach(() => {
    prepareMock.mockReset()
    balancesMock.mockReset()
    balancesMock.mockResolvedValue({ [MINT]: { spendable: 40 } })
  })

  it('maps coco\'s shortfall to InsufficientBalanceError with the amount and balance', async () => {
    prepareMock.mockRejectedValue(new ProofValidationError('Not enough proofs to send'))

    const error = await prepareSend({ mintUrl: MINT, amount: 100 }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(InsufficientBalanceError)
    expect(error).toMatchObject({ required: 100, available: 40, fee: 0 })
    // The balance the funding UI derives its swap amount from is the real one.
    expect(balancesMock).toHaveBeenCalledWith({ mintUrls: [MINT] })
  })

  it('leaves non-funds failures alone (no balance query, no reclassification)', async () => {
    const original = new ProofValidationError('proof signature is invalid')
    prepareMock.mockRejectedValue(original)

    const error = await prepareSend({ mintUrl: MINT, amount: 100 }).catch((e: unknown) => e)

    expect(error).toBe(original)
    expect(error).not.toBeInstanceOf(InvalidProofError)
    expect(balancesMock).not.toHaveBeenCalled()
  })
})
