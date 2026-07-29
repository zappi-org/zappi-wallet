import { describe, it, expect } from 'vitest'
import {
  resolveSendRoute,
  resolveCashuRoute,
  resolveDirectPaymentOrNoInfo,
  SEND_ROUTE_ERROR_I18N,
  type DirectPaymentResolution,
  type SendRouteError,
} from '@/core/domain/send-route-resolution'
import type { ValidatedCashuRequest, ValidatedEmailAddress } from '@/core/domain/input-types'

describe('resolveSendRoute', () => {
  const testAddress = 'alice@example.com'

  const lnurlParams = {
    callback: 'https://example.com/lnurlp/callback',
    minSendable: 1000,
    maxSendable: 1000000,
    metadata: '[]',
    tag: 'payRequest' as const,
    domain: 'example.com',
  }

  const nutzapInfo = {
    pubkey: 'abc123pubkey',
    mints: ['https://other-mint.example.com'],
    dmRelays: ['wss://relay.example.com'],
  }

  const ecashData: ValidatedCashuRequest = {
    type: 'cashu-request',
    request: testAddress,
    parsed: {
      id: 'req-1',
      unit: 'sat',
      mints: ['https://shared-mint.example.com'],
      transports: [{ type: 'nostr', target: 'npub1shared' }],
      hasNostrTransport: true,
      hasPostTransport: false,
    },
  }

  const baseEmail = {
    type: 'email-address',
    address: testAddress,
  } satisfies ValidatedEmailAddress

  const testCases = [
    {
      name: 'ready + lnurlParams → advance with selected mint',
      email: { ...baseEmail, nutzapInfo, lnurlParams },
      resolution: {
        status: 'ready' as const,
        validatedData: ecashData,
        commonMintUrls: ['https://shared-mint.example.com'],
        selectedMintUrl: 'https://shared-mint.example.com',
      },
      expected: {
        kind: 'advance' as const,
        data: ecashData,
        mintUrl: 'https://shared-mint.example.com',
        commonMintUrls: ['https://shared-mint.example.com'],
      },
    },
    {
      name: 'needs-mint-selection + lnurlParams → mint sheet',
      email: { ...baseEmail, nutzapInfo, lnurlParams },
      resolution: {
        status: 'needs-mint-selection' as const,
        validatedData: ecashData,
        commonMintUrls: ['https://shared-mint.example.com'],
      },
      expected: {
        kind: 'needs-mint-selection' as const,
        data: ecashData,
        commonMintUrls: ['https://shared-mint.example.com'],
      },
    },
    {
      name: 'no-common-mint + lnurlParams → LNURL fallback',
      email: { ...baseEmail, nutzapInfo, lnurlParams },
      resolution: { status: 'no-common-mint' as const },
      expected: { kind: 'lnurl-fallback' as const, data: { ...baseEmail, nutzapInfo, lnurlParams } },
    },
    {
      name: 'no-relay + lnurlParams → LNURL fallback',
      email: { ...baseEmail, nutzapInfo, lnurlParams },
      resolution: { status: 'no-relay' as const },
      expected: { kind: 'lnurl-fallback' as const, data: { ...baseEmail, nutzapInfo, lnurlParams } },
    },
    {
      name: 'no-info + lnurlParams → LNURL fallback',
      email: { ...baseEmail, nutzapInfo, lnurlParams },
      resolution: { status: 'no-info' as const },
      expected: { kind: 'lnurl-fallback' as const, data: { ...baseEmail, nutzapInfo, lnurlParams } },
    },
    {
      name: 'no-common-mint only → error',
      email: { ...baseEmail, nutzapInfo },
      resolution: { status: 'no-common-mint' as const },
      expected: { kind: 'error' as const, error: 'no-common-mint' as const },
    },
    {
      name: 'no-relay only → error',
      email: { ...baseEmail, nutzapInfo },
      resolution: { status: 'no-relay' as const },
      expected: { kind: 'error' as const, error: 'no-relay' as const },
    },
    {
      name: 'no-info only → error',
      email: { ...baseEmail, nutzapInfo },
      resolution: { status: 'no-info' as const },
      expected: { kind: 'error' as const, error: 'no-info' as const },
    },
  ]

  it.each(testCases)('$name', ({ email, resolution, expected }) => {
    const decision = resolveSendRoute(email, resolution as DirectPaymentResolution)
    expect(decision).toEqual(expected)
  })
})

