import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PaymentAliasService } from '@/core/services/payment-alias.service'
import { Ok, Err } from '@/core/domain/result'
import {
  NpubcashAuthError,
  NpubcashApiError,
  NpubcashUsernameTakenError,
  NpubcashPaymentRequiredError,
} from '@/core/errors/npubcash'
import type {
  PaymentAliasProvider,
  AuthSession,
} from '@/core/ports/driven/payment-alias-provider.port'
import type { NostrSigner } from '@/core/ports/driven/nostr-signer.port'
import type { RoutePaymentOperator } from '@/core/ports/driven/route-payment-operator.port'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import type { ParsedCashuRequest } from '@/core/domain/input-types'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { EventBus } from '@/core/events/event-bus'

const PRIVKEY = 'privkey-hex'
const SESSION: AuthSession = { token: 'session-token', expiresAt: 0 }
const MINT_URL = 'https://mint.example'

function createMockSigner(): NostrSigner {
  return {
    createNip98Token: vi.fn(() => 'nip98-token'),
    getPublicKey: vi.fn(() => 'pubkey-hex'),
    getNpub: vi.fn(() => 'npub1test'),
  }
}

function createMockProvider(): PaymentAliasProvider {
  return {
    authenticate: vi.fn(),
    getAccountInfo: vi.fn(),
    purchaseAlias: vi.fn(),
    setPreferredMint: vi.fn(),
    toggleLock: vi.fn(),
    getPaidQuotes: vi.fn(),
    subscribePaidQuotes: vi.fn(),
  }
}

function createMockRouteOperator(): RoutePaymentOperator {
  return {
    createMintQuote: vi.fn(),
    markMintQuoteAsSwap: vi.fn(),
    unmarkMintQuoteAsSwap: vi.fn(),
    prepareMelt: vi.fn(),
    executeMelt: vi.fn(),
    rollbackMelt: vi.fn(),
    redeemMintQuote: vi.fn(),
    mintAndReceive: vi.fn(),
    prepareTokenSend: vi.fn(),
    executeTokenSend: vi.fn(),
    rollbackTokenSend: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockCodec(): Pick<TokenCodec, 'decodePaymentRequest'> {
  return { decodePaymentRequest: vi.fn() }
}

function parsedCreq(amount = 100, mints: string[] = [MINT_URL]): ParsedCashuRequest {
  return {
    id: '',
    amount,
    unit: 'sat',
    mints,
    transports: [],
    hasNostrTransport: false,
    hasPostTransport: false,
  }
}

function createMockTxRepo(): TransactionRepository {
  return {
    save: vi.fn(),
    getById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    deleteAll: vi.fn(),
    deleteOlderThan: vi.fn(),
  }
}

function createMockEventBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => {}),
    off: vi.fn(),
  }
}

