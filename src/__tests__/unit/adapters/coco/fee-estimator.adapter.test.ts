import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PaymentRoute } from '@/core/domain/routing'
import { FeeEstimatorAdapter } from '@/adapters/coco/fee-estimator.adapter'

const mockPrepareSend = vi.fn()
const mockRollbackSend = vi.fn()
const mockCreateMintQuote = vi.fn()
const mockPrepareMelt = vi.fn()
const mockRollbackMelt = vi.fn()

vi.mock('@/modules/cashu', () => ({
  prepareSend: mockPrepareSend,
  rollbackSend: mockRollbackSend,
  createMintQuote: mockCreateMintQuote,
  prepareMelt: mockPrepareMelt,
  rollbackMelt: mockRollbackMelt,
}))

describe('FeeEstimatorAdapter', () => {
  const adapter = new FeeEstimatorAdapter()

  beforeEach(() => {
    mockPrepareSend.mockReset()
    mockRollbackSend.mockReset()
    mockCreateMintQuote.mockReset()
    mockPrepareMelt.mockReset()
    mockRollbackMelt.mockReset()
  })

  it('estimates MINT_AND_DM using cross-mint swap fee path', async () => {
    mockCreateMintQuote.mockResolvedValue({ request: 'lnbc1000n1target' })
    mockPrepareMelt.mockResolvedValue({
      operationId: 'melt-1',
      fee_reserve: 4,
      swap_fee: 1,
    })
    mockRollbackMelt.mockResolvedValue(undefined)

    const result = await adapter.estimateRouteFee(
      PaymentRoute.MINT_AND_DM,
      'https://source.mint',
      1000,
      'https://target.mint',
    )

    expect(result).toEqual({ fee: 5, totalNeeded: 1005 })
    expect(mockCreateMintQuote).toHaveBeenCalledWith('https://target.mint', 1000)
    expect(mockPrepareMelt).toHaveBeenCalledWith('https://source.mint', 'lnbc1000n1target')
    expect(mockRollbackMelt).toHaveBeenCalledWith('melt-1', 'fee_estimation')
    expect(mockPrepareSend).not.toHaveBeenCalled()
  })

  it('keeps token routes on direct send fee estimation path', async () => {
    mockPrepareSend.mockResolvedValue({
      operationId: 'send-1',
      fee: 2,
    })
    mockRollbackSend.mockResolvedValue(undefined)

    const result = await adapter.estimateRouteFee(
      PaymentRoute.TOKEN_TRANSFER,
      'https://source.mint',
      1000,
      'https://source.mint',
    )

    expect(result).toEqual({ fee: 2, totalNeeded: 1002 })
    expect(mockPrepareSend).toHaveBeenCalledWith({ mintUrl: 'https://source.mint', amount: 1000 })
    expect(mockRollbackSend).toHaveBeenCalledWith('send-1')
    expect(mockCreateMintQuote).not.toHaveBeenCalled()
  })
})