describe('resolveCashuRoute', () => {
  const testAddress = 'npub1shared'

  const ecashData: ValidatedCashuRequest = {
    type: 'cashu-request',
    request: testAddress,
    parsed: {
      id: 'req-1',
      unit: 'sat',
      mints: ['https://shared-mint.example.com'],
      transports: [{ type: 'nostr', target: 'npub1shared' }],
      hasNostrTransport: true,
      hasPostTransport: false,
    },
  }

  const testCases = [
    {
      name: 'ready → advance with selected mint',
      resolution: {
        status: 'ready' as const,
        validatedData: ecashData,
        commonMintUrls: ['https://shared-mint.example.com'],
        selectedMintUrl: 'https://shared-mint.example.com',
      },
      expected: {
        kind: 'advance' as const,
        data: ecashData,
        mintUrl: 'https://shared-mint.example.com',
        commonMintUrls: ['https://shared-mint.example.com'],
      },
    },
    {
      name: 'needs-mint-selection → mint sheet',
      resolution: {
        status: 'needs-mint-selection' as const,
        validatedData: ecashData,
        commonMintUrls: ['https://shared-mint.example.com'],
      },
      expected: {
        kind: 'needs-mint-selection' as const,
        data: ecashData,
        commonMintUrls: ['https://shared-mint.example.com'],
      },
    },
    {
      name: 'no-common-mint → error',
      resolution: { status: 'no-common-mint' as const },
      expected: { kind: 'error' as const, error: 'no-common-mint' as const },
    },
    {
      name: 'no-relay → error',
      resolution: { status: 'no-relay' as const },
      expected: { kind: 'error' as const, error: 'no-relay' as const },
    },
    {
      name: 'no-info → error',
      resolution: { status: 'no-info' as const },
      expected: { kind: 'error' as const, error: 'no-info' as const },
    },
  ]

  it.each(testCases)('$name', ({ resolution, expected }) => {
    const decision = resolveCashuRoute(resolution as DirectPaymentResolution)
    expect(decision).toEqual(expected)
  })
})

describe('resolveDirectPaymentOrNoInfo', () => {
  const ecashData: ValidatedCashuRequest = {
    type: 'cashu-request',
    request: 'npub1shared',
    parsed: {
      id: 'req-1',
      unit: 'sat',
      mints: ['https://shared-mint.example.com'],
      transports: [{ type: 'nostr', target: 'npub1shared' }],
      hasNostrTransport: true,
      hasPostTransport: false,
    },
  }

  it('passes a successful resolution through untouched', async () => {
    const resolution: DirectPaymentResolution = {
      status: 'ready',
      validatedData: ecashData,
      commonMintUrls: ['https://shared-mint.example.com'],
      selectedMintUrl: 'https://shared-mint.example.com',
    }

    await expect(resolveDirectPaymentOrNoInfo(async () => resolution)).resolves.toBe(resolution)
  })

  // Unreachable relays reject inside the resolver; without this the rejection
  // escapes into a caller that never awaits and the user sees nothing.
  it('turns a rejected lookup into no-info', async () => {
    const resolution = await resolveDirectPaymentOrNoInfo(async () => {
      throw new Error('relay unreachable')
    })

    expect(resolution).toEqual({ status: 'no-info' })
    expect(resolveCashuRoute(resolution)).toEqual({ kind: 'error', error: 'no-info' })
    expect(SEND_ROUTE_ERROR_I18N['no-info']).toBe('send.destination.ecashInfoNotFound')
  })

  // A prefix-valid but malformed npub throws while decoding — before any promise
  // exists — so the thunk must be invoked inside the guard.
  it('turns a synchronous throw into no-info', async () => {
    const resolution = await resolveDirectPaymentOrNoInfo(() => {
      throw new Error('invalid bech32 checksum')
    })

    expect(resolution).toEqual({ status: 'no-info' })
  })
})

describe('SEND_ROUTE_ERROR_I18N', () => {
  it('maps no-common-mint to error key', () => {
    expect(SEND_ROUTE_ERROR_I18N['no-common-mint']).toBe('send.destination.noCommonMint')
  })

  it('maps no-relay to error key', () => {
    expect(SEND_ROUTE_ERROR_I18N['no-relay']).toBe('send.destination.relayNotFound')
  })

  it('maps no-info to error key', () => {
    expect(SEND_ROUTE_ERROR_I18N['no-info']).toBe('send.destination.ecashInfoNotFound')
  })

  it('covers every SendRouteError variant', () => {
    const allErrors: SendRouteError[] = ['no-common-mint', 'no-relay', 'no-info']
    for (const error of allErrors) {
      expect(SEND_ROUTE_ERROR_I18N).toHaveProperty(error)
      expect(typeof SEND_ROUTE_ERROR_I18N[error]).toBe('string')
    }
  })
})