describe('PaymentAliasService.changeAlias', () => {
  let provider: PaymentAliasProvider
  let routePaymentOperator: RoutePaymentOperator
  let txRepo: TransactionRepository
  let eventBus: EventBus
  let codec: Pick<TokenCodec, 'decodePaymentRequest'>
  let service: PaymentAliasService

  beforeEach(() => {
    provider = createMockProvider()
    routePaymentOperator = createMockRouteOperator()
    txRepo = createMockTxRepo()
    eventBus = createMockEventBus()
    codec = createMockCodec()
    service = new PaymentAliasService(
      provider,
      { mintAndReceive: vi.fn() },
      vi.fn(() => createMockSigner()),
      txRepo,
      routePaymentOperator,
      eventBus,
      'test.domain',
      codec,
    )
  })

  function givenAuthenticated() {
    vi.mocked(provider.authenticate).mockResolvedValue(Ok(SESSION))
  }

  function givenCreqParsed(amount = 100, mints = [MINT_URL]) {
    vi.mocked(codec.decodePaymentRequest).mockReturnValue(parsedCreq(amount, mints))
  }

  it('returns the auth error and never calls purchaseAlias when auth fails', async () => {
    const authError = new NpubcashAuthError('auth failed')
    vi.mocked(provider.authenticate).mockResolvedValue(Err(authError))

    const result = await service.changeAlias(PRIVKEY, 'alice', '')

    expect(result).toEqual(Err(authError))
    expect(provider.purchaseAlias).not.toHaveBeenCalled()
  })

  it('returns non-402 errors as-is', async () => {
    givenAuthenticated()
    const taken = new NpubcashUsernameTakenError()
    vi.mocked(provider.purchaseAlias).mockResolvedValue(Err(taken))

    const result = await service.changeAlias(PRIVKEY, 'alice', '')

    expect(result).toEqual(Err(taken))
    expect(codec.decodePaymentRequest).not.toHaveBeenCalled()
    expect(txRepo.save).not.toHaveBeenCalled()
  })

  it('does not re-purchase when a token was already provided and server still returns 402', async () => {
    givenAuthenticated()
    const paymentReq = new NpubcashPaymentRequiredError('creq-encoded')
    vi.mocked(provider.purchaseAlias).mockResolvedValue(Err(paymentReq))

    const result = await service.changeAlias(PRIVKEY, 'alice', 'already-made-token')

    expect(result).toEqual(Err(paymentReq))
    expect(provider.purchaseAlias).toHaveBeenCalledTimes(1)
    expect(codec.decodePaymentRequest).not.toHaveBeenCalled()
    expect(txRepo.save).not.toHaveBeenCalled()
  })

  it('returns the 402 error without creating a tx when creq has no mintUrl or amount', async () => {
    givenAuthenticated()
    const paymentReq = new NpubcashPaymentRequiredError('creq-encoded')
    vi.mocked(provider.purchaseAlias).mockResolvedValue(Err(paymentReq))
    givenCreqParsed(0, [])

    const result = await service.changeAlias(PRIVKEY, 'alice', '')

    expect(result).toEqual(Err(paymentReq))
    expect(txRepo.save).not.toHaveBeenCalled()
    expect(routePaymentOperator.prepareTokenSend).not.toHaveBeenCalled()
  })

  it('mints a token, re-purchases, settles and emits 2 events on success (402 + empty token)', async () => {
    givenAuthenticated()
    const paymentReq = new NpubcashPaymentRequiredError('creq-encoded')
    vi.mocked(provider.purchaseAlias)
      .mockResolvedValueOnce(Err(paymentReq))
      .mockResolvedValueOnce(Ok({ alias: 'alice', npub: 'npub1test' }))
    givenCreqParsed(100)
    vi.mocked(routePaymentOperator.prepareTokenSend).mockResolvedValue({ operationId: 'op-1', fee: 0 })
    vi.mocked(routePaymentOperator.executeTokenSend).mockResolvedValue({ token: 'cashu-token-abc' })

    const result = await service.changeAlias(PRIVKEY, 'alice', '')

    expect(result).toEqual(Ok({ alias: 'alice', npub: 'npub1test' }))

    // 탐색(빈 토큰) + 재구매(발행 토큰) = 2회
    expect(provider.purchaseAlias).toHaveBeenCalledTimes(2)
    expect(provider.purchaseAlias).toHaveBeenNthCalledWith(2, SESSION, 'alice', 'cashu-token-abc')

    // ① tx 생성
    const savedTx = vi.mocked(txRepo.save).mock.calls[0][0]
    expect(savedTx).toMatchObject({
      direction: 'send',
      protocol: 'nut24',
      intent: 'request-pay',
      memo: 'username:alice@test.domain',
      accountId: MINT_URL,
      amount: { value: 100n, unit: 'sat' },
      status: 'pending',
      metadata: {
        destination: 'alice@test.domain',
        domain: 'test.domain',
        paymentRequest: 'creq-encoded',
      },
    })

    // ② 발행된 토큰 기록
    expect(txRepo.update).toHaveBeenCalledWith(
      savedTx.id,
      expect.objectContaining({
        metadata: expect.objectContaining({
          token: 'cashu-token-abc',
          operationId: 'op-1',
          tokenState: 'unspent',
        }),
      }),
    )

    // ③ settle
    expect(txRepo.update).toHaveBeenCalledWith(
      savedTx.id,
      expect.objectContaining({ status: 'settled', outcome: 'claimed' }),
    )

    // ④ 이벤트 2개
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'balance:changed' }))
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'transactions:changed' }))
  })

  it('rolls back and fails the tx, returning the error when re-purchase is rejected', async () => {
    givenAuthenticated()
    const paymentReq = new NpubcashPaymentRequiredError('creq-encoded')
    const reject = new NpubcashApiError(400, 'payment rejected')
    vi.mocked(provider.purchaseAlias)
      .mockResolvedValueOnce(Err(paymentReq))
      .mockResolvedValueOnce(Err(reject))
    givenCreqParsed(100)
    vi.mocked(routePaymentOperator.prepareTokenSend).mockResolvedValue({ operationId: 'op-1', fee: 0 })
    vi.mocked(routePaymentOperator.executeTokenSend).mockResolvedValue({ token: 'cashu-token-abc' })

    const result = await service.changeAlias(PRIVKEY, 'alice', '')

    expect(result).toEqual(Err(reject))
    expect(routePaymentOperator.rollbackTokenSend).toHaveBeenCalledWith('op-1')
    const savedTxId = vi.mocked(txRepo.save).mock.calls[0][0].id
    expect(txRepo.update).toHaveBeenCalledWith(
      savedTxId,
      expect.objectContaining({ status: 'failed' }),
    )
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('rolls back, fails the tx, and rethrows when token minting throws', async () => {
    givenAuthenticated()
    const paymentReq = new NpubcashPaymentRequiredError('creq-encoded')
    vi.mocked(provider.purchaseAlias).mockResolvedValueOnce(Err(paymentReq))
    givenCreqParsed(100)
    vi.mocked(routePaymentOperator.prepareTokenSend).mockResolvedValue({ operationId: 'op-1', fee: 0 })
    vi.mocked(routePaymentOperator.executeTokenSend).mockRejectedValue(new Error('mint down'))

    await expect(service.changeAlias(PRIVKEY, 'alice', '')).rejects.toThrow('mint down')

    expect(routePaymentOperator.rollbackTokenSend).toHaveBeenCalledWith('op-1')
    const savedTxId = vi.mocked(txRepo.save).mock.calls[0][0].id
    expect(txRepo.update).toHaveBeenCalledWith(
      savedTxId,
      expect.objectContaining({ status: 'failed' }),
    )
  })
})

