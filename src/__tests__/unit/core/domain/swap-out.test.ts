import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  advancePayoutStage,
  decidePayoutSweep,
  estimatePayout,
  isOpenSwapOutPayment,
  isPayoutAmountInRange,
  isPayoutStageTerminal,
  isSwapOutStageResumable,
  PAYOUT_SWEEP_VSIZE,
  payoutPhase,
  payoutReceiveAmount,
  payoutSendAmount,
  payoutSweepFee,
  payoutSweepVsizeForDestination,
  payoutSweepVsizeForScriptLength,
  payoutUpfrontAmount,
  validatePayoutSweep,
  type SwapOutStage,
  type PayoutSweepInput,
} from '@/core/domain/swap-out'
import type { PendingTransfer, TransferPhase } from '@/core/domain/pending-transfer'

interface FeeRow {
  percentage: string
  mining_fee: number
  amount: number
  recv_reverse: number
  send_reverse: number
  recv_forward: number | null
  send_forward: number | null
}

interface ClaimTx {
  funding_value: number
  dest_value: number
  dest_address: string
}

interface Vectors {
  fees_reverse: FeeRow[]
  claim_tx: ClaimTx
}

const vectors: Vectors = JSON.parse(
  readFileSync('src/__tests__/fixtures/swap-out/vectors.json', 'utf8'),
)

const claim = vectors.claim_tx

function percentToPpm(percentage: string): bigint {
  const [whole, fraction = ''] = percentage.split('.')
  return BigInt(whole + fraction.padEnd(6, '0').slice(0, 6))
}

function ceilDivBig(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b
}

function exactReceive(sendAmount: number, percentage: string, networkFee: number): number {
  const ppm = percentToPpm(percentage)
  const fee = ceilDivBig(BigInt(sendAmount) * ppm, 100_000_000n)
  return sendAmount - Number(fee) - networkFee
}

function exactSend(receiveAmount: number, percentage: string, networkFee: number): number {
  const ppm = percentToPpm(percentage)
  return Number(
    ceilDivBig(BigInt(receiveAmount + networkFee) * 100_000_000n, 100_000_000n - ppm),
  )
}

