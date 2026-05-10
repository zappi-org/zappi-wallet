import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Ok, Err } from '@/core/domain/result'
import { sat } from '@/core/domain/amount'
import { NetworkError, UnknownError } from '@/core/errors/base'
import { executeSwapReceive, type SwapReceiveDependencies } from '@/composition/swap-receive'

function createDependencies(): SwapReceiveDependencies {
  return {
    payment: {
      redeem: vi.fn(),
    },
    swap: {
      estimateSwap: vi.fn(),
      executeSwap: vi.fn(),
    },
    balance: {
      getByModule: vi.fn(),
    },
  }
}

describe('executeSwapReceive', () => {
  let deps: SwapReceiveDependencies

  beforeEach(() => {
    deps = createDependencies()
  })

  it('does not redeem a zero-amount token', async () => {
    const result = await executeSwapReceive(deps, {
      token: 'cashuA...',
      amountSats: 0,
      sourceMintUrl: 'https://source.mint',
      targetMintUrl: 'https://target.mint',
    })

    expect(result).toEqual({
      state: 'redeem-not-received',
      sourceMintUrl: 'https://source.mint',
      targetMintUrl: 'https://target.mint',
      error: {
        code: 'REDEEM_FEE_TOO_HIGH',
        message: 'Token amount is zero',
      },
    })
    expect(deps.payment.redeem).not.toHaveBeenCalled()
    expect(deps.swap.estimateSwap).not.toHaveBeenCalled()
    expect(deps.swap.executeSwap).not.toHaveBeenCalled()
  })

  it('does not redeem when the token amount cannot cover the swap fee', async () => {
    vi.mocked(deps.swap.estimateSwap).mockResolvedValue(Ok({
      fee: sat(10),
      sourceAmount: sat(10),
      targetAmount: sat(10),
    }))

    const result = await executeSwapReceive(deps, {
      token: 'cashuA...',
      amountSats: 10,
      sourceMintUrl: 'https://source.mint',
      targetMintUrl: 'https://target.mint',
    })

    expect(result).toEqual({
      state: 'redeem-not-received',
      sourceMintUrl: 'https://source.mint',
      targetMintUrl: 'https://target.mint',
      error: {
        code: 'SWAP_FEE_TOO_HIGH',
        message: 'Swap fee exceeds the token amount',
      },
    })
    expect(deps.payment.redeem).not.toHaveBeenCalled()
    expect(deps.swap.executeSwap).not.toHaveBeenCalled()
  })

  it('does not redeem when preflight swap estimation fails', async () => {
    vi.mocked(deps.swap.estimateSwap).mockResolvedValue(Err(new NetworkError('mint unavailable')))

    const result = await executeSwapReceive(deps, {
      token: 'cashuA...',
      amountSats: 10,
      sourceMintUrl: 'https://source.mint',
      targetMintUrl: 'https://target.mint',
    })

    expect(result).toEqual({
      state: 'redeem-not-received',
      sourceMintUrl: 'https://source.mint',
      targetMintUrl: 'https://target.mint',
      error: {
        code: 'SWAP_ESTIMATE_FAILED',
        message: 'mint unavailable',
      },
    })
    expect(deps.payment.redeem).not.toHaveBeenCalled()
    expect(deps.swap.executeSwap).not.toHaveBeenCalled()
  })

  it('retries source remainder without draining pre-existing source balance', async () => {
    vi.mocked(deps.balance.getByModule)
      .mockResolvedValueOnce([
        {
          moduleId: 'cashu',
          total: sat(40),
          accounts: [{ id: 'https://source.mint', label: 'source', amount: sat(40) }],
        },
      ])
      .mockResolvedValueOnce([
        {
          moduleId: 'cashu',
          total: sat(43),
          accounts: [{ id: 'https://source.mint', label: 'source', amount: sat(43) }],
        },
      ])
      .mockResolvedValueOnce([
        {
          moduleId: 'cashu',
          total: sat(40),
          accounts: [{ id: 'https://source.mint', label: 'source', amount: sat(40) }],
        },
      ])

    vi.mocked(deps.payment.redeem).mockResolvedValue(Ok({
      requestId: 'redeem-1',
      amount: sat(100),
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      completed: true,
      accountId: 'https://source.mint',
    }))
    vi.mocked(deps.swap.estimateSwap)
      .mockResolvedValueOnce(Ok({
        fee: sat(5),
        sourceAmount: sat(100),
        targetAmount: sat(100),
      }))
      .mockResolvedValueOnce(Ok({
        fee: sat(5),
        sourceAmount: sat(100),
        targetAmount: sat(100),
      }))
      .mockResolvedValueOnce(Ok({
        fee: sat(1),
        sourceAmount: sat(3),
        targetAmount: sat(3),
      }))
    vi.mocked(deps.swap.executeSwap)
      .mockResolvedValueOnce(Ok({
        sendTxId: 'send-1',
        receiveTxId: 'recv-1',
        amount: sat(95),
        fee: sat(5),
      }))
      .mockResolvedValueOnce(Ok({
        sendTxId: 'send-2',
        receiveTxId: 'recv-2',
        amount: sat(2),
        fee: sat(1),
      }))

    const result = await executeSwapReceive(deps, {
      token: 'cashuA...',
      amountSats: 100,
      sourceMintUrl: 'https://source.mint',
      targetMintUrl: 'https://target.mint',
    })

    expect(result).toEqual({
      state: 'swapped',
      amount: 97,
      sourceRemainder: 0,
      sourceMintUrl: 'https://source.mint',
      targetMintUrl: 'https://target.mint',
    })
    expect(deps.swap.executeSwap).toHaveBeenNthCalledWith(1, {
      sourceAccountId: 'https://source.mint',
      targetAccountId: 'https://target.mint',
      amount: sat(100),
      drain: true,
    })
    expect(deps.swap.executeSwap).toHaveBeenNthCalledWith(2, {
      sourceAccountId: 'https://source.mint',
      targetAccountId: 'https://target.mint',
      amount: sat(3),
      drain: true,
    })
  })

  it('returns success with a visible remainder when the leftover is not worth another swap', async () => {
    vi.mocked(deps.balance.getByModule)
      .mockResolvedValueOnce([
        { moduleId: 'cashu', total: sat(0), accounts: [] },
      ])
      .mockResolvedValueOnce([
        {
          moduleId: 'cashu',
          total: sat(3),
          accounts: [{ id: 'https://source.mint', label: 'source', amount: sat(3) }],
        },
      ])

    vi.mocked(deps.payment.redeem).mockResolvedValue(Ok({
      requestId: 'redeem-1',
      amount: sat(100),
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      completed: true,
      accountId: 'https://source.mint',
    }))
    vi.mocked(deps.swap.estimateSwap)
      .mockResolvedValueOnce(Ok({
        fee: sat(5),
        sourceAmount: sat(100),
        targetAmount: sat(100),
      }))
      .mockResolvedValueOnce(Ok({
        fee: sat(5),
        sourceAmount: sat(100),
        targetAmount: sat(100),
      }))
      .mockResolvedValueOnce(Ok({
        fee: sat(3),
        sourceAmount: sat(3),
        targetAmount: sat(3),
      }))
    vi.mocked(deps.swap.executeSwap).mockResolvedValueOnce(Ok({
      sendTxId: 'send-1',
      receiveTxId: 'recv-1',
      amount: sat(95),
      fee: sat(5),
    }))

    const result = await executeSwapReceive(deps, {
      token: 'cashuA...',
      amountSats: 100,
      sourceMintUrl: 'https://source.mint',
      targetMintUrl: 'https://target.mint',
    })

    expect(result).toEqual({
      state: 'swapped',
      amount: 95,
      sourceRemainder: 3,
      sourceMintUrl: 'https://source.mint',
      targetMintUrl: 'https://target.mint',
    })
    expect(deps.swap.executeSwap).toHaveBeenCalledTimes(1)
  })

  it('normalizes source account IDs when calculating visible remainder', async () => {
    vi.mocked(deps.balance.getByModule)
      .mockResolvedValueOnce([
        { moduleId: 'cashu', total: sat(0), accounts: [] },
      ])
      .mockResolvedValueOnce([
        {
          moduleId: 'cashu',
          total: sat(3),
          accounts: [{ id: 'https://source.mint', label: 'source', amount: sat(3) }],
        },
      ])

    vi.mocked(deps.payment.redeem).mockResolvedValue(Ok({
      requestId: 'redeem-1',
      amount: sat(100),
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      completed: true,
      accountId: 'https://source.mint/',
    }))
    vi.mocked(deps.swap.estimateSwap)
      .mockResolvedValueOnce(Ok({
        fee: sat(5),
        sourceAmount: sat(100),
        targetAmount: sat(100),
      }))
      .mockResolvedValueOnce(Ok({
        fee: sat(5),
        sourceAmount: sat(100),
        targetAmount: sat(100),
      }))
      .mockResolvedValueOnce(Ok({
        fee: sat(3),
        sourceAmount: sat(3),
        targetAmount: sat(3),
      }))
    vi.mocked(deps.swap.executeSwap).mockResolvedValueOnce(Ok({
      sendTxId: 'send-1',
      receiveTxId: 'recv-1',
      amount: sat(95),
      fee: sat(5),
    }))

    const result = await executeSwapReceive(deps, {
      token: 'cashuA...',
      amountSats: 100,
      sourceMintUrl: 'https://source.mint/',
      targetMintUrl: 'https://target.mint',
    })

    expect(result).toEqual({
      state: 'swapped',
      amount: 95,
      sourceRemainder: 3,
      sourceMintUrl: 'https://source.mint/',
      targetMintUrl: 'https://target.mint',
    })
  })

  it('surfaces the first swap failure after redeem', async () => {
    vi.mocked(deps.balance.getByModule).mockResolvedValue([
      { moduleId: 'cashu', total: sat(0), accounts: [] },
    ])
    vi.mocked(deps.payment.redeem).mockResolvedValue(Ok({
      requestId: 'redeem-1',
      amount: sat(100),
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      completed: true,
      accountId: 'https://source.mint',
    }))
    vi.mocked(deps.swap.estimateSwap).mockResolvedValue(Ok({
      fee: sat(5),
      sourceAmount: sat(100),
      targetAmount: sat(100),
    }))
    vi.mocked(deps.swap.executeSwap).mockResolvedValue(Err(new UnknownError('melt failed')))

    const result = await executeSwapReceive(deps, {
      token: 'cashuA...',
      amountSats: 100,
      sourceMintUrl: 'https://source.mint',
      targetMintUrl: 'https://target.mint',
    })

    expect(result).toEqual({
      state: 'redeemed-on-source',
      amount: 100,
      sourceMintUrl: 'https://source.mint',
      targetMintUrl: 'https://target.mint',
      error: expect.objectContaining({ code: 'UNKNOWN', message: 'melt failed' }),
    })
  })

  it('keeps funds on source when post-redeem swap estimation fails', async () => {
    vi.mocked(deps.balance.getByModule).mockResolvedValue([
      { moduleId: 'cashu', total: sat(0), accounts: [] },
    ])
    vi.mocked(deps.payment.redeem).mockResolvedValue(Ok({
      requestId: 'redeem-1',
      amount: sat(100),
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      completed: true,
      accountId: 'https://source.mint',
    }))
    vi.mocked(deps.swap.estimateSwap)
      .mockResolvedValueOnce(Ok({
        fee: sat(5),
        sourceAmount: sat(100),
        targetAmount: sat(100),
      }))
      .mockResolvedValueOnce(Err(new NetworkError('quote failed')))

    const result = await executeSwapReceive(deps, {
      token: 'cashuA...',
      amountSats: 100,
      sourceMintUrl: 'https://source.mint',
      targetMintUrl: 'https://target.mint',
    })

    expect(result).toEqual({
      state: 'redeemed-on-source',
      amount: 100,
      sourceMintUrl: 'https://source.mint',
      targetMintUrl: 'https://target.mint',
      error: expect.objectContaining({ code: 'SWAP_ESTIMATE_FAILED', message: 'quote failed' }),
    })
    expect(deps.swap.executeSwap).not.toHaveBeenCalled()
  })
})