describe('PaymentAliasService.checkAliasPrice', () => {
  let provider: PaymentAliasProvider
  let routePaymentOperator: RoutePaymentOperator
  let codec: Pick<TokenCodec, 'decodePaymentRequest'>
  let service: PaymentAliasService

  beforeEach(() => {
    provider = createMockProvider()
    routePaymentOperator = createMockRouteOperator()
    codec = createMockCodec()
    service = new PaymentAliasService(
      provider,
      { mintAndReceive: vi.fn() },
      vi.fn(() => createMockSigner()),
      createMockTxRepo(),
      routePaymentOperator,
      createMockEventBus(),
      'test.domain',
      codec,
    )
  })

  function givenAuthenticated() {
    vi.mocked(provider.authenticate).mockResolvedValue(Ok(SESSION))
  }

  it('returns the auth error as-is when auth fails', async () => {
    const authError = new NpubcashAuthError('auth failed')
    vi.mocked(provider.authenticate).mockResolvedValue(Err(authError))

    const result = await service.checkAliasPrice(PRIVKEY, 'alice')

    expect(result).toEqual(Err(authError))
    expect(provider.purchaseAlias).not.toHaveBeenCalled()
  })

  it('decodes the creq and returns amount/unit/mintUrl on 402', async () => {
    givenAuthenticated()
    const paymentReq = new NpubcashPaymentRequiredError('creq-encoded')
    vi.mocked(provider.purchaseAlias).mockResolvedValue(Err(paymentReq))
    vi.mocked(codec.decodePaymentRequest).mockReturnValue(parsedCreq(100, [MINT_URL]))

    const result = await service.checkAliasPrice(PRIVKEY, 'alice')

    expect(codec.decodePaymentRequest).toHaveBeenCalledWith('creq-encoded')
    expect(result).toEqual(Ok({ amount: 100, unit: 'sat', mintUrl: MINT_URL }))
  })

  it('returns an empty mintUrl when the creq lists no mints', async () => {
    givenAuthenticated()
    const paymentReq = new NpubcashPaymentRequiredError('creq-encoded')
    vi.mocked(provider.purchaseAlias).mockResolvedValue(Err(paymentReq))
    vi.mocked(codec.decodePaymentRequest).mockReturnValue(parsedCreq(100, []))

    const result = await service.checkAliasPrice(PRIVKEY, 'alice')

    expect(result).toEqual(Ok({ amount: 100, unit: 'sat', mintUrl: '' }))
  })

  it('returns non-402 errors as-is', async () => {
    givenAuthenticated()
    const taken = new NpubcashUsernameTakenError()
    vi.mocked(provider.purchaseAlias).mockResolvedValue(Err(taken))

    const result = await service.checkAliasPrice(PRIVKEY, 'alice')

    expect(result).toEqual(Err(taken))
    expect(codec.decodePaymentRequest).not.toHaveBeenCalled()
  })

  it('returns a free price when the server accepts without payment', async () => {
    givenAuthenticated()
    vi.mocked(provider.purchaseAlias).mockResolvedValue(Ok({ alias: 'alice', npub: 'npub1test' }))

    const result = await service.checkAliasPrice(PRIVKEY, 'alice')

    expect(result).toEqual(Ok({ amount: 0, unit: 'sat', mintUrl: '' }))
  })
})

