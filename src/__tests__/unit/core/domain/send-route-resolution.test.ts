import { describe, it, expect } from 'vitest'
import {
  resolveSendRoute,
  type DirectPaymentResolution,
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
