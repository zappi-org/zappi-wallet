import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const manager = {
    mint: {
      getAllMints: vi.fn(),
      addMint: vi.fn(),
      trustMint: vi.fn(),
      untrustMint: vi.fn(),
    },
    wallet: { decodeToken: vi.fn() },
    ops: {
      receive: {
        prepare: vi.fn(),
        get: vi.fn(),
        refresh: vi.fn(),
        execute: vi.fn(),
        cancel: vi.fn(),
      },
    },
  }

  return {
    manager,
    getCocoManager: vi.fn(),
    getTokenMetadata: vi.fn(),
  }
})

vi.mock('./coco-sdk', () => ({
  getCocoManager: mocks.getCocoManager,
  getPendingMintQuotes: vi.fn(),
}))

vi.mock('@cashu/cashu-ts', () => ({
  getTokenMetadata: mocks.getTokenMetadata,
}))

vi.mock('@cashu/coco-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cashu/coco-core')>()
  return { ...actual }
})

import { addMint, estimateReceiveFee, receiveToken } from './cashu-backend'

describe('cashu-backend receive mint trust scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCocoManager.mockResolvedValue(mocks.manager)
    mocks.getTokenMetadata.mockReturnValue({ mint: 'https://source.mint' })
    mocks.manager.mint.getAllMints.mockResolvedValue([])
    mocks.manager.mint.addMint.mockResolvedValue(undefined)
    mocks.manager.mint.trustMint.mockResolvedValue(undefined)
    mocks.manager.mint.untrustMint.mockResolvedValue(undefined)
    mocks.manager.ops.receive.prepare.mockResolvedValue({ id: 'receive-op-1', amount: 10, fee: 1 })
    mocks.manager.ops.receive.execute.mockResolvedValue(undefined)
    mocks.manager.ops.receive.cancel.mockResolvedValue(undefined)
  })

  it('rejects malformed token data without retrying or preparing a receive', async () => {
    mocks.getTokenMetadata.mockImplementationOnce(() => { throw new Error('Invalid CBOR') })
    await expect(receiveToken('malformed', undefined, { onPrepared: vi.fn() }))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN', isRetryable: false })
    expect(mocks.manager.ops.receive.prepare).not.toHaveBeenCalled()
  })

  it('persists the operation checkpoint before executing and stops if persistence fails', async () => {
    const onPrepared = vi.fn().mockRejectedValue(new Error('disk unavailable'))
    await expect(receiveToken('cashuA...', undefined, { onPrepared })).rejects.toThrow()
    expect(onPrepared).toHaveBeenCalledWith('receive-op-1')
    expect(mocks.manager.ops.receive.execute).not.toHaveBeenCalled()
  })

  it('accepts the same operation finalized by Coco after execute throws', async () => {
    mocks.manager.ops.receive.execute.mockRejectedValueOnce(new Error('response lost'))
    mocks.manager.ops.receive.get.mockResolvedValueOnce({ id: 'receive-op-1', state: 'finalized' })
    await expect(receiveToken('cashuA...')).resolves.toMatchObject({ amount: 9 })
  })

  it('does not treat a spent token error as received without finalized operation evidence', async () => {
    mocks.manager.ops.receive.execute.mockRejectedValueOnce(new Error('Token already spent'))
    mocks.manager.ops.receive.get.mockResolvedValueOnce({ state: 'rolled_back' })
    await expect(receiveToken('cashuA...')).rejects.toThrow()
  })

  it('recovers the persisted operation after restart without preparing a second one', async () => {
    const proof = { secret: 'secret', C: 'signature', amount: 10 }
    const op = { id: 'saved-op', state: 'executing', unit: 'sat', mintUrl: 'https://source.mint', inputProofs: [proof], amount: 10, fee: 1 }
    mocks.manager.wallet.decodeToken.mockResolvedValue({ proofs: [proof] })
    mocks.manager.ops.receive.get.mockResolvedValueOnce(op)
    mocks.manager.ops.receive.refresh.mockResolvedValueOnce({ ...op, state: 'finalized' })
    await expect(receiveToken('cashuA...', undefined, {
      operationId: op.id,
      onPrepared: vi.fn(),
    })).resolves.toMatchObject({ amount: 9 })
    expect(mocks.manager.ops.receive.prepare).not.toHaveBeenCalled()
    expect(mocks.manager.ops.receive.execute).not.toHaveBeenCalled()
    expect(mocks.manager.ops.receive.refresh).toHaveBeenCalledWith('saved-op')
  })

  it('leaves unresolved execution retryable without creating another operation', async () => {
    const proof = { secret: 'secret', C: 'signature', amount: 10 }
    const op = { id: 'saved-op', state: 'executing', unit: 'sat', mintUrl: 'https://source.mint', inputProofs: [proof], amount: 10, fee: 1 }
    mocks.manager.wallet.decodeToken.mockResolvedValue({ proofs: [proof] })
    mocks.manager.ops.receive.get.mockResolvedValueOnce(op)
    mocks.manager.ops.receive.refresh.mockResolvedValueOnce(op)
    await expect(receiveToken('cashuA...', undefined, { operationId: op.id, onPrepared: vi.fn() }))
      .rejects.toMatchObject({ isRetryable: true })
    expect(mocks.manager.ops.receive.prepare).not.toHaveBeenCalled()
    expect(mocks.manager.ops.receive.execute).not.toHaveBeenCalled()
  })

  it('marks an explicitly rolled-back operation nonretryable', async () => {
    const proof = { secret: 'secret', C: 'signature', amount: 10 }
    mocks.manager.wallet.decodeToken.mockResolvedValue({ proofs: [proof] })
    mocks.manager.ops.receive.get.mockResolvedValueOnce({
      id: 'saved-op', state: 'rolled_back', unit: 'sat', mintUrl: 'https://source.mint', inputProofs: [proof], amount: 10, fee: 1,
    })
    await expect(receiveToken('cashuA...', undefined, { operationId: 'saved-op', onPrepared: vi.fn() }))
      .rejects.toMatchObject({ isRetryable: false })
    expect(mocks.manager.ops.receive.prepare).not.toHaveBeenCalled()
  })

  it.each(['unit', 'keyset'])('rejects a finalized operation with a different %s', async (mismatch) => {
    const proof = { id: 'keyset', secret: 'secret', C: 'signature', amount: 10 }
    mocks.manager.wallet.decodeToken.mockResolvedValue({ unit: 'sat', proofs: [proof] })
    mocks.manager.ops.receive.get.mockResolvedValueOnce({
      id: 'saved-op', state: 'finalized', mintUrl: 'https://source.mint', amount: 10, fee: 1,
      unit: mismatch === 'unit' ? 'usd' : 'sat',
      inputProofs: [{ ...proof, id: mismatch === 'keyset' ? 'other' : proof.id }],
    })
    await expect(receiveToken('cashuA...', undefined, { operationId: 'saved-op', onPrepared: vi.fn() }))
      .rejects.toMatchObject({ isRetryable: false })
    expect(mocks.manager.ops.receive.execute).not.toHaveBeenCalled()
  })

  it('rejects a persisted operation belonging to a different token', async () => {
    mocks.manager.wallet.decodeToken.mockResolvedValue({ proofs: [{ secret: 'other', C: 'c', amount: 10 }] })
    mocks.manager.ops.receive.get.mockResolvedValueOnce({
      id: 'saved-op', state: 'finalized', unit: 'sat', mintUrl: 'https://source.mint',
      inputProofs: [{ secret: 'original', C: 'c', amount: 10 }], amount: 10, fee: 1,
    })
    await expect(receiveToken('cashuA...', undefined, { operationId: 'saved-op', onPrepared: vi.fn() })).rejects.toThrow()
    expect(mocks.manager.ops.receive.execute).not.toHaveBeenCalled()
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
      .toMatchObject({ code: 'MINT_ERROR' })

    expect(mocks.manager.mint.addMint).toHaveBeenCalledWith('https://source.mint', { trusted: false })
    expect(mocks.manager.mint.trustMint).toHaveBeenCalledWith('https://source.mint')
    expect(mocks.manager.mint.untrustMint).toHaveBeenCalledWith('https://source.mint')
  })

  it('treats normalized configured mint URLs as trusted during fee estimation', async () => {
    mocks.getTokenMetadata.mockReturnValue({ mint: 'https://source.mint/' })

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

  it('rejects zero-net fee estimates via SDK ProofValidationError classification', async () => {
    const { ProofValidationError } = await import('@cashu/coco-core')
    mocks.manager.ops.receive.prepare.mockRejectedValue(
      new ProofValidationError('Receive amount is not sufficient after fees'),
    )

    await expect(estimateReceiveFee('cashuA...', { trustedMintUrls: ['https://target.mint'] }))
      .rejects
      .toMatchObject({ code: 'REDEEM_FEE_TOO_HIGH' })

    expect(mocks.manager.ops.receive.cancel).not.toHaveBeenCalled()
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