describe('PaymentAliasService.getCurrentAlias', () => {
  let provider: PaymentAliasProvider
  let service: PaymentAliasService

  beforeEach(() => {
    provider = createMockProvider()
    service = new PaymentAliasService(
      provider,
      { mintAndReceive: vi.fn() },
      vi.fn(() => createMockSigner()),
      createMockTxRepo(),
      createMockRouteOperator(),
      createMockEventBus(),
      'test.domain',
      createMockCodec(),
    )
  })

  it('returns the auth error as-is when auth fails', async () => {
    const authError = new NpubcashAuthError('auth failed')
    vi.mocked(provider.authenticate).mockResolvedValue(Err(authError))

    const result = await service.getCurrentAlias(PRIVKEY)

    expect(result).toEqual(Err(authError))
    expect(provider.getAccountInfo).not.toHaveBeenCalled()
  })

  it('returns the getAccountInfo error as-is', async () => {
    vi.mocked(provider.authenticate).mockResolvedValue(Ok(SESSION))
    const infoError = new NpubcashApiError(500, 'server error')
    vi.mocked(provider.getAccountInfo).mockResolvedValue(Err(infoError))

    const result = await service.getCurrentAlias(PRIVKEY)

    expect(result).toEqual(Err(infoError))
  })

  it('returns the existing alias with the npub when the account has one', async () => {
    vi.mocked(provider.authenticate).mockResolvedValue(Ok(SESSION))
    vi.mocked(provider.getAccountInfo).mockResolvedValue(
      Ok({ alias: 'alice', domain: 'test.domain', mintUrl: MINT_URL, lockQuote: false }),
    )

    const result = await service.getCurrentAlias(PRIVKEY)

    expect(result).toEqual(Ok({ alias: 'alice', npub: 'npub1test' }))
  })

  it('falls back to the npub as alias when the account has none', async () => {
    vi.mocked(provider.authenticate).mockResolvedValue(Ok(SESSION))
    vi.mocked(provider.getAccountInfo).mockResolvedValue(
      Ok({ alias: null, domain: 'test.domain', mintUrl: MINT_URL, lockQuote: false }),
    )

    const result = await service.getCurrentAlias(PRIVKEY)

    expect(result).toEqual(Ok({ alias: 'npub1test', npub: 'npub1test' }))
  })
})

describe('PaymentAliasService.getAlias', () => {
  let provider: PaymentAliasProvider
  let service: PaymentAliasService

  beforeEach(() => {
    provider = createMockProvider()
    service = new PaymentAliasService(
      provider,
      { mintAndReceive: vi.fn() },
      vi.fn(() => createMockSigner()),
      createMockTxRepo(),
      createMockRouteOperator(),
      createMockEventBus(),
      'test.domain',
      createMockCodec(),
    )
  })

  it('returns the auth error as-is when auth fails', async () => {
    const authError = new NpubcashAuthError('auth failed')
    vi.mocked(provider.authenticate).mockResolvedValue(Err(authError))

    const result = await service.getAlias(PRIVKEY)

    expect(result).toEqual(Err(authError))
    expect(provider.getAccountInfo).not.toHaveBeenCalled()
  })

  it('returns the account info as-is on success', async () => {
    vi.mocked(provider.authenticate).mockResolvedValue(Ok(SESSION))
    const account = { alias: 'alice', domain: 'test.domain', mintUrl: MINT_URL, lockQuote: false }
    vi.mocked(provider.getAccountInfo).mockResolvedValue(Ok(account))

    const result = await service.getAlias(PRIVKEY)

    expect(result).toEqual(Ok(account))
    expect(provider.getAccountInfo).toHaveBeenCalledWith(SESSION)
  })
})

