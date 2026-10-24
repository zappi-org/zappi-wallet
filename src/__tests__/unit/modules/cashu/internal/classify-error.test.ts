import { describe, expect, it } from 'vitest'
import { ProofValidationError } from '@cashu/coco-core'
import { classifyCashuError, isInsufficientFundsMessage } from '@/modules/cashu/internal/classify-error'
import { InsufficientBalanceError } from '@/core/errors/payment.errors'
import { InvalidProofError } from '@/core/errors/cashu'

/**
 * coco reports a send shortfall as ProofValidationError("Not enough proofs to
 * send"). Classified as InvalidProofError it reads as "your proofs are broken"
 * and every funding path keyed off InsufficientBalanceError goes dead — that is
 * what made the username-change swap sheet unreachable in the real app.
 *
 * Only the cases this error path adds coverage for live here — malformed-proof,
 * receive-fee and pass-through behaviour are already pinned in
 * `src/__tests__/unit/core/errors.test.ts`.
 */
describe('classifyCashuError — insufficient funds', () => {
  it('classifies coco\'s not-enough-proofs as InsufficientBalanceError, not InvalidProofError', () => {
    const result = classifyCashuError(new ProofValidationError('Not enough proofs to send'))
    expect(result).toBeInstanceOf(InsufficientBalanceError)
    expect(result).not.toBeInstanceOf(InvalidProofError)
  })

  it('keeps the amount and balance the caller knows', () => {
    const result = classifyCashuError(new ProofValidationError('Not enough proofs to send'), {
      amount: 100,
      available: 40,
    })
    expect(result).toMatchObject({ required: 100, available: 40, fee: 0 })
  })

  it('flags a fee-sized shortfall when the balance covers the amount', () => {
    const result = classifyCashuError(new ProofValidationError('Not enough proofs to send'), {
      amount: 100,
      available: 100,
    })
    expect(result).toBeInstanceOf(InsufficientBalanceError)
    expect((result as InsufficientBalanceError).isFeeShortage).toBe(true)
  })

})

describe('isInsufficientFundsMessage', () => {
  it.each([
    ['Not enough proofs to send', true],
    ['Not enough funds', true],
    ['insufficient balance', true],
    ['proof has already been spent', false],
    ['receive amount is not sufficient after fees', false],
  ])('%s → %s', (message, expected) => {
    expect(isInsufficientFundsMessage(message)).toBe(expected)
  })
})
