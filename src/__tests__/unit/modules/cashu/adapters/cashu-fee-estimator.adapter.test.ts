import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PaymentRoute } from '@/core/domain/routing'
import {
  CashuFeeEstimatorAdapter,
  type CashuFeeEstimatorBackend,
} from '@/modules/cashu/adapters/cashu-fee-estimator.adapter'

function createBackend(): CashuFeeEstimatorBackend {
  return {
    prepareSend: vi.fn(),
    rollbackSend: vi.fn(),
    createMintQuote: vi.fn(),
    prepareMelt: vi.fn(),
    rollbackMelt: vi.fn(),
    abandonMintQuote: vi.fn(),
    getBalances: vi.fn().mockResolvedValue({ 'https://source.mint': 2000 }),
  }
}

describe('CashuFeeEstimatorAdapter', () => {
  let backend: CashuFeeEstimatorBackend
  let adapter: CashuFeeEstimatorAdapter

  beforeEach(() => {
    backend = createBackend()
    adapter = new CashuFeeEstimatorAdapter(backend)
  })

  it('estimates MINT_AND_DM using cross-mint swap fee path and abandons the temporary quote', async () => {
    vi.mocked(backend.createMintQuote).mockResolvedValue({ quote: 'quote-1', request: 'lnbc1000n1target' })
    vi.mocked(backend.prepareMelt).mockResolvedValue({
      operationId: 'melt-1',
      fee_reserve: 4,
      swap_fee: 1,
    })
    vi.mocked(backend.rollbackMelt).mockResolvedValue(undefined)
    vi.mocked(backend.abandonMintQuote).mockResolvedValue(undefined)

    const result = await adapter.estimateRouteFee(
      PaymentRoute.MINT_AND_DM,
      'https://source.mint',
      1000,
      'https://target.mint',
    )

    expect(result).toEqual({ fee: 5, totalNeeded: 1005, availableBalance: 2000 })
    expect(backend.createMintQuote).toHaveBeenCalledWith('https://target.mint', 1000)
    expect(backend.prepareMelt).toHaveBeenCalledWith('https://source.mint', 'lnbc1000n1target')
    expect(backend.rollbackMelt).toHaveBeenCalledWith('melt-1', 'fee_estimation')
    expect(backend.abandonMintQuote).toHaveBeenCalledWith('https://target.mint', 'quote-1')
    expect(backend.prepareSend).not.toHaveBeenCalled()
  })

  it('keeps token routes on direct send fee estimation path', async () => {
    vi.mocked(backend.prepareSend).mockResolvedValue({
      operationId: 'send-1',
      fee: 2,
    })
    vi.mocked(backend.rollbackSend).mockResolvedValue(undefined)

    const result = await adapter.estimateRouteFee(
      PaymentRoute.TOKEN_TRANSFER,
      'https://source.mint',
      1000,
      'https://source.mint',
    )

    expect(result).toEqual({ fee: 2, totalNeeded: 1002, availableBalance: 2000 })
    expect(backend.prepareSend).toHaveBeenCalledWith({ mintUrl: 'https://source.mint', amount: 1000 })
    expect(backend.rollbackSend).toHaveBeenCalledWith('send-1')
    expect(backend.createMintQuote).not.toHaveBeenCalled()
  })

  it('snapshots the spendable balance BEFORE the temporary lock opens', async () => {
    // The lock is our own transient — pre-lock spendable is the true spendable.
    // A post-rollback read can be poisoned by a concurrent estimate's lock
    // window and then replayed for 60s by the estimate cache.
    const callOrder: string[] = []
    vi.mocked(backend.prepareSend).mockImplementation(async () => {
      callOrder.push('prepare')
      return { operationId: 'send-1', fee: 2 }
    })
    vi.mocked(backend.rollbackSend).mockImplementation(async () => {
      callOrder.push('rollback')
    })
    vi.mocked(backend.getBalances).mockImplementation(async () => {
      callOrder.push('balance')
      return { 'https://source.mint': 2000 }
    })

    await adapter.estimateRouteFee(PaymentRoute.TOKEN_TRANSFER, 'https://source.mint', 1000)

    expect(callOrder).toEqual(['balance', 'prepare', 'rollback'])
  })

  it('does not turn a missing Lightning invoice into a false zero fee', async () => {
    await expect(adapter.estimateRouteFee(
      PaymentRoute.MELT_TO_LN,
      'https://source.mint',
      1000,
    )).rejects.toThrow('without an invoice')

    expect(backend.prepareMelt).not.toHaveBeenCalled()
    expect(backend.getBalances).not.toHaveBeenCalled()
  })

  it('surfaces rollback failures instead of silently keeping temporary token send state', async () => {
    vi.mocked(backend.prepareSend).mockResolvedValue({ operationId: 'send-1', fee: 2 })
    vi.mocked(backend.rollbackSend).mockRejectedValue(new Error('rollback failed'))

    await expect(adapter.estimateRouteFee(
      PaymentRoute.TOKEN_TRANSFER,
      'https://source.mint',
      1000,
    )).rejects.toThrow('rollback failed')
  })

  it('still abandons the temporary mint quote when melt rollback fails', async () => {
    vi.mocked(backend.createMintQuote).mockResolvedValue({ quote: 'quote-1', request: 'lnbc1000n1target' })
    vi.mocked(backend.prepareMelt).mockResolvedValue({ operationId: 'melt-1', fee_reserve: 1, swap_fee: 0 })
    vi.mocked(backend.rollbackMelt).mockRejectedValue(new Error('rollback failed'))
    vi.mocked(backend.abandonMintQuote).mockResolvedValue(undefined)

    await expect(adapter.estimateMyWalletFee(
      'https://source.mint',
      'https://target.mint',
      1000,
    )).rejects.toThrow('rollback failed')

    expect(backend.abandonMintQuote).toHaveBeenCalledWith('https://target.mint', 'quote-1')
  })

  it('surfaces temporary mint quote abandon failures', async () => {
    vi.mocked(backend.createMintQuote).mockResolvedValue({ quote: 'quote-1', request: 'lnbc1000n1target' })
    vi.mocked(backend.prepareMelt).mockResolvedValue({ operationId: 'melt-1', fee_reserve: 1, swap_fee: 0 })
    vi.mocked(backend.rollbackMelt).mockResolvedValue(undefined)
    vi.mocked(backend.abandonMintQuote).mockRejectedValue(new Error('abandon failed'))

    await expect(adapter.estimateMyWalletFee(
      'https://source.mint',
      'https://target.mint',
      1000,
    )).rejects.toThrow('abandon failed')
  })
})