describe('PaymentAliasService.setMint', () => {
  let provider: PaymentAliasProvider
  let service: PaymentAliasService

  beforeEach(() => {
    provider = createMockProvider()
    service = new PaymentAliasService(
      provider,
      { mintAndReceive: vi.fn() },
      vi.fn(() => createMockSigner()),
      createMockTxRepo(),
      createMockRouteOperator(),
      createMockEventBus(),
      'test.domain',
      createMockCodec(),
    )
  })

  it('returns the auth error as-is when auth fails', async () => {
    const authError = new NpubcashAuthError('auth failed')
    vi.mocked(provider.authenticate).mockResolvedValue(Err(authError))

    const result = await service.setMint(PRIVKEY, MINT_URL)

    expect(result).toEqual(Err(authError))
    expect(provider.setPreferredMint).not.toHaveBeenCalled()
  })

  it('delegates to setPreferredMint with the session and mintUrl', async () => {
    vi.mocked(provider.authenticate).mockResolvedValue(Ok(SESSION))
    vi.mocked(provider.setPreferredMint).mockResolvedValue(Ok(undefined))

    const result = await service.setMint(PRIVKEY, MINT_URL)

    expect(result).toEqual(Ok(undefined))
    expect(provider.setPreferredMint).toHaveBeenCalledWith(SESSION, MINT_URL)
  })
})

describe('PaymentAliasService.toggleLock', () => {
  let provider: PaymentAliasProvider
  let service: PaymentAliasService

  beforeEach(() => {
    provider = createMockProvider()
    service = new PaymentAliasService(
      provider,
      { mintAndReceive: vi.fn() },
      vi.fn(() => createMockSigner()),
      createMockTxRepo(),
      createMockRouteOperator(),
      createMockEventBus(),
      'test.domain',
      createMockCodec(),
    )
  })

  it('returns the auth error as-is when auth fails', async () => {
    const authError = new NpubcashAuthError('auth failed')
    vi.mocked(provider.authenticate).mockResolvedValue(Err(authError))

    const result = await service.toggleLock(PRIVKEY)

    expect(result).toEqual(Err(authError))
    expect(provider.toggleLock).not.toHaveBeenCalled()
  })

  it('delegates to toggleLock with the session', async () => {
    vi.mocked(provider.authenticate).mockResolvedValue(Ok(SESSION))
    vi.mocked(provider.toggleLock).mockResolvedValue(Ok(true))

    const result = await service.toggleLock(PRIVKEY)

    expect(result).toEqual(Ok(true))
    expect(provider.toggleLock).toHaveBeenCalledWith(SESSION)
  })
})

describe('PaymentAliasService.claimPaidQuotes', () => {
  let provider: PaymentAliasProvider
  let mint: Pick<RoutePaymentOperator, 'mintAndReceive'>
  let service: PaymentAliasService

  beforeEach(() => {
    provider = createMockProvider()
    mint = { mintAndReceive: vi.fn() }
    service = new PaymentAliasService(
      provider,
      mint,
      vi.fn(() => createMockSigner()),
      createMockTxRepo(),
      createMockRouteOperator(),
      createMockEventBus(),
      'test.domain',
      createMockCodec(),
    )
  })

  it('returns the auth error as-is when auth fails', async () => {
    const authError = new NpubcashAuthError('auth failed')
    vi.mocked(provider.authenticate).mockResolvedValue(Err(authError))

    const result = await service.claimPaidQuotes(PRIVKEY)

    expect(result).toEqual(Err(authError))
    expect(provider.getPaidQuotes).not.toHaveBeenCalled()
  })

  it('returns the getPaidQuotes error as-is', async () => {
    vi.mocked(provider.authenticate).mockResolvedValue(Ok(SESSION))
    const quotesError = new NpubcashApiError(500, 'server error')
    vi.mocked(provider.getPaidQuotes).mockResolvedValue(Err(quotesError))

    const result = await service.claimPaidQuotes(PRIVKEY)

    expect(result).toEqual(Err(quotesError))
    expect(mint.mintAndReceive).not.toHaveBeenCalled()
  })

  it('mints and receives each paid quote in order and returns them', async () => {
    vi.mocked(provider.authenticate).mockResolvedValue(Ok(SESSION))
    const quotes = [
      { quoteId: 'q1', amount: 100, mintUrl: MINT_URL, unit: 'sat', paidAt: 1, expiry: 2 },
      { quoteId: 'q2', amount: 200, mintUrl: MINT_URL, unit: 'sat', paidAt: 3, expiry: 4 },
    ]
    vi.mocked(provider.getPaidQuotes).mockResolvedValue(Ok(quotes))

    const result = await service.claimPaidQuotes(PRIVKEY)

    expect(result).toEqual(Ok(quotes))
    expect(mint.mintAndReceive).toHaveBeenCalledTimes(2)
    expect(mint.mintAndReceive).toHaveBeenNthCalledWith(1, 'q1', MINT_URL, 100)
    expect(mint.mintAndReceive).toHaveBeenNthCalledWith(2, 'q2', MINT_URL, 200)
  })
})
