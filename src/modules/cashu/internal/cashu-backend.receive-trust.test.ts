import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const manager = {
    mint: {
      getAllMints: vi.fn(),
      addMint: vi.fn(),
      trustMint: vi.fn(),
      untrustMint: vi.fn(),
    },
    ops: {
      receive: {
        prepare: vi.fn(),
        execute: vi.fn(),
        cancel: vi.fn(),
      },
    },
  }

  return {
    manager,
    getCocoManager: vi.fn(),
    getDecodedToken: vi.fn(),
  }
})

vi.mock('./coco-sdk', () => ({
  getCocoManager: mocks.getCocoManager,
  getPendingMintQuotes: vi.fn(),
}))

vi.mock('@cashu/cashu-ts', () => ({}))
vi.mock('coco-cashu-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('coco-cashu-core')>()
  return { ...actual, getDecodedToken: mocks.getDecodedToken }
})

import { addMint, estimateReceiveFee, receiveToken } from './cashu-backend'

describe('cashu-backend receive mint trust scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCocoManager.mockResolvedValue(mocks.manager)
    mocks.getDecodedToken.mockReturnValue({ mint: 'https://source.mint' })
    mocks.manager.mint.getAllMints.mockResolvedValue([])
    mocks.manager.mint.addMint.mockResolvedValue(undefined)
    mocks.manager.mint.trustMint.mockResolvedValue(undefined)
    mocks.manager.mint.untrustMint.mockResolvedValue(undefined)
    mocks.manager.ops.receive.prepare.mockResolvedValue({ id: 'receive-op-1', amount: 10, fee: 1 })
    mocks.manager.ops.receive.execute.mockResolvedValue(undefined)
    mocks.manager.ops.receive.cancel.mockResolvedValue(undefined)
  })

  it('keeps user-trusted token mints trusted during fee estimation', async () => {
    await estimateReceiveFee('cashuA...', { trustedMintUrls: ['https://source.mint'] })

    expect(mocks.manager.mint.addMint).toHaveBeenCalledWith('https://source.mint', { trusted: true })
    expect(mocks.manager.mint.trustMint).not.toHaveBeenCalled()
    expect(mocks.manager.mint.untrustMint).not.toHaveBeenCalled()
    expect(mocks.manager.ops.receive.cancel).toHaveBeenCalledWith('receive-op-1')
  })

  it('restores untrusted state after fee estimation for mints outside user settings', async () => {
    await estimateReceiveFee('cashuA...', { trustedMintUrls: ['https://target.mint'] })

    expect(mocks.manager.mint.addMint).toHaveBeenCalledWith('https://source.mint', { trusted: false })
    expect(mocks.manager.mint.trustMint).toHaveBeenCalledWith('https://source.mint')
    expect(mocks.manager.mint.untrustMint).toHaveBeenCalledWith('https://source.mint')
    expect(mocks.manager.ops.receive.cancel).toHaveBeenCalledWith('receive-op-1')
  })

  it('fails instead of silently completing when fee-estimate cancel fails', async () => {
    mocks.manager.ops.receive.cancel.mockRejectedValue(new Error('cancel failed'))

    await expect(estimateReceiveFee('cashuA...', { trustedMintUrls: ['https://target.mint'] }))
      .rejects
      .toThrow('Failed to cancel receive fee estimate operation receive-op-1: cancel failed')

    expect(mocks.manager.mint.addMint).toHaveBeenCalledWith('https://source.mint', { trusted: false })
    expect(mocks.manager.mint.trustMint).toHaveBeenCalledWith('https://source.mint')
    expect(mocks.manager.mint.untrustMint).toHaveBeenCalledWith('https://source.mint')
  })

  it('treats normalized configured mint URLs as trusted during fee estimation', async () => {
    mocks.getDecodedToken.mockReturnValue({ mint: 'https://source.mint/' })

    await estimateReceiveFee('cashuA...', { trustedMintUrls: ['https://source.mint'] })

    expect(mocks.manager.mint.addMint).toHaveBeenCalledWith('https://source.mint', { trusted: true })
    expect(mocks.manager.mint.untrustMint).not.toHaveBeenCalled()
  })

  it('restores untrusted state after receiving a token from a mint outside user settings', async () => {
    const result = await receiveToken('cashuA...', { trustedMintUrls: ['https://target.mint'] })

    expect(result).toEqual({
      amount: 9,
      fee: 1,
      unit: 'sat',
      mintUrl: 'https://source.mint',
    })
    expect(mocks.manager.mint.addMint).toHaveBeenCalledWith('https://source.mint', { trusted: false })
    expect(mocks.manager.mint.trustMint).toHaveBeenCalledWith('https://source.mint')
    expect(mocks.manager.ops.receive.execute).toHaveBeenCalledWith({ id: 'receive-op-1', amount: 10, fee: 1 })
    expect(mocks.manager.mint.untrustMint).toHaveBeenCalledWith('https://source.mint')
  })

  it('classifies receive fee shortfall while restoring untrusted mint state', async () => {
    mocks.manager.ops.receive.prepare.mockRejectedValue(new Error('Receive amount is not sufficient after fees'))

    await expect(receiveToken('cashuA...', { trustedMintUrls: ['https://target.mint'] }))
      .rejects
      .toMatchObject({ code: 'REDEEM_FEE_TOO_HIGH' })

    expect(mocks.manager.mint.addMint).toHaveBeenCalledWith('https://source.mint', { trusted: false })
    expect(mocks.manager.mint.trustMint).toHaveBeenCalledWith('https://source.mint')
    expect(mocks.manager.mint.untrustMint).toHaveBeenCalledWith('https://source.mint')
  })

  it('rejects zero-net receive before executing the receive operation', async () => {
    mocks.manager.ops.receive.prepare.mockResolvedValue({ id: 'receive-op-1', amount: 1, fee: 1 })

    await expect(receiveToken('cashuA...', { trustedMintUrls: ['https://target.mint'] }))
      .rejects
      .toMatchObject({ code: 'REDEEM_FEE_TOO_HIGH' })

    expect(mocks.manager.ops.receive.execute).not.toHaveBeenCalled()
    expect(mocks.manager.mint.untrustMint).toHaveBeenCalledWith('https://source.mint')
  })

  it('rejects zero-net fee estimates after cancelling the prepared receive operation', async () => {
    mocks.manager.ops.receive.prepare.mockResolvedValue({ id: 'receive-op-1', amount: 1, fee: 1 })

    await expect(estimateReceiveFee('cashuA...', { trustedMintUrls: ['https://target.mint'] }))
      .rejects
      .toMatchObject({ code: 'REDEEM_FEE_TOO_HIGH' })

    expect(mocks.manager.ops.receive.cancel).toHaveBeenCalledWith('receive-op-1')
    expect(mocks.manager.mint.untrustMint).toHaveBeenCalledWith('https://source.mint')
  })

  it('fails instead of silently completing when untrusted state cannot be restored', async () => {
    mocks.manager.mint.untrustMint.mockRejectedValue(new Error('restore failed'))

    await expect(receiveToken('cashuA...', { trustedMintUrls: ['https://target.mint'] }))
      .rejects
      .toThrow('Failed to restore untrusted mint state for https://source.mint: restore failed')

    expect(mocks.manager.ops.receive.execute).toHaveBeenCalledWith({ id: 'receive-op-1', amount: 10, fee: 1 })
    expect(mocks.manager.mint.untrustMint).toHaveBeenCalledWith('https://source.mint')
  })

  it('does not untrust if the mint becomes trusted while the receive operation is in flight', async () => {
    const trustedMintUrls = ['https://target.mint']
    mocks.manager.ops.receive.execute.mockImplementation(async () => {
      trustedMintUrls.push('https://source.mint')
    })

    await receiveToken('cashuA...', {
      trustedMintUrls,
      getCurrentTrustedMintUrls: () => trustedMintUrls,
    })

    expect(mocks.manager.mint.addMint).toHaveBeenCalledWith('https://source.mint', { trusted: false })
    expect(mocks.manager.mint.trustMint).toHaveBeenCalledWith('https://source.mint')
    expect(mocks.manager.mint.untrustMint).not.toHaveBeenCalled()
  })

  it('does not untrust a mint that was already trusted before the operation', async () => {
    mocks.manager.mint.getAllMints.mockResolvedValue([
      { mintUrl: 'https://source.mint', trusted: true },
    ])

    await receiveToken('cashuA...', { trustedMintUrls: ['https://target.mint'] })

    // addMint is called to ensure keyset keys are downloaded (for receive)
    expect(mocks.manager.mint.addMint).toHaveBeenCalledWith('https://source.mint')
    // But trust state should not change
    expect(mocks.manager.mint.trustMint).not.toHaveBeenCalled()
    expect(mocks.manager.mint.untrustMint).not.toHaveBeenCalled()
  })

  it('trusts an already-known untrusted mint when the user explicitly adds it', async () => {
    mocks.manager.mint.getAllMints.mockResolvedValue([
      { mintUrl: 'https://source.mint', trusted: false },
    ])

    await addMint('https://source.mint/')

    expect(mocks.manager.mint.addMint).not.toHaveBeenCalled()
    expect(mocks.manager.mint.trustMint).toHaveBeenCalledWith('https://source.mint')
    expect(mocks.manager.mint.untrustMint).not.toHaveBeenCalled()
  })
})
