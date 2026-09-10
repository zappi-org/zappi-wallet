import { describe, it, expect } from 'vitest'
import { nip19 } from 'nostr-tools'
import { readMostroConfig } from '@/adapters/mostro/mostro-config'

const HEX = '11'.repeat(32)

describe('readMostroConfig', () => {
  it('is not_configured when the instance is unset', () => {
    expect(readMostroConfig({})).toEqual({ ok: false, reason: 'not_configured' })
  })

  it('rejects a malformed instance pubkey', () => {
    expect(readMostroConfig({ VITE_ZAPPI_MOSTRO_INSTANCE: 'not-a-pubkey' })).toEqual({
      ok: false,
      reason: 'invalid_config',
    })
  })

  it('accepts a hex instance pubkey and normalizes relays', () => {
    const result = readMostroConfig({
      VITE_ZAPPI_MOSTRO_INSTANCE: HEX.toUpperCase(),
      VITE_ZAPPI_MOSTRO_RELAYS: 'wss://relay.example, wss://relay.example',
    })
    expect(result).toEqual({
      ok: true,
      value: { mostroPubkeyHex: HEX, relays: ['wss://relay.example/'] },
    })
  })

  it('accepts an npub instance pubkey', () => {
    const npub = nip19.npubEncode(HEX)
    const result = readMostroConfig({
      VITE_ZAPPI_MOSTRO_INSTANCE: npub,
      VITE_ZAPPI_MOSTRO_RELAYS: 'wss://relay.example',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.mostroPubkeyHex).toBe(HEX)
  })

  it('is invalid_config when no usable relay is given', () => {
    expect(
      readMostroConfig({ VITE_ZAPPI_MOSTRO_INSTANCE: HEX, VITE_ZAPPI_MOSTRO_RELAYS: 'http://nope' }),
    ).toEqual({ ok: false, reason: 'invalid_config' })
  })
})
