import { describe, expect, it, vi } from 'vitest'
import { InputParserService } from '@/core/services/input-parser.service'
import { InputRouter } from '@/core/services/input-router.service'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import type { LnurlGateway } from '@/core/ports/driven/lnurl-gateway.port'
import type { AddressResolverUseCase } from '@/core/ports/driving/address-resolver.usecase'

const MAINNET = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

function createParser() {
  const codec = {
    parseBitcoinUri: vi.fn(() => null),
    isBolt11: vi.fn(() => false),
    decodeBolt11: vi.fn(),
    isCashuToken: vi.fn(() => false),
    inspectCashuToken: vi.fn(),
    isLightningAddress: vi.fn((value: string) => value.includes('@')),
  } as unknown as TokenCodec
  const lnurl = { fetchLnurl: vi.fn() } as unknown as LnurlGateway
  const resolver = { resolve: vi.fn() } as unknown as AddressResolverUseCase
  return new InputParserService(codec, lnurl, resolver)
}

describe('bitcoin address input classification', () => {
  it('classifies a bare address', () => {
    const parser = createParser()
    expect(parser.detectAndClassify(MAINNET)).toEqual({
      type: 'bitcoin-address',
      address: MAINNET,
      amountSats: undefined,
    })
  })

  it('classifies a BIP21 URI with an amount', () => {
    const parser = createParser()
    expect(parser.detectAndClassify(`bitcoin:${MAINNET}?amount=0.001`)).toEqual({
      type: 'bitcoin-address',
      address: MAINNET,
      amountSats: 100000,
    })
  })

  it('keeps an email an email', () => {
    const parser = createParser()
    expect(parser.detectAndClassify('alice@domain.test').type).toBe('email-address')
  })

  it('leaves garbage unknown', () => {
    const parser = createParser()
    expect(parser.detectAndClassify('not a payment input').type).toBe('unknown')
  })

  it('router classifies a bitcoin URI with lightning as an invoice', async () => {
    const router = new InputRouter({ fetchLnurl: vi.fn() } as unknown as LnurlGateway)
    const result = await router.classify(
      `bitcoin:${MAINNET}?lightning=lnbc1invoice&amount=0.001`,
    )
    expect(result).toEqual({ type: 'invoice', bolt11: 'lnbc1invoice' })
  })

  it('router classifies a bare address', async () => {
    const router = new InputRouter({ fetchLnurl: vi.fn() } as unknown as LnurlGateway)
    expect(await router.classify(MAINNET)).toEqual({
      type: 'bitcoin-address',
      address: MAINNET,
      amountSats: undefined,
    })
  })
})