function makeTransfer(phase: TransferPhase): PendingTransfer {
  return {
    id: 'payout-1',
    txId: 'tx-1',
    direction: 'outgoing',
    phase,
    finality: 'revocable',
    onExpiry: 'reclaim',
    transportRef: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

function sweepInput(patch: Partial<PayoutSweepInput> = {}): PayoutSweepInput {
  return {
    expectedAmount: 100000,
    locktime: 1000,
    currentHeight: 800,
    output: { value: 100000, confirmedHeight: 900 },
    spend: null,
    secretRevealed: false,
    ...patch,
  }
}

describe('payout amounts match the fee table', () => {
  it.each(vectors.fees_reverse)(
    'fee $percentage networkFee $mining_fee amount $amount',
    (row) => {
      const feePercent = Number(row.percentage)
      expect(
        payoutReceiveAmount({
          sendAmount: row.amount,
          feePercent,
          networkFee: row.mining_fee,
        }),
      ).toBe(row.recv_reverse)
      expect(
        payoutSendAmount({
          receiveAmount: row.amount,
          feePercent,
          networkFee: row.mining_fee,
        }),
      ).toBe(row.send_reverse)
    },
  )

  it('keeps exact fee arithmetic on four-decimal percentages', () => {
    expect(
      payoutReceiveAmount({ sendAmount: 1_000_000, feePercent: 0.0079, networkFee: 300 }),
    ).toBe(999621)
  })

  it.each(['0.0079', '0.0001', '0.0123', '0.0999'])(
    'matches exact rational arithmetic at %s percent',
    (percentage) => {
      const feePercent = Number(percentage)
      for (const amount of [1_000_000, 99_700, 250_000]) {
        expect(
          payoutReceiveAmount({ sendAmount: amount, feePercent, networkFee: 300 }),
        ).toBe(exactReceive(amount, percentage, 300))
        expect(
          payoutSendAmount({ receiveAmount: amount, feePercent, networkFee: 300 }),
        ).toBe(exactSend(amount, percentage, 300))
      }
    },
  )

  it('rejects unsafe amount inputs', () => {
    expect(() =>
      payoutReceiveAmount({ sendAmount: -1, feePercent: 0.3, networkFee: 100 }),
    ).toThrow(RangeError)
    expect(() =>
      payoutReceiveAmount({ sendAmount: 1000.5, feePercent: 0.3, networkFee: 100 }),
    ).toThrow(RangeError)
    expect(() =>
      payoutReceiveAmount({ sendAmount: 1000, feePercent: 0.3, networkFee: -1 }),
    ).toThrow(RangeError)
    expect(() =>
      payoutSendAmount({ receiveAmount: 1000, feePercent: 100, networkFee: 100 }),
    ).toThrow(RangeError)
    expect(() =>
      payoutSendAmount({ receiveAmount: 1000, feePercent: -0.1, networkFee: 100 }),
    ).toThrow(RangeError)
  })

  it('payoutUpfrontAmount doubles the network fee', () => {
    expect(payoutUpfrontAmount(100)).toBe(200)
    expect(payoutUpfrontAmount(150)).toBe(300)
  })

  it('isPayoutAmountInRange includes both bounds', () => {
    expect(isPayoutAmountInRange(1000, { min: 1000, max: 2000 })).toBe(true)
    expect(isPayoutAmountInRange(2000, { min: 1000, max: 2000 })).toBe(true)
    expect(isPayoutAmountInRange(999, { min: 1000, max: 2000 })).toBe(false)
    expect(isPayoutAmountInRange(2001, { min: 1000, max: 2000 })).toBe(false)
  })

  it('payoutSweepFee covers the sweep virtual size', () => {
    expect(payoutSweepFee(1)).toBe(136)
    expect(payoutSweepFee(2.5)).toBe(340)
    expect(payoutSweepFee(2, 200)).toBe(400)
  })
})

describe('payout sweep virtual size', () => {
  const wpkh = 'bc1qqurswpc8qurswpc8qurswpc8qurswpc89fe3yv'
  const pkh = '1eA9ctCNq41iLLnQErtTUVdxpRyZ9hZmW'
  const sh = '32LB5ANdvjNPoW3DXLXUt6ra7Lih9WeBJN'
  const tr = 'bc1pqurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurssvw8hu'
  const wsh = 'bc1qqurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurs6mww0q'
  const testnetWpkh = 'tb1qqurswpc8qurswpc8qurswpc8qurswpc800zzll'

  it.each([
    [wpkh, 136],
    [testnetWpkh, 136],
    [pkh, 139],
    [sh, 137],
    [tr, 148],
    [wsh, 148],
  ])('maps %s to %s vbytes', (destination, vsize) => {
    expect(payoutSweepVsizeForDestination(destination)).toBe(vsize)
  })

  it('uses the largest size for an unknown shape', () => {
    expect(payoutSweepVsizeForDestination('not-an-address')).toBe(148)
    expect(payoutSweepVsizeForDestination('')).toBe(148)
  })

  it('matches the default size on a key-hash witness output', () => {
    expect(payoutSweepVsizeForDestination(wpkh)).toBe(payoutSweepFee(1))
  })

  it('embeds the output script in the transaction size', () => {
    expect(payoutSweepVsizeForScriptLength(22)).toBe(136)
    expect(payoutSweepVsizeForScriptLength(25)).toBe(139)
    expect(payoutSweepVsizeForScriptLength(23)).toBe(137)
    expect(payoutSweepVsizeForScriptLength(34)).toBe(148)
  })
})

describe('estimatePayout', () => {
  const feePercent = 0.3
  const networkFee = 150
  const payoutFeeRate = 2
  const destination = 'bc1qqurswpc8qurswpc8qurswpc8qurswpc89fe3yv'
  const payoutFeeEstimate = 272

  it('links a send amount to the receive amount', () => {
    const estimate = estimatePayout({
      feePercent,
      networkFee,
      payoutFeeRate,
      destination,
      sendAmount: 100000,
    })
    expect(estimate).toEqual({
      sendAmount: 100000,
      receiveAmount: 99550 - payoutFeeEstimate,
      serviceFee: 300,
      networkFee,
      payoutFee: payoutFeeEstimate,
    })
  })

  it('prices the sweep fee from the destination shape', () => {
    const taproot = 'bc1pqurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurssvw8hu'
    expect(
      estimatePayout({
        feePercent,
        networkFee,
        payoutFeeRate,
        destination,
        sendAmount: 100000,
      }).payoutFee,
    ).toBe(272)
    expect(
      estimatePayout({
        feePercent,
        networkFee,
        payoutFeeRate,
        destination: taproot,
        sendAmount: 100000,
      }).payoutFee,
    ).toBe(296)
  })

  it('links a receive amount to the send amount', () => {
    const estimate = estimatePayout({
      feePercent,
      networkFee,
      payoutFeeRate,
      destination,
      receiveAmount: 99278,
    })
    expect(estimate.sendAmount).toBe(payoutSendAmount({
      receiveAmount: 99278 + payoutFeeEstimate,
      feePercent,
      networkFee,
    }))
    expect(estimate.sendAmount - estimate.receiveAmount).toBe(
      estimate.serviceFee + estimate.networkFee + estimate.payoutFee,
    )
  })

  it('round trips a send amount through the receive side', () => {
    for (const sendAmount of [20000, 100000, 123457, 2000000]) {
      const forward = estimatePayout({
        feePercent,
        networkFee,
        payoutFeeRate,
        destination,
        sendAmount,
      })
      const back = estimatePayout({
        feePercent,
        networkFee,
        payoutFeeRate,
        destination,
        receiveAmount: forward.receiveAmount,
      })
      expect(back.sendAmount).toBe(sendAmount)
      expect(back.receiveAmount).toBe(forward.receiveAmount)
      expect(back.serviceFee).toBe(forward.serviceFee)
    }
  })

  it('keeps the receive amount on the send side for every fee table row', () => {
    for (const row of vectors.fees_reverse) {
      const estimate = estimatePayout({
        feePercent: Number(row.percentage),
        networkFee: row.mining_fee,
        payoutFeeRate: 0,
        destination,
        sendAmount: row.amount,
      })
      expect(estimate.receiveAmount).toBe(row.recv_reverse)
      expect(estimate.serviceFee).toBe(row.amount - row.recv_reverse - row.mining_fee)
    }
  })

  it('matches exact rational arithmetic on the receive side', () => {
    for (const percentage of ['0.0079', '0.0001', '0.0123', '0.0999']) {
      for (const receiveAmount of [1_000_000, 99_700, 250_000]) {
        const estimate = estimatePayout({
          feePercent: Number(percentage),
          networkFee: 300,
          payoutFeeRate,
          destination,
          receiveAmount,
        })
        expect(estimate.sendAmount).toBe(
          exactSend(receiveAmount + payoutFeeEstimate, percentage, 300),
        )
      }
    }
  })

  it('rounds the receive side up to whole sats', () => {
    const estimate = estimatePayout({
      feePercent: 0.49,
      networkFee: 150,
      payoutFeeRate,
      destination,
      receiveAmount: 10001,
    })
    expect(Number.isSafeInteger(estimate.sendAmount)).toBe(true)
    expect(estimate.sendAmount).toBe(
      exactSend(10001 + payoutFeeEstimate, '0.49', 150),
    )
  })

  it('rejects unusable inputs', () => {
    expect(() =>
      estimatePayout({
        feePercent,
        networkFee,
        payoutFeeRate: -1,
        destination,
        sendAmount: 100000,
      }),
    ).toThrow(RangeError)
    expect(() =>
      estimatePayout({
        feePercent,
        networkFee,
        payoutFeeRate: Number.NaN,
        destination,
        sendAmount: 100000,
      }),
    ).toThrow(RangeError)
    expect(() =>
      estimatePayout({
        feePercent,
        networkFee,
        payoutFeeRate,
        destination,
        sendAmount: 1000.5,
      }),
    ).toThrow(RangeError)
    expect(() =>
      estimatePayout({
        feePercent,
        networkFee,
        payoutFeeRate,
        destination,
        receiveAmount: -1,
      }),
    ).toThrow(RangeError)
  })
})

describe('stage maps to transfer phase', () => {
  it.each([
    ['quoted', 'preparing'],
    ['paying', 'submitted'],
    ['funded', 'in_transit'],
    ['sweeping', 'awaiting_confirmation'],
    ['completed', 'settled'],
    ['refunded', 'failed'],
    ['aborted', 'failed'],
  ] as [SwapOutStage, TransferPhase][])('%s → %s', (stage, phase) => {
    expect(payoutPhase(stage)).toBe(phase)
  })

  it('advancePayoutStage applies the phase guard', () => {
    const paying = advancePayoutStage(makeTransfer('preparing'), 'paying', 5)
    expect(paying.phase).toBe('submitted')
    expect(paying.updatedAt).toBe(5)

    const completed = advancePayoutStage(paying, 'completed', 7)
    expect(completed.phase).toBe('settled')

    expect(() => advancePayoutStage(completed, 'refunded', 8)).toThrow()

    const stillCompleted = advancePayoutStage(completed, 'completed', 9)
    expect(stillCompleted.phase).toBe('settled')
    expect(stillCompleted.updatedAt).toBe(9)
  })

  it('only completed, refunded and aborted are terminal', () => {
    const stages: SwapOutStage[] = [
      'quoted',
      'paying',
      'funded',
      'sweeping',
      'completed',
      'refunded',
      'aborted',
    ]
    expect(stages.filter(isPayoutStageTerminal)).toEqual([
      'completed',
      'refunded',
      'aborted',
    ])
  })
})

describe('underpaid funding never sweeps', () => {
  it('one sat short waits instead of refusing', () => {
    expect(
      decidePayoutSweep(
        sweepInput({ output: { value: 99999, confirmedHeight: 900 } }),
      ),
    ).toEqual({ action: 'wait', reason: 'underpaid' })
  })

  it('one sat over sweeps', () => {
    expect(
      decidePayoutSweep(
        sweepInput({ output: { value: 100001, confirmedHeight: 900 } }),
      ),
    ).toEqual({ action: 'sweep', reason: 'ready' })
  })
})

describe('funding too close to the provider locktime never sweeps', () => {
  it('confirmation at locktime refuses', () => {
    expect(
      decidePayoutSweep(
        sweepInput({ output: { value: 100000, confirmedHeight: 1000 } }),
      ),
    ).toEqual({ action: 'refuse', reason: 'too_close_to_locktime' })
  })

  it('confirmation at the safety boundary refuses', () => {
    expect(
      decidePayoutSweep(
        sweepInput({ output: { value: 100000, confirmedHeight: 970 } }),
      ),
    ).toEqual({ action: 'refuse', reason: 'too_close_to_locktime' })
  })

  it('confirmation one block before the safety boundary sweeps', () => {
    expect(
      decidePayoutSweep(
        sweepInput({ output: { value: 100000, confirmedHeight: 969 } }),
      ),
    ).toEqual({ action: 'sweep', reason: 'ready' })
  })

  it('a late chain tip refuses even when funding confirmed early', () => {
    expect(
      decidePayoutSweep(
        sweepInput({
          currentHeight: 970,
          output: { value: 100000, confirmedHeight: 900 },
        }),
      ),
    ).toEqual({ action: 'refuse', reason: 'too_close_to_locktime' })
  })

  it('a chain tip one block earlier sweeps', () => {
    expect(
      decidePayoutSweep(
        sweepInput({
          currentHeight: 969,
          output: { value: 100000, confirmedHeight: 900 },
        }),
      ),
    ).toEqual({ action: 'sweep', reason: 'ready' })
  })
})

describe('unconfirmed funding never sweeps', () => {
  it('waits while there is still margin', () => {
    expect(
      decidePayoutSweep(
        sweepInput({ output: { value: 100000, confirmedHeight: null } }),
      ),
    ).toEqual({ action: 'wait', reason: 'unconfirmed' })
  })

  it('refuses once the tip reaches the safety boundary', () => {
    expect(
      decidePayoutSweep(
        sweepInput({
          currentHeight: 970,
          output: { value: 100000, confirmedHeight: null },
        }),
      ),
    ).toEqual({ action: 'refuse', reason: 'too_close_to_locktime' })
  })
})

describe('missing funding never waits forever', () => {
  it('waits before the locktime', () => {
    expect(decidePayoutSweep(sweepInput({ output: null }))).toEqual({
      action: 'wait',
      reason: 'not_funded',
    })
  })

  it('refuses once the tip passes the locktime', () => {
    expect(
      decidePayoutSweep(sweepInput({ currentHeight: 1000, output: null })),
    ).toEqual({ action: 'refuse', reason: 'expired' })
  })

  it('refuses well past the locktime', () => {
    expect(
      decidePayoutSweep(sweepInput({ currentHeight: 2000, output: null })),
    ).toEqual({ action: 'refuse', reason: 'expired' })
  })
})

describe('revealed secret keeps the sweep alive', () => {
  it('rebroadcasts while the funding looks unconfirmed', () => {
    expect(
      decidePayoutSweep(
        sweepInput({
          secretRevealed: true,
          output: { value: 100000, confirmedHeight: null },
        }),
      ),
    ).toEqual({ action: 'rebroadcast', reason: 'revealed' })
  })

  it('rebroadcasts even near the locktime', () => {
    expect(
      decidePayoutSweep(
        sweepInput({
          secretRevealed: true,
          currentHeight: 970,
          output: { value: 100000, confirmedHeight: 1000 },
        }),
      ),
    ).toEqual({ action: 'rebroadcast', reason: 'revealed' })
  })

  it('rebroadcasts while waiting for funding', () => {
    expect(
      decidePayoutSweep(sweepInput({ secretRevealed: true, output: null })),
    ).toEqual({ action: 'rebroadcast', reason: 'revealed' })
  })

  it('rebroadcasts while the provider spend is unconfirmed', () => {
    expect(
      decidePayoutSweep(
        sweepInput({
          secretRevealed: true,
          spend: { byUs: false, confirmed: false },
        }),
      ),
    ).toEqual({ action: 'rebroadcast', reason: 'revealed' })
  })
})

describe('a provider spend refuses while the secret is secret', () => {
  it('unconfirmed provider spend refuses', () => {
    expect(
      decidePayoutSweep(
        sweepInput({ spend: { byUs: false, confirmed: false } }),
      ),
    ).toEqual({ action: 'refuse', reason: 'spent_by_provider' })
  })

  it('confirmed provider spend refuses', () => {
    expect(
      decidePayoutSweep(sweepInput({ spend: { byUs: false, confirmed: true } })),
    ).toEqual({ action: 'refuse', reason: 'spent_by_provider' })
  })

  it('confirmed provider spend refuses even after the secret was revealed', () => {
    expect(
      decidePayoutSweep(
        sweepInput({
          secretRevealed: true,
          spend: { byUs: false, confirmed: true },
        }),
      ),
    ).toEqual({ action: 'refuse', reason: 'spent_by_provider' })
  })

  it('provider spend refuses even past the locktime', () => {
    expect(
      decidePayoutSweep(
        sweepInput({
          currentHeight: 1500,
          output: null,
          spend: { byUs: false, confirmed: false },
        }),
      ),
    ).toEqual({ action: 'refuse', reason: 'spent_by_provider' })
  })
})

describe('our own spend is never replaced', () => {
  it('our unconfirmed spend rebroadcasts before the secret flag was saved', () => {
    expect(
      decidePayoutSweep(
        sweepInput({ secretRevealed: false, spend: { byUs: true, confirmed: false } }),
      ),
    ).toEqual({ action: 'rebroadcast', reason: 'revealed' })
  })

  it('our unconfirmed spend rebroadcasts after the secret was revealed', () => {
    expect(
      decidePayoutSweep(
        sweepInput({ secretRevealed: true, spend: { byUs: true, confirmed: false } }),
      ),
    ).toEqual({ action: 'rebroadcast', reason: 'revealed' })
  })

  it('our confirmed spend is done', () => {
    expect(
      decidePayoutSweep(sweepInput({ spend: { byUs: true, confirmed: true } })),
    ).toEqual({ action: 'done', reason: 'confirmed' })
  })
})

describe('validatePayoutSweep', () => {
  const fee = claim.funding_value - claim.dest_value

  function plan(patch: Partial<Parameters<typeof validatePayoutSweep>[0]> = {}) {
    return {
      inputValue: claim.funding_value,
      outputs: [{ address: claim.dest_address, value: claim.dest_value }],
      fee,
      maxFee: fee,
      destination: claim.dest_address,
      fundingConfirmations: 1,
      ...patch,
    }
  }

  it('accepts one exact output to the destination', () => {
    expect(validatePayoutSweep(plan()).ok).toBe(true)
  })

  it('rejects two outputs', () => {
    expect(
      validatePayoutSweep(
        plan({
          outputs: [
            { address: claim.dest_address, value: claim.dest_value },
            { address: claim.dest_address, value: 0 },
          ],
        }),
      ).ok,
    ).toBe(false)
  })

  it('rejects a wrong amount', () => {
    expect(
      validatePayoutSweep(
        plan({
          outputs: [{ address: claim.dest_address, value: claim.dest_value + 1 }],
        }),
      ).ok,
    ).toBe(false)
  })

  it('rejects a wrong address', () => {
    expect(
      validatePayoutSweep(
        plan({ outputs: [{ address: 'someone-else', value: claim.dest_value }] }),
      ).ok,
    ).toBe(false)
  })

  it('rejects unconfirmed funding', () => {
    expect(validatePayoutSweep(plan({ fundingConfirmations: 0 })).ok).toBe(false)
  })

  it('rejects a zero fee', () => {
    expect(
      validatePayoutSweep(
        plan({
          fee: 0,
          outputs: [{ address: claim.dest_address, value: claim.funding_value }],
        }),
      ).ok,
    ).toBe(false)
  })

  it('rejects a non-positive output value', () => {
    expect(
      validatePayoutSweep(
        plan({
          fee: claim.funding_value,
          maxFee: claim.funding_value,
          outputs: [{ address: claim.dest_address, value: 0 }],
        }),
      ).ok,
    ).toBe(false)
  })

  it('rejects a dust output', () => {
    expect(
      validatePayoutSweep(
        plan({
          fee: claim.funding_value - 329,
          maxFee: claim.funding_value - 329,
          outputs: [{ address: claim.dest_address, value: 329 }],
        }),
      ).ok,
    ).toBe(false)
  })

  it('rejects a fee above the maximum', () => {
    expect(validatePayoutSweep(plan({ maxFee: fee - 1 })).ok).toBe(false)
  })

  it('accepts the smallest non-dust output', () => {
    expect(
      validatePayoutSweep(
        plan({
          fee: claim.funding_value - 330,
          maxFee: claim.funding_value - 330,
          outputs: [{ address: claim.dest_address, value: 330 }],
        }),
      ).ok,
    ).toBe(true)
  })
})

describe('payment and stage predicates', () => {
  it('treats prepared and dispatched payments as open', () => {
    expect(isOpenSwapOutPayment('prepared')).toBe(true)
    expect(isOpenSwapOutPayment('dispatched')).toBe(true)
    expect(isOpenSwapOutPayment('paid')).toBe(false)
    expect(isOpenSwapOutPayment('failed')).toBe(false)
    expect(isOpenSwapOutPayment('rolled_back')).toBe(false)
  })

  it('treats paying, funded and sweeping stages as resumable', () => {
    expect(isSwapOutStageResumable('paying')).toBe(true)
    expect(isSwapOutStageResumable('funded')).toBe(true)
    expect(isSwapOutStageResumable('sweeping')).toBe(true)
    expect(isSwapOutStageResumable('quoted')).toBe(false)
    expect(isSwapOutStageResumable('completed')).toBe(false)
    expect(isSwapOutStageResumable('refunded')).toBe(false)
    expect(isSwapOutStageResumable('aborted')).toBe(false)
  })

  it('derives the sweep vsize from a witness key script', () => {
    expect(PAYOUT_SWEEP_VSIZE).toBe(136)
  })
})
